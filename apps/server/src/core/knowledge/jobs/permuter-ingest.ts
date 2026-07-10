import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { immediateTransaction, now, openState, type StateStore } from "@server/core/orchestrator-state";
import { orchestratorRoot } from "@server/core/project-registry/resolver.js";
import type { GlobalArgs } from "@server/core/project-registry/runtime-options.js";
import { numberArg, stringArg } from "@server/core/project-registry/runtime-options.js";

// ---------------------------------------------------------------------------
// permuter-ingest — polls the two decomp-permuter farms (3090 Linux box +
// Windows native farm) over read-only SSH and mirrors their live state into
// the orchestrator SQLite DB (permuter_status / permuter_farm_summary) so
// the dashboard can show what's actively being permuted, what's queued, and
// per-function permutation time.
//
// It also samples CPU utilization on each farm (piggy-backed onto the same
// SSH round-trip) and turns that into an ESTIMATED electricity draw/cost,
// since neither farm exposes real power metering (3090's RAPL is root-only;
// Windows has no LibreHardwareMonitor/nvidia-smi). See
// projects/pkmn-colosseum/config/power.json for the wattage model.
// ---------------------------------------------------------------------------

export type PermuterState = "active" | "queued" | "win" | "nowin" | "fail";

export interface PermuterStatusRow {
  farm: "3090" | "windows";
  functionName: string;
  state: PermuterState;
  worker: string | null;
  baseScore: number | null;
  bestScore: number | null;
  permutationSeconds: number | null;
}

export interface PermuterFarmSummaryRow {
  farm: "3090" | "windows";
  workers: number | null;
  active: number | null;
  queued: number | null;
  wins: number | null;
  nowins: number | null;
  fails: number | null;
}

interface SpawnResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

const DEFAULT_SSH_KEY = resolve(homedir(), ".ssh/id_ed25519");
const DEFAULT_SSH_TIMEOUT_MS = 45_000;

const DEFAULT_FARM_3090_HOST = "douglaswhittingham@192.168.50.101";
const DEFAULT_FARM_3090_BASE = "/storage/finetune/pkmn-colosseum-2026/farm";

const DEFAULT_FARM_WINDOWS_HOST = "douglaswhittingham@192.168.50.47";
const DEFAULT_FARM_WINDOWS_BASE = "C:\\Users\\douglaswhittingham\\gamecube-decomp\\pkmn-permuter";

async function runSsh(host: string, sshKeyPath: string, remoteCommand: string, timeoutMs: number): Promise<SpawnResult> {
  const command = ["ssh", "-i", sshKeyPath, "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", host, remoteCommand];
  let proc: Bun.ReadableSubprocess;
  try {
    proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    return { ok: false, stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error) };
  }
  const timer = setTimeout(() => {
    try {
      proc.kill(9);
    } catch {
      // process may have already exited
    }
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) {
      return { ok: false, stdout, stderr, error: `ssh exited ${exitCode}: ${stderr || stdout}` };
    }
    return { ok: true, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Electricity model — power.json config, CPU-util -> watts, energy accrual.
// ---------------------------------------------------------------------------

interface FarmPowerConfig {
  idle_watts: number;
  load_watts: number;
}

interface PowerConfig {
  rateUsdPerKwh: number;
  farms: Record<string, FarmPowerConfig>;
}

// A poller-downtime gap must never inject a huge fake energy spike into a
// farm's cumulative totals, so any inter-cycle gap is clamped to 5 minutes
// before being turned into watt-hours.
const MAX_POWER_DELTA_SECONDS = 300;

function loadPowerConfig(globals: GlobalArgs): PowerConfig | null {
  try {
    const projectId = globals.project?.projectId ?? globals.projectId ?? "pkmn-colosseum";
    const projectDir = globals.project?.projectDir ?? resolve(orchestratorRoot(), "projects", projectId);
    const configPath = resolve(projectDir, "config/power.json");
    if (!existsSync(configPath)) return null;
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      electricity_rate_usd_per_kwh?: unknown;
      farms?: Record<string, { idle_watts?: unknown; load_watts?: unknown }>;
    };
    const rate = raw.electricity_rate_usd_per_kwh;
    if (typeof rate !== "number" || !Number.isFinite(rate) || !raw.farms || typeof raw.farms !== "object") return null;
    const farms: Record<string, FarmPowerConfig> = {};
    for (const [farm, value] of Object.entries(raw.farms)) {
      if (!value || typeof value.idle_watts !== "number" || typeof value.load_watts !== "number") continue;
      farms[farm] = { idle_watts: value.idle_watts, load_watts: value.load_watts };
    }
    return { rateUsdPerKwh: rate, farms };
  } catch {
    // Power tracking is a best-effort add-on; never let a bad/missing config
    // break the core permuter_status ingest.
    return null;
  }
}

function wattsForUtil(cfg: FarmPowerConfig | undefined, cpuUtil: number | null): number | null {
  if (!cfg || cpuUtil === null || !Number.isFinite(cpuUtil)) return null;
  const clamped = Math.max(0, Math.min(100, cpuUtil));
  return cfg.idle_watts + (cfg.load_watts - cfg.idle_watts) * (clamped / 100);
}

function powerDeltaHours(priorUpdatedAt: string | null, nowIso: string): number {
  if (!priorUpdatedAt) return 0;
  const priorMs = Date.parse(priorUpdatedAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(priorMs) || !Number.isFinite(nowMs) || nowMs <= priorMs) return 0;
  const deltaSeconds = Math.min((nowMs - priorMs) / 1000, MAX_POWER_DELTA_SECONDS);
  return deltaSeconds / 3600;
}

// ---------------------------------------------------------------------------
// 3090 farm (Linux) — parsing
// ---------------------------------------------------------------------------

function build3090RemoteScript(base: string): string {
  const s = `${base}/state`;
  return [
    `BASE="${base}"`,
    `S="${s}"`,
    `bash "${base}/status.sh"`,
    `echo '@@@ACTIVE_FULL@@@'`,
    `grep -H '^CLAIMED' "$S"/*.status 2>/dev/null`,
    `echo '@@@TERMINAL_FULL@@@'`,
    `grep -H -E '^(WIN|NOWIN|FAIL)' "$S"/*.status 2>/dev/null`,
    `echo '@@@QUEUE@@@'`,
    `cat "${base}/queue.tsv" 2>/dev/null`,
    `echo '@@@RESULT_BASE_SCORES@@@'`,
    `for d in "${base}"/results/*/; do fn=$(basename "$d"); [ -f "$d/summary.json" ] && printf '%s\\t%s\\n' "$fn" "$(jq -r '.base_score // "null"' "$d/summary.json" 2>/dev/null)"; done`,
    // CPU utilization sample for the electricity estimate — two /proc/stat
    // reads 1s apart, piggy-backed onto this same SSH round-trip.
    `echo '@@@CPU_STAT@@@'`,
    `awk '/^cpu /{print $2,$3,$4,$5,$6,$7,$8}' /proc/stat`,
    `sleep 1`,
    `awk '/^cpu /{print $2,$3,$4,$5,$6,$7,$8}' /proc/stat`,
  ].join("\n");
}

interface Farm3090Parsed {
  rows: Map<string, PermuterStatusRow>;
  summary: PermuterFarmSummaryRow;
  cpuUtil: number | null;
}

// Two /proc/stat samples of `user nice system idle iowait irq softirq` 1s
// apart -> busy% = 100 * delta(user+nice+system+irq+softirq) / delta(total).
function cpuUtilFrom3090ProcStat(raw: string): number | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const parseFields = (line: string): number[] | null => {
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 7 || parts.some((n) => !Number.isFinite(n))) return null;
    return parts;
  };
  const before = parseFields(lines[0]);
  const after = parseFields(lines[1]);
  if (!before || !after) return null;
  const deltas = before.map((_, i) => after[i] - before[i]);
  const totalDelta = deltas.reduce((sum, v) => sum + v, 0);
  if (totalDelta <= 0) return null;
  // indices: 0 user, 1 nice, 2 system, 3 idle, 4 iowait, 5 irq, 6 softirq
  const busyDelta = deltas[0] + deltas[1] + deltas[2] + deltas[5] + deltas[6];
  const util = (100 * busyDelta) / totalDelta;
  return Number.isFinite(util) ? Math.max(0, Math.min(100, util)) : null;
}

function parse3090Status(stdout: string, nowSeconds: number): Farm3090Parsed {
  const sections = splitSections(stdout, [
    "@@@ACTIVE_FULL@@@",
    "@@@TERMINAL_FULL@@@",
    "@@@QUEUE@@@",
    "@@@RESULT_BASE_SCORES@@@",
    "@@@CPU_STAT@@@",
  ]);
  const summaryLine = sections["__head__"].split(/\r?\n/).find((line) => line.startsWith("workers=")) ?? "";
  const summary = parse3090SummaryLine(summaryLine);
  const cpuUtil = cpuUtilFrom3090ProcStat(sections["@@@CPU_STAT@@@"] ?? "");

  const rows = new Map<string, PermuterStatusRow>();

  // 1. Everything in queue.tsv starts out "queued" (queue.tsv is a stable
  //    superset — claimed/completed entries stay listed, just get skipped).
  for (const line of (sections["@@@QUEUE@@@"] ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 4) continue;
    const fn = parts[3];
    if (!fn) continue;
    rows.set(fn, {
      farm: "3090",
      functionName: fn,
      state: "queued",
      worker: null,
      baseScore: null,
      bestScore: null,
      permutationSeconds: null,
    });
  }

  // 2. Overlay active claims: "<path>:CLAIMED w<N> <ts>"
  for (const line of (sections["@@@ACTIVE_FULL@@@"] ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(.*):CLAIMED\s+(w\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    const fn = basenameNoExt(match[1]);
    const worker = match[2];
    const claimedAt = Number(match[3]);
    rows.set(fn, {
      farm: "3090",
      functionName: fn,
      state: "active",
      worker,
      baseScore: null,
      bestScore: null,
      permutationSeconds: Number.isFinite(claimedAt) ? Math.max(0, nowSeconds - claimedAt) : null,
    });
  }

  // 3. Base scores harvested from results/<fn>/summary.json (WIN candidates
  //    only score 0, so best_score is always 0 for those).
  const resultBaseScores = new Map<string, number | null>();
  for (const line of (sections["@@@RESULT_BASE_SCORES@@@"] ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [fn, rawScore] = line.split("\t");
    if (!fn) continue;
    const score = rawScore === "null" || rawScore === undefined ? null : Number(rawScore);
    resultBaseScores.set(fn, Number.isFinite(score as number) ? (score as number) : null);
  }

  // 4. Overlay terminal states: "<path>:STATE w<N> <ts> [pct=..|best=..|base=..]"
  for (const line of (sections["@@@TERMINAL_FULL@@@"] ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(.*):(WIN(?:_UNCONFIRMED)?|NOWIN|FAIL\w*)\s+(w\d+)\s+(\d+)\s*(.*)$/);
    if (!match) continue;
    const fn = basenameNoExt(match[1]);
    const rawState = match[2];
    const worker = match[3];
    const rest = match[5] ?? "";

    let state: PermuterState;
    let baseScore: number | null = null;
    let bestScore: number | null = null;
    if (rawState === "WIN" || rawState === "WIN_UNCONFIRMED") {
      state = "win";
      bestScore = 0;
      baseScore = resultBaseScores.get(fn) ?? null;
    } else if (rawState === "NOWIN") {
      state = "nowin";
      const bestMatch = rest.match(/best=([\w.]+)/);
      const baseMatch = rest.match(/base=([\w.]+)/);
      bestScore = bestMatch ? numericOrNull(bestMatch[1]) : null;
      baseScore = baseMatch ? numericOrNull(baseMatch[1]) : null;
    } else {
      state = "fail";
    }

    rows.set(fn, {
      farm: "3090",
      functionName: fn,
      state,
      worker,
      baseScore,
      bestScore,
      // We only retain the completion timestamp for terminal entries (the
      // claim record is overwritten by harvest.py), so total permutation
      // duration isn't reliably recoverable from farm state alone.
      permutationSeconds: null,
    });
  }

  // The raw "queue=N" the farm reports is the total size of queue.tsv (a
  // stable superset that keeps completed/active entries listed forever), not
  // the count of functions still untouched. Tally the actual per-row states
  // instead so the summary matches what permuter_status rows show.
  const tallies: Record<PermuterState, number> = { active: 0, queued: 0, win: 0, nowin: 0, fail: 0 };
  for (const row of rows.values()) tallies[row.state] += 1;
  summary.active = tallies.active;
  summary.queued = tallies.queued;
  summary.wins = tallies.win;
  summary.nowins = tallies.nowin;
  summary.fails = tallies.fail;

  return { rows, summary, cpuUtil };
}

function parse3090SummaryLine(line: string): PermuterFarmSummaryRow {
  const get = (key: string): number | null => {
    const match = line.match(new RegExp(`${key}=(\\d+)`));
    return match ? Number(match[1]) : null;
  };
  return {
    farm: "3090",
    workers: get("workers"),
    active: get("active"),
    queued: get("queue"),
    wins: get("WIN"),
    nowins: get("NOWIN"),
    fails: get("FAIL"),
  };
}

// ---------------------------------------------------------------------------
// Windows farm — parsing
// ---------------------------------------------------------------------------

// cmd.exe quoting is broken for the Get-Counter one-liner, so it's shipped as
// a base64 UTF-16LE -EncodedCommand — the only reliable way to hand
// PowerShell a quoted counter path over a non-interactive SSH exec. This is
// chained (via cmd's `&`) onto the same script/round-trip as the existing
// status/state/manifest reads rather than opening a second SSH connection.
const WINDOWS_CPU_UTIL_SCRIPT =
  "[math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples.CookedValue,1)";
const WINDOWS_CPU_UTIL_ENCODED_COMMAND = Buffer.from(WINDOWS_CPU_UTIL_SCRIPT, "utf16le").toString("base64");

function buildWindowsRemoteScript(base: string): string {
  const statusPath = `${base}\\state\\status.json`;
  const statePath = `${base}\\state\\state.json`;
  const manifestPath = `${base}\\units\\manifest.json`;
  return [
    `type "${statusPath}"`,
    `echo @@@STATUS_JSON@@@`,
    `type "${statePath}"`,
    `echo @@@STATE_JSON@@@`,
    `type "${manifestPath}"`,
    `echo @@@MANIFEST_JSON@@@`,
    `powershell -NoProfile -EncodedCommand ${WINDOWS_CPU_UTIL_ENCODED_COMMAND}`,
    `echo @@@CPU_UTIL@@@`,
  ].join(" & ");
}

interface WindowsStatusJson {
  workers?: number;
  target_workers?: number;
  units?: number;
  wins?: number;
  bad?: number;
  active?: Record<string, { base?: number; best?: number; elapsed?: number }>;
}

interface WindowsStateJson {
  done?: Record<string, { won?: boolean; base?: number; best?: number; bad?: string }>;
}

interface WindowsManifestEntry {
  fn?: string;
  status?: string;
  base_score?: number;
}

interface FarmWindowsParsed {
  rows: Map<string, PermuterStatusRow>;
  summary: PermuterFarmSummaryRow;
  cpuUtil: number | null;
}

// PowerShell run non-interactively over SSH wraps its output in a CLIXML
// envelope on some hosts/policies; strip that noise and take the first
// remaining numeric line as the sampled CPU percentage.
function cpuUtilFromWindowsPowershellOutput(raw: string): number | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#< CLIXML|<Objs|schemas\.microsoft/i.test(line));
  for (const line of lines) {
    const value = Number(line);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  }
  return null;
}

function parseWindowsStatus(stdout: string): FarmWindowsParsed {
  const sections = splitSections(stdout, ["@@@STATUS_JSON@@@", "@@@STATE_JSON@@@", "@@@MANIFEST_JSON@@@", "@@@CPU_UTIL@@@"]);

  const statusJson = parseJsonSafe<WindowsStatusJson>(sections["__head__"]) ?? {};
  const stateJson = parseJsonSafe<WindowsStateJson>(sections["@@@STATUS_JSON@@@"]) ?? {};
  const manifest = parseJsonSafe<WindowsManifestEntry[]>(sections["@@@STATE_JSON@@@"]) ?? [];
  // The powershell -EncodedCommand output for the CPU sample lands in the
  // content between the "@@@MANIFEST_JSON@@@" and "@@@CPU_UTIL@@@" markers
  // (it's the command chained right after `echo @@@MANIFEST_JSON@@@`).
  const cpuUtil = cpuUtilFromWindowsPowershellOutput(sections["@@@MANIFEST_JSON@@@"] ?? "");

  const rows = new Map<string, PermuterStatusRow>();

  // 1. Manifest entries with status "ok" are the pool the farm is working
  //    through; default them to "queued" before overlaying active/done.
  for (const entry of manifest) {
    if (entry.status !== "ok" || !entry.fn) continue;
    rows.set(entry.fn, {
      farm: "windows",
      functionName: entry.fn,
      state: "queued",
      worker: null,
      baseScore: typeof entry.base_score === "number" ? entry.base_score : null,
      bestScore: null,
      permutationSeconds: null,
    });
  }

  // 2. Overlay active permutation runs from status.json (base/best/elapsed
  //    are already computed by farm.py — no need to poll processes or logs).
  for (const [fn, info] of Object.entries(statusJson.active ?? {})) {
    rows.set(fn, {
      farm: "windows",
      functionName: fn,
      state: "active",
      worker: null,
      baseScore: typeof info.base === "number" ? info.base : null,
      bestScore: typeof info.best === "number" ? info.best : null,
      permutationSeconds: typeof info.elapsed === "number" ? info.elapsed : null,
    });
  }

  // 3. Overlay terminal outcomes from state.json's done map.
  for (const [fn, info] of Object.entries(stateJson.done ?? {})) {
    if (info.won) {
      rows.set(fn, {
        farm: "windows",
        functionName: fn,
        state: "win",
        worker: null,
        baseScore: typeof info.base === "number" ? info.base : null,
        bestScore: typeof info.best === "number" ? info.best : 0,
        permutationSeconds: null,
      });
    } else if (info.bad !== undefined) {
      rows.set(fn, {
        farm: "windows",
        functionName: fn,
        state: "nowin",
        worker: null,
        baseScore: typeof info.base === "number" ? info.base : null,
        bestScore: typeof info.best === "number" ? info.best : null,
        permutationSeconds: null,
      });
    }
  }

  // Tally actual per-row states so the summary matches what permuter_status
  // rows show (rather than trusting status.json's counters, which cover a
  // slightly different population — e.g. "bad" includes dequeue reasons for
  // functions that may no longer be in the manifest's "ok" pool).
  const tallies: Record<PermuterState, number> = { active: 0, queued: 0, win: 0, nowin: 0, fail: 0 };
  for (const row of rows.values()) tallies[row.state] += 1;

  const summary: PermuterFarmSummaryRow = {
    farm: "windows",
    workers: statusJson.workers ?? statusJson.target_workers ?? null,
    active: tallies.active,
    queued: tallies.queued,
    wins: tallies.win,
    nowins: tallies.nowin,
    fails: tallies.fail,
  };

  return { rows, summary, cpuUtil };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function splitSections(stdout: string, markers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let remaining = stdout;
  let headEnd = remaining.length;
  for (const marker of markers) {
    const index = remaining.indexOf(marker);
    if (index === -1) continue;
    if (headEnd === remaining.length) headEnd = index;
  }
  result["__head__"] = remaining.slice(0, headEnd);
  remaining = remaining.slice(headEnd);

  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const start = remaining.indexOf(marker);
    if (start === -1) {
      result[marker] = "";
      continue;
    }
    const contentStart = start + marker.length;
    let contentEnd = remaining.length;
    for (let j = i + 1; j < markers.length; j += 1) {
      const nextIndex = remaining.indexOf(markers[j], contentStart);
      if (nextIndex !== -1) {
        contentEnd = nextIndex;
        break;
      }
    }
    result[marker] = remaining.slice(contentStart, contentEnd).trim();
  }
  return result;
}

function basenameNoExt(path: string): string {
  const parts = path.split("/");
  const file = parts[parts.length - 1] ?? path;
  return file.endsWith(".status") ? file.slice(0, -".status".length) : file;
}

function numericOrNull(raw: string): number | null {
  if (raw === "None" || raw === "null" || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseJsonSafe<T>(raw: string): T | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SQLite upsert — permuter_status / permuter_farm_summary / permuter_power /
// permuter_function_energy, all written in one transaction per farm cycle.
// ---------------------------------------------------------------------------

interface FarmCyclePersistResult {
  cpuUtil: number | null;
  watts: number | null;
  deltaHours: number;
  whDelta: number;
  costDelta: number;
}

function persistFarmCycle(
  store: StateStore,
  input: {
    farm: "3090" | "windows";
    rows: Map<string, PermuterStatusRow>;
    summary: PermuterFarmSummaryRow;
    cpuUtil: number | null;
    updatedAt: string;
    powerConfig: PowerConfig | null;
  },
): FarmCyclePersistResult {
  const { farm, rows, summary, cpuUtil, updatedAt, powerConfig } = input;
  const farmCfg = powerConfig?.farms[farm];
  const watts = wattsForUtil(farmCfg, cpuUtil);

  let deltaHours = 0;
  let whDelta = 0;
  let costDelta = 0;

  immediateTransaction(store.db, () => {
    if (rows.size > 0) {
      const statusStmt = store.db.query(`
        INSERT INTO permuter_status (farm, function_name, state, worker, base_score, best_score, permutation_seconds, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(farm, function_name) DO UPDATE SET
          state = excluded.state,
          worker = excluded.worker,
          base_score = excluded.base_score,
          best_score = excluded.best_score,
          permutation_seconds = excluded.permutation_seconds,
          updated_at = excluded.updated_at
      `);
      for (const row of rows.values()) {
        statusStmt.run(row.farm, row.functionName, row.state, row.worker, row.baseScore, row.bestScore, row.permutationSeconds, updatedAt);
      }
    }

    store.db
      .query(`
        INSERT INTO permuter_farm_summary (farm, workers, active, queued, wins, nowins, fails, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(farm) DO UPDATE SET
          workers = excluded.workers,
          active = excluded.active,
          queued = excluded.queued,
          wins = excluded.wins,
          nowins = excluded.nowins,
          fails = excluded.fails,
          updated_at = excluded.updated_at
      `)
      .run(summary.farm, summary.workers, summary.active, summary.queued, summary.wins, summary.nowins, summary.fails, updatedAt);

    if (!farmCfg || watts === null || !powerConfig) return;

    const priorRow = store.db.query(`SELECT updated_at FROM permuter_power WHERE farm = ?`).get(farm) as { updated_at: string } | undefined;
    deltaHours = powerDeltaHours(priorRow?.updated_at ?? null, updatedAt);
    whDelta = watts * deltaHours;
    costDelta = (whDelta / 1000) * powerConfig.rateUsdPerKwh;

    store.db
      .query(`
        INSERT INTO permuter_power (farm, cpu_util, current_watts, cumulative_wh, cumulative_cost_usd, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(farm) DO UPDATE SET
          cpu_util = excluded.cpu_util,
          current_watts = excluded.current_watts,
          cumulative_wh = permuter_power.cumulative_wh + excluded.cumulative_wh,
          cumulative_cost_usd = permuter_power.cumulative_cost_usd + excluded.cumulative_cost_usd,
          updated_at = excluded.updated_at
      `)
      .run(farm, cpuUtil, watts, whDelta, costDelta, updatedAt);

    // Functions currently in the "active" state on this farm split the
    // cycle's energy delta evenly. A function that later completes keeps its
    // accumulated row (that's the point — cost-per-function survives
    // completion), so this is a pure additive share, never a reset.
    const activeFns = Array.from(rows.values()).filter((row) => row.state === "active");
    if (activeFns.length === 0 || whDelta <= 0) return;

    const share = whDelta / activeFns.length;
    const shareCost = (share / 1000) * powerConfig.rateUsdPerKwh;
    const fnStmt = store.db.query(`
      INSERT INTO permuter_function_energy (farm, function_name, cumulative_wh, cumulative_cost_usd, last_permutation_seconds, last_state, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(farm, function_name) DO UPDATE SET
        cumulative_wh = permuter_function_energy.cumulative_wh + excluded.cumulative_wh,
        cumulative_cost_usd = permuter_function_energy.cumulative_cost_usd + excluded.cumulative_cost_usd,
        last_permutation_seconds = excluded.last_permutation_seconds,
        last_state = excluded.last_state,
        updated_at = excluded.updated_at
    `);
    for (const row of activeFns) {
      fnStmt.run(farm, row.functionName, share, shareCost, row.permutationSeconds, row.state, updatedAt);
    }
  });

  return { cpuUtil, watts, deltaHours, whDelta, costDelta };
}

// ---------------------------------------------------------------------------
// Job entrypoint
// ---------------------------------------------------------------------------

export async function permuterIngest(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const sshKeyPath = stringArg(args, "--ssh-key", DEFAULT_SSH_KEY);
  const timeoutMs = numberArg(args, "--ssh-timeout-ms", DEFAULT_SSH_TIMEOUT_MS);
  const host3090 = stringArg(args, "--farm-3090-host", DEFAULT_FARM_3090_HOST);
  const base3090 = stringArg(args, "--farm-3090-base", DEFAULT_FARM_3090_BASE);
  const hostWindows = stringArg(args, "--farm-windows-host", DEFAULT_FARM_WINDOWS_HOST);
  const baseWindows = stringArg(args, "--farm-windows-base", DEFAULT_FARM_WINDOWS_BASE);

  const store = openState(globals.stateDir);
  const updatedAt = now();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const powerConfig = loadPowerConfig(globals);

  const report: Record<string, unknown> = { generated_at: updatedAt, farms: {} };

  try {
    const [result3090, resultWindows] = await Promise.all([
      runSsh(host3090, sshKeyPath, build3090RemoteScript(base3090), timeoutMs),
      runSsh(hostWindows, sshKeyPath, buildWindowsRemoteScript(baseWindows), timeoutMs),
    ]);

    (report.farms as Record<string, unknown>)["3090"] = await ingestFarmResult({
      store,
      farm: "3090",
      result: result3090,
      updatedAt,
      powerConfig,
      parse: (stdout) => parse3090Status(stdout, nowSeconds),
    });

    (report.farms as Record<string, unknown>)["windows"] = await ingestFarmResult({
      store,
      farm: "windows",
      result: resultWindows,
      updatedAt,
      powerConfig,
      parse: (stdout) => parseWindowsStatus(stdout),
    });
  } finally {
    store.db.close();
  }

  console.log(JSON.stringify(report, null, 2));
}

async function ingestFarmResult(input: {
  store: StateStore;
  farm: "3090" | "windows";
  result: SpawnResult;
  updatedAt: string;
  powerConfig: PowerConfig | null;
  parse: (stdout: string) => { rows: Map<string, PermuterStatusRow>; summary: PermuterFarmSummaryRow; cpuUtil: number | null };
}): Promise<Record<string, unknown>> {
  const { store, farm, result, updatedAt, powerConfig, parse } = input;
  if (!result.ok) {
    // SSH failure for one farm must never break the other — record it and move on.
    return { ok: false, error: result.error ?? "unknown ssh failure" };
  }
  try {
    const { rows, summary, cpuUtil } = parse(result.stdout);
    const power = persistFarmCycle(store, { farm, rows, summary, cpuUtil, updatedAt, powerConfig });
    return {
      ok: true,
      rows_upserted: rows.size,
      summary,
      power: {
        cpu_util: power.cpuUtil,
        watts: power.watts,
        delta_hours: power.deltaHours,
        wh_delta: power.whDelta,
        cost_delta_usd: power.costDelta,
      },
    };
  } catch (error) {
    return { ok: false, error: `parse/upsert failed for ${farm}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
