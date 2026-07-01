import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadKnowledgeBoardSnapshot, packageRoot, resourceGraphDbPath } from "@server/core/knowledge";
import {
  activeWorkerCount,
  activeSchedulerEpoch,
  addEvent,
  blockedAdmittedTargetCount,
  closeSchedulerEpoch,
  DEFAULT_WORKER_TTL_SECONDS,
  getLatestRun,
  getRun,
  nextUnhandledEvent,
  openState,
  admittedTargetCount,
  recordSchedulerEpochFastRefresh,
  refreshEpochTargetPriorities,
  refreshEpochTargetAvailability,
  schedulerEpochProgress,
  schedulableTargetCount,
  targetClaimFilterCommandArgs,
  targetClaimFilterFromArgs,
  unhandledEventCount,
  type EpochProgressSummary,
  type StateStore,
  type TargetClaimFilter,
} from "@server/core/session-runtime/run-state";
import { withBusyRetry } from "@server/core/orchestrator-state";
import { runEpochCycle, type EpochCycleResult } from "@server/core/session-runtime/phases/running/epochs";
import { conflictItemArtifactPaths, pendingConflictIntegrationIds, selectConflictItemsToLaunch } from "@server/core/session-runtime/phases/running/integration/conflict-resolver.js";
import { resolveResolverModel } from "@server/core/session-runtime/phases/running/integration/integration-resolve.js";
import { createColosseumKernelSpawnContext } from "@server/infrastructure/kernel/bridge/spawn-context";
import { runColosseumKernelPiAgent as runPiAgent } from "@server/infrastructure/agent-runtime/kernel-pi-runner";
import { booleanArg, numberArg, stringArg, type GlobalArgs } from "@server/core/project-registry/runtime-options.js";
import { assertSchedulableRun } from "@server/core/session-runtime/phases/running/jobs/shared.js";
import {
  ensureSchedulerEpochFromBoard,
  runSchedulerTick,
  schedulerEpochConfigFromArgs,
  type SchedulerEpochEnsureResult,
  type SchedulerTickResult,
} from "@server/core/session-runtime/phases/running/scheduler/tick.js";
import type { WorkerCycleResult } from "@server/core/session-runtime/phases/running/workers/worker-cycle.js";
import { runKnowledgeMaintenance } from "@server/core/knowledge/jobs/kg.js";

interface WorkerError {
  workerId: string;
  error: string;
}

interface KnowledgeMaintenanceError {
  error: string;
}

interface EpochError {
  error: string;
}

interface TargetPressureSnapshot {
  admittedTargets: number;
  activeWorkers: number;
  admissionTargetSize: number;
  blockedAdmittedTargets: number;
  candidateLimit: number;
  candidateWindow: number;
  maxWorkers: number;
  openSlots: number;
  runningWorkers: number;
  schedulableTargets: number;
}

export type FastKnowledgeMaintenanceAction = "defer" | "none" | "skip_no_new_reports" | "start";

export interface FastKnowledgeMaintenanceDecision {
  action: FastKnowledgeMaintenanceAction;
  reason?: "interval" | "report_count" | "no_new_reports";
  reportDue: boolean;
  reportsSinceRefresh: number;
  timeDue: boolean;
}

export interface RunLoopResult {
  runId: string;
  mode: "run_loop";
  stoppedReason: string;
  iterations: number;
  idleIterations: number;
  desiredWorkers: number;
  maxWorkers: number;
  schedulerTicks: number;
  epochCycle: boolean;
  epochCycles: number;
  schedulerEpoch?: EpochProgressSummary | null;
  epochAdmissions: number;
  epochAvailabilityRefreshes: number;
  epochTargetsAdmitted: number;
  epochErrors: EpochError[];
  epochPaused: boolean;
  lastEpoch?: EpochCycleResult;
  epochPriorityRefreshes: number;
  epochTargetsMadeAvailable: number;
  workersStarted: number;
  workerResults: WorkerCycleResult[];
  workerErrors: WorkerError[];
  providerPauses: number;
  providerPaused: boolean;
  lastProviderError?: string;
  knowledgeMaintenanceRuns: Record<string, unknown>[];
  knowledgeMaintenanceErrors: KnowledgeMaintenanceError[];
  fastKnowledgeMaintenanceRuns: Record<string, unknown>[];
  fastKnowledgeMaintenanceErrors: KnowledgeMaintenanceError[];
  dryRun: boolean;
  finalStatus: {
    activeWorkers: number;
    admittedTargets: number;
    blockedAdmittedTargets: number;
    schedulableTargets: number;
    unhandledEvents: number;
  };
}

export type TriggerAgentResult = RunLoopResult;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROVIDER_PROBE_INITIAL_BACKOFF_MS = 30_000;
const PROVIDER_PROBE_MAX_BACKOFF_MS = 300_000;

// Cheapest truthful health check: a tiny no-tools session through the exact provider
// path workers use. An LB liveness endpoint can say "ok" while its upstream account
// pool is exhausted; a completion can't lie.
async function probeProvider(globals: GlobalArgs, outputDir: string, runId: string): Promise<{ healthy: boolean; error?: string }> {
  try {
    const result = await runPiAgent({
      role: "worker",
      cwd: globals.repoRoot,
      prompt: {
        systemPrompt: "You are a connectivity probe. Reply with the single word OK.",
        userPrompt: "Reply with the single word OK.",
        systemTemplatePath: "(provider-probe inline)",
        userTemplatePath: "(provider-probe inline)",
      },
      outputDir,
      dryRun: false,
      provider: globals.provider,
      model: globals.model,
      thinkingLevel: "low",
      timeoutMs: 120_000,
      sessionDir: outputDir,
      toolProfile: { replace: [] },
      kernelContext: createColosseumKernelSpawnContext({
        kind: "run",
        projectId: globals.project?.projectId ?? globals.projectId,
        sessionId: runId,
        runId,
        phase: "provider-probe",
        workingDir: globals.repoRoot,
        metadata: {
          probe: true,
          outputDir,
        },
      }),
    });
    if (result.failed) return { healthy: false, error: result.error ?? "probe session failed" };
    if (result.providerError) return { healthy: false, error: result.providerError };
    if (!result.rawText.trim()) return { healthy: false, error: "probe returned empty output" };
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function orchestratorRoot(): string {
  return packageRoot();
}

function activeLocalWorkerCount(store: StateStore, runId: string, workerIds: Set<string>): number {
  if (workerIds.size === 0) return 0;
  const ids = [...workerIds];
  const placeholders = ids.map(() => "?").join(", ");
  const row = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT COUNT(*) AS count
            FROM target_claims
            WHERE session_id = ?
              AND status = 'active'
              AND worker_id IN (${placeholders})
          `,
        )
        .get(runId, ...ids) as Record<string, unknown>,
  );
  return Number(row.count ?? 0);
}

// Watchdog helper: the worker_ids (among `workerIds`) that currently hold an active claim.
// Mirrors activeLocalWorkerCount but returns the id set. Because a worker claims its target
// BEFORE building its worktree (worker-cycle: claim precedes build), a running worker NOT in
// this set is stuck in the pre-claim path and is a reap candidate.
export function activeClaimedWorkerIds(store: StateStore, runId: string, workerIds: Set<string>): Set<string> {
  if (workerIds.size === 0) return new Set();
  const ids = [...workerIds];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT worker_id
            FROM target_claims
            WHERE session_id = ?
              AND status = 'active'
              AND worker_id IN (${placeholders})
          `,
        )
        .all(runId, ...ids) as Array<Record<string, unknown>>,
  );
  return new Set(rows.map((row) => String(row.worker_id)));
}

// A spawned worker that never registers an active target_claim is stuck in the pre-claim path
// (openState / getRun / git rev-parse on the shared repo). Uncounted and unreaped it pins a
// slot forever, driving openSlots toward 0 and blocking all replacement spawns. Reap such a
// worker past this age. 75s sits above p99 pre-claim latency (<10s) and below the ~3min build
// (which only starts AFTER the claim), so a genuinely working worker is never eligible.
export const PENDING_CLAIM_TIMEOUT_MS = 75_000;

type WorkerProcHandle = { kill: (signal?: number) => void; exited: Promise<number> };
type WorkerProcRegistry = Map<string, { proc: WorkerProcHandle; spawnedAtMs: number }>;

export function workerOpenSlots(params: { maxWorkers: number; activeWorkers: number; runningWorkers: number; activeLocalWorkers: number }): number {
  const pendingLocalWorkers = Math.max(0, params.runningWorkers - params.activeLocalWorkers);
  return Math.max(0, params.maxWorkers - params.activeWorkers - pendingLocalWorkers);
}

// Kill any spawned worker that is still pending a claim (NOT in claimedWorkerIds) past
// timeoutMs. Classify by claim, never by age alone — a worker WITH an active claim is
// building/working and must never be reaped. kill(9) settles proc.exited so the existing
// .finally() frees the slot next tick; recover-claims returns any half-claimed target.
export function reapStuckPendingWorkers(params: {
  workerProcs: WorkerProcRegistry;
  claimedWorkerIds: Set<string>;
  nowMs: number;
  timeoutMs: number;
  onReap?: (workerId: string, ageMs: number) => void;
}): string[] {
  const reaped: string[] = [];
  for (const [workerId, rec] of params.workerProcs) {
    if (params.claimedWorkerIds.has(workerId)) continue;
    const ageMs = params.nowMs - rec.spawnedAtMs;
    if (ageMs < params.timeoutMs) continue;
    rec.proc.kill(9);
    params.onReap?.(workerId, ageMs);
    reaped.push(workerId);
  }
  return reaped;
}

// Rank 2 — board-throttle gate. ensureSchedulerEpochFromBoard runs loadKnowledgeBoardSnapshot
// x2 + a full-window priority refresh, which at ~5s/tick stalls the single JS thread and
// starves spawn/reap. Throttle it to at most once per nextRefreshMs — BUT always run on the
// first iteration (iterationsCompleted === 0) so the first epoch admits promptly and the pool
// starts.
export function shouldRefreshSchedulerBoard(params: { iterationsCompleted: number; nowMs: number; nextRefreshMs: number }): boolean {
  return params.iterationsCompleted === 0 || params.nowMs >= params.nextRefreshMs;
}

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function targetPressureSnapshotForRunLoop(params: {
  admissionTargetSize: number;
  candidateLimit: number;
  candidateWindow: number;
  maxWorkers: number;
  runningWorkers: Set<Promise<void>>;
  runningWorkerIds: Set<string>;
  runId: string;
  store: StateStore;
  targetFilter?: TargetClaimFilter;
}): TargetPressureSnapshot {
  const activeWorkers = activeWorkerCount(params.store, params.runId);
  const activeLocalWorkers = activeLocalWorkerCount(params.store, params.runId, params.runningWorkerIds);
  const openSlots = workerOpenSlots({
    maxWorkers: params.maxWorkers,
    activeWorkers,
    runningWorkers: params.runningWorkers.size,
    activeLocalWorkers,
  });
  return {
    admittedTargets: admittedTargetCount(params.store, params.runId),
    activeWorkers,
    admissionTargetSize: params.admissionTargetSize,
    blockedAdmittedTargets: blockedAdmittedTargetCount(params.store, params.runId),
    candidateLimit: params.candidateLimit,
    candidateWindow: params.candidateWindow,
    maxWorkers: params.maxWorkers,
    openSlots,
    runningWorkers: params.runningWorkers.size,
    schedulableTargets: schedulableTargetCount(params.store, params.runId, params.targetFilter),
  };
}


export function evaluateFastKnowledgeMaintenanceDecision(params: {
  intervalMs: number;
  lastMaintenanceMs: number;
  nowMs: number;
  reportCountTrigger: number;
  reportsSinceRefresh: number;
  running: boolean;
}): FastKnowledgeMaintenanceDecision {
  const reportsSinceRefresh = Math.max(0, Math.floor(params.reportsSinceRefresh));
  const timeDue = params.intervalMs > 0 && params.nowMs - params.lastMaintenanceMs >= params.intervalMs;
  const reportDue = params.reportCountTrigger > 0 && reportsSinceRefresh >= params.reportCountTrigger;
  if (!timeDue && !reportDue) return { action: "none", reportDue, reportsSinceRefresh, timeDue };
  const reason = reportDue ? "report_count" : "interval";
  if (params.running) return { action: "defer", reason, reportDue, reportsSinceRefresh, timeDue };
  if (reportsSinceRefresh <= 0) return { action: "skip_no_new_reports", reason: "no_new_reports", reportDue, reportsSinceRefresh, timeDue };
  return { action: "start", reason, reportDue, reportsSinceRefresh, timeDue };
}

function cloneArgs(args: Map<string, string | true>, entries: [string, string | true][]): Map<string, string | true> {
  const next = new Map(args);
  for (const [key, value] of entries) next.set(key, value);
  return next;
}

function knowledgeMaintenanceArgs(args: Map<string, string | true>, runId: string, runPrAgentByDefault: boolean): Map<string, string | true> {
  const next = new Map<string, string | true>([["--run-id", runId]]);
  for (const key of [
    "--agent-state-enrichment",
    "--curator-agent-record-limit",
    "--graph-db",
    "--knowledge-curator-enrichment",
    "--no-pr-index",
    "--no-rebuild",
    "--no-run-pr-agent",
    "--no-tool-index",
    "--no-tool-runners",
    "--progress-only",
    "--pr-jobs",
    "--pr-limit",
    "--rerun-existing-prs",
    "--run-pr-agent",
    "--run-curator-agent",
    "--sources",
    "--worker-limit",
  ]) {
    const value = args.get(key);
    if (value !== undefined) next.set(key, value);
  }
  if (runPrAgentByDefault && !next.has("--run-pr-agent") && !next.has("--no-run-pr-agent")) next.set("--run-pr-agent", true);
  if (next.has("--run-pr-agent") && !next.has("--pr-limit")) next.set("--pr-limit", "8");
  return next;
}

function fastKnowledgeMaintenanceArgs(args: Map<string, string | true>, runId: string): Map<string, string | true> {
  const next = knowledgeMaintenanceArgs(args, runId, false);
  next.set("--no-tool-runners", true);
  if (!next.has("--run-pr-agent")) next.set("--no-run-pr-agent", true);
  return next;
}

function fullBoundaryKnowledgeMaintenanceArgs(args: Map<string, string | true>, runId: string, mode: string): Map<string, string | true> {
  const next = knowledgeMaintenanceArgs(args, runId, false);
  if (!next.has("--run-pr-agent")) next.set("--no-run-pr-agent", true);
  if (mode === "no-tool-runners") next.set("--no-tool-runners", true);
  return next;
}

function knowledgeMaintenanceIntervalMs(globals: GlobalArgs, args: Map<string, string | true>): number {
  if (booleanArg(args, "--no-knowledge-maintenance")) return 0;
  const fallback = globals.dryRunAgents ? 0 : 5 * 60_000;
  return Math.max(0, Math.floor(numberArg(args, "--knowledge-maintenance-interval-ms", fallback)));
}

function fastKnowledgeMaintenanceIntervalMs(globals: GlobalArgs, args: Map<string, string | true>): number {
  if (booleanArg(args, "--no-fast-kg-maintenance")) return 0;
  const fallback = globals.project?.dashboard.fastKgMaintenanceEnabled === false ? 0 : (globals.project?.dashboard.fastKgMaintenanceIntervalMs ?? (globals.dryRunAgents ? 0 : 3 * 60_000));
  return Math.max(0, Math.floor(numberArg(args, "--fast-kg-maintenance-interval-ms", fallback)));
}

function fastKnowledgeMaintenanceReportCount(globals: GlobalArgs, args: Map<string, string | true>): number {
  if (booleanArg(args, "--no-fast-kg-maintenance")) return 0;
  return Math.max(0, Math.floor(numberArg(args, "--fast-kg-maintenance-report-count", globals.project?.dashboard.fastKgMaintenanceReportCount ?? 16)));
}

function workerStateCloseCountSince(store: StateStore, runId: string, sinceIso: string): number {
  const row = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT COUNT(*) AS count
            FROM worker_state
            WHERE session_id = ?
              AND lifecycle_status != 'error'
              AND ended_at > ?
          `,
        )
        .get(runId, sinceIso) as Record<string, unknown> | undefined,
  );
  return Number(row?.count ?? 0);
}

function latestFastRefreshFinishedAt(store: StateStore, runId: string, fallbackIso: string): string {
  const row = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT created_at
            FROM events
            WHERE run_id = ?
              AND event_type = 'epoch_fast_refresh_finished'
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(runId) as Record<string, unknown> | undefined,
  );
  return row?.created_at == null ? fallbackIso : String(row.created_at);
}

async function waitForRestingTrigger(runningWorkers: Set<Promise<void>>, idleSleepMs: number, extras: Array<Promise<void> | null> = []): Promise<void> {
  const live = [...runningWorkers, ...extras.filter((task): task is Promise<void> => task != null)];
  if (live.length === 0) {
    await sleep(idleSleepMs);
    return;
  }
  await Promise.race([sleep(idleSleepMs), ...live]);
}

function schedulerTickArgs(
  args: Map<string, string | true>,
  params: { admissionTargetSize: number; candidateLimit: number; candidateWindow: number; runId: string },
): Map<string, string | true> {
  return cloneArgs(args, [
    ["--run-id", params.runId],
    ["--candidate-limit", String(params.candidateLimit)],
    ["--candidate-window", String(params.candidateWindow)],
    ["--queue-target-size", String(params.admissionTargetSize)],
  ]);
}

function sourceListArg(args: Map<string, string | true>, name: string): string[] {
  const raw = args.get(name);
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function configurePySupportedFlags(repoRoot: string): Set<string> | null {
  try {
    const text = readFileSync(resolve(repoRoot, "configure.py"), "utf8");
    const flags = new Set([...text.matchAll(/["'](--[A-Za-z0-9][A-Za-z0-9-]*)["']/g)].map((match) => match[1]));
    return flags.size > 0 ? flags : null;
  } catch {
    return null;
  }
}

function configureSupports(flags: Set<string> | null, flag: string): boolean {
  return flags == null || flags.has(flag);
}

function defaultConfigureCommand(globals: Pick<GlobalArgs, "repoRoot" | "stateDir">): string {
  const supportedFlags = configurePySupportedFlags(globals.repoRoot);
  const requireProtos = configureSupports(supportedFlags, "--require-protos") ? " --require-protos" : "";
  const baseCommand = `python3 configure.py${requireProtos}`;
  if (!configureSupports(supportedFlags, "--wrapper")) return baseCommand;
  const localWibo = resolve(globals.repoRoot, "build", "tools", "wibo");
  if ((process.platform === "darwin" || process.platform === "linux") && existsSync(localWibo)) {
    return `${baseCommand} --wrapper build/tools/wibo`;
  }
  const wibo = resolve(globals.stateDir, "tools", "wibo");
  if ((process.platform === "darwin" || process.platform === "linux") && existsSync(wibo)) {
    return `${baseCommand} --wrapper ${shellQuote(wibo)}`;
  }
  return baseCommand;
}

function workerProcessEnv(globals: Pick<GlobalArgs, "stateDir">): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...Bun.env };
  const wibo = resolve(globals.stateDir, "tools", "wibo");
  if ((process.platform === "darwin" || process.platform === "linux") && existsSync(wibo)) {
    env.MWCC_WIBO = wibo;
  }
  return env;
}

function workerCommand(
  globals: GlobalArgs,
  params: {
    runId: string;
    workerId: string;
    baseRev: string;
    ttlSeconds: number;
    thinkingLevel: string;
    postReturnCheckCommand: string;
    workerConfigureCommand: string;
    graphDbPath: string;
    targetFilter?: TargetClaimFilter;
  },
): string[] {
  const bin = resolve(orchestratorRoot(), "apps/server/src/job-runner.ts");
  const command = [
    "bun",
    bin,
    "--repo-root",
    globals.repoRoot,
    "--state-dir",
    globals.stateDir,
    "--provider",
    globals.provider,
    "--model",
    globals.model,
    "--thinking-level",
    params.thinkingLevel,
  ];
  if (globals.projectId) command.splice(2, 0, "--project", globals.projectId);
  if (globals.dryRunAgents) command.push("--dry-run-agents");
  if (globals.agentTimeoutSeconds != null) command.push("--agent-timeout-seconds", String(globals.agentTimeoutSeconds));
  // Track A: propagate escalation flags so the spawned worker re-parses them onto its globals.
  if (globals.escalationEnabled && globals.ladderPath) command.push("--escalation", "--ladder", globals.ladderPath);
  command.push(
    "worker",
    "--run-id",
    params.runId,
    "--worker-id",
    params.workerId,
    "--base-rev",
    params.baseRev,
    "--ttl-seconds",
    String(params.ttlSeconds),
  );
  if (params.postReturnCheckCommand) command.push("--post-return-check-command", params.postReturnCheckCommand);
  if (params.workerConfigureCommand) command.push("--worker-configure-command", params.workerConfigureCommand);
  command.push(...targetClaimFilterCommandArgs(params.targetFilter));
  command.push("--graph-db", params.graphDbPath);
  return command;
}

type ConflictResolverRegistry = Map<string, { proc: WorkerProcHandle }>;

// Build the `integration-resolve` child command for one queued conflict, running the resolver
// on the (cheap) --resolver-* model so the campaign worker's model is not spent on merges.
export function integrationResolveCommand(
  globals: GlobalArgs,
  params: { runId: string; itemPath: string; queueSummaryPath: string; resolverProvider: string; resolverModel: string; resolverThinkingLevel: string },
): string[] {
  const bin = resolve(orchestratorRoot(), "apps/server/src/job-runner.ts");
  const command = ["bun", bin, "--repo-root", globals.repoRoot, "--state-dir", globals.stateDir, "--provider", globals.provider, "--model", globals.model, "--thinking-level", globals.thinkingLevel];
  if (globals.projectId) command.splice(2, 0, "--project", globals.projectId);
  if (globals.dryRunAgents) command.push("--dry-run-agents");
  if (globals.agentTimeoutSeconds != null) command.push("--agent-timeout-seconds", String(globals.agentTimeoutSeconds));
  command.push(
    "integration-resolve",
    "--run-id",
    params.runId,
    "--item-file",
    params.itemPath,
    "--queue-summary-file",
    params.queueSummaryPath,
    "--resolver-provider",
    params.resolverProvider,
    "--resolver-model",
    params.resolverModel,
    "--resolver-thinking-level",
    params.resolverThinkingLevel,
  );
  return command;
}

// Spawn one resolver subprocess for a conflict item, keyed by item id so the gate never
// double-launches it; the proc.exited.finally frees the slot. Output is discarded (the resolver
// persists its own summary + status) so it can never corrupt the run-loop's JSON stdout.
function spawnConflictResolver(
  globals: GlobalArgs,
  params: { itemId: string; runId: string; itemPath: string; queueSummaryPath: string; resolverProvider: string; resolverModel: string; resolverThinkingLevel: string },
  registry: ConflictResolverRegistry,
): void {
  const command = integrationResolveCommand(globals, params);
  const proc = Bun.spawn(command, {
    cwd: orchestratorRoot(),
    env: workerProcessEnv(globals),
    stdout: "ignore",
    stderr: "ignore",
  });
  registry.set(params.itemId, { proc });
  void proc.exited.finally(() => registry.delete(params.itemId));
}

async function runWorkerProcess(
  globals: GlobalArgs,
  params: {
    runId: string;
    workerId: string;
    baseRev: string;
    ttlSeconds: number;
    thinkingLevel: string;
    postReturnCheckCommand: string;
    workerConfigureCommand: string;
    graphDbPath: string;
    targetFilter?: TargetClaimFilter;
  },
  procRegistry?: WorkerProcRegistry,
): Promise<WorkerCycleResult> {
  const command = workerCommand(globals, params);
  const proc = Bun.spawn(command, {
    cwd: orchestratorRoot(),
    env: workerProcessEnv(globals),
    stdout: "pipe",
    stderr: "pipe",
  });
  // Keyed by workerId so the pending-claim watchdog can kill a specific stuck worker;
  // spawnedAtMs anchors its pre-claim age.
  procRegistry?.set(params.workerId, { proc, spawnedAtMs: Date.now() });
  void proc.exited.finally(() => procRegistry?.delete(params.workerId));
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`Worker process failed (${exitCode}): ${command.join(" ")}\n${stderr || stdout}`);
  }
  try {
    return JSON.parse(stdout) as WorkerCycleResult;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Worker process returned non-JSON output: ${detail}\n${stdout}\n${stderr}`);
  }
}

export async function runRunLoop(globals: GlobalArgs, args: Map<string, string | true>): Promise<RunLoopResult> {
  const store = openState(globals.stateDir);
  const workerResults: WorkerCycleResult[] = [];
  const workerErrors: WorkerError[] = [];
  const schedulerResults: SchedulerTickResult[] = [];
  const knowledgeMaintenanceRuns: Record<string, unknown>[] = [];
  const knowledgeMaintenanceErrors: KnowledgeMaintenanceError[] = [];
  const fastKnowledgeMaintenanceRuns: Record<string, unknown>[] = [];
  const fastKnowledgeMaintenanceErrors: KnowledgeMaintenanceError[] = [];
  const runningWorkers = new Set<Promise<void>>();
  const runningWorkerIds = new Set<string>();
  const runningWorkerProcs: WorkerProcRegistry = new Map();
  // Auto integration-conflict resolution (opt-in). Bounds: one resolver per item, capped
  // concurrency, in-lifetime retry cap so a repeatedly-crashing resolver can't loop forever.
  const autoResolveConflicts = booleanArg(args, "--auto-resolve-conflicts");
  const resolverModelConfig = resolveResolverModel(args, globals);
  const resolverMaxConcurrency = Math.max(1, Math.trunc(numberArg(args, "--resolver-max-concurrency", 1)));
  const resolverMaxAttempts = Math.max(1, Math.trunc(numberArg(args, "--resolver-max-attempts", 2)));
  const runningConflictResolvers: ConflictResolverRegistry = new Map();
  const conflictResolverAttempts = new Map<string, number>();
  const conflictResolverExhausted = new Set<string>();
  let runningScheduler: Promise<void> | null = null;
  let runningKnowledgeMaintenance: Promise<void> | null = null;
  let stoppedReason = "running";
  let stopRequested = false;
  let drainRequested = false;
  let iterations = 0;
  let idleIterations = 0;
  let workersStarted = 0;
  let workerOrdinal = 0;
  let providerPausedSinceMs: number | null = null;
  let providerPauses = 0;
  let lastProviderError: string | undefined;
  let providerProbeBackoffMs = PROVIDER_PROBE_INITIAL_BACKOFF_MS;
  let nextProviderProbeMs = 0;
  let runningProviderProbe: Promise<void> | null = null;
  const stop = () => {
    stopRequested = true;
    stoppedReason = "signal";
  };
  const drain = () => {
    drainRequested = true;
    stoppedReason = "draining";
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGUSR1", drain);

  try {
    const runId = stringArg(args, "--run-id", getLatestRun(store)?.id ?? "");
    if (!runId) throw new Error("No run found. Run init-run first.");
    const run = getRun(store, runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    assertSchedulableRun(run, "run-loop");

    const maxIterations = booleanArg(args, "--once") ? 1 : numberArg(args, "--max-iterations", 0);
    const maxIdleIterations = numberArg(args, "--max-idle-iterations", 0);
    const idleSleepMs = numberArg(args, "--idle-sleep-ms", 5_000);
    const requestedMaxWorkers = numberArg(args, "--max-workers", run.desiredWorkers);
    const maxWorkers = Math.max(0, Math.min(run.desiredWorkers, requestedMaxWorkers));
    if (requestedMaxWorkers > run.desiredWorkers) {
      console.error(
        `[run-loop] --max-workers ${requestedMaxWorkers} exceeds run desired_workers ${run.desiredWorkers}; clamping to ${maxWorkers}. ` +
          `Raise the run's desired_workers (or re-init with --desired-workers) to use the full pool.`,
      );
    }
    const candidateLimit = nonNegativeInt(numberArg(args, "--candidate-limit", globals.project?.dashboard.candidateLimit ?? Math.max(32, maxWorkers * 2)));
    const admissionTargetSize = nonNegativeInt(
      numberArg(args, "--queue-target-size", globals.project?.dashboard.queueTargetSize ?? Math.max(candidateLimit, maxWorkers * 2)),
    );
    const candidateWindow = Math.max(
      candidateLimit,
      admissionTargetSize,
      nonNegativeInt(numberArg(args, "--candidate-window", globals.project?.dashboard.candidateWindow ?? Math.max(candidateLimit, admissionTargetSize * 8))),
    );
    const baseRev = stringArg(args, "--base-rev", "unknown");
    const ttlSeconds = numberArg(args, "--ttl-seconds", DEFAULT_WORKER_TTL_SECONDS);
    const postReturnCheckCommand = stringArg(args, "--post-return-check-command", "");
    const graphDbPath = stringArg(args, "--graph-db", globals.graphDbPath ?? resourceGraphDbPath());
    const exitOnWorkerError = booleanArg(args, "--exit-on-worker-error");
    const workerThinkingLevel = stringArg(args, "--worker-thinking-level", globals.thinkingLevel);
    const workerConfigureCommand = stringArg(args, "--worker-configure-command", defaultConfigureCommand(globals));
    const targetFilter = targetClaimFilterFromArgs(args);
    const maintenanceIntervalMs = knowledgeMaintenanceIntervalMs(globals, args);
    const epochCycleEnabled = !booleanArg(args, "--no-epoch-cycle");
    const schedulerEpochConfig = schedulerEpochConfigFromArgs(globals, args, { admissionTargetSize, candidateWindow });
    const workerPoolTargetSize = schedulerEpochConfig.workerPoolSize;
    const epochWorktreeDir = stringArg(args, "--epoch-worktree", resolve(globals.stateDir, "epoch_worktree"));
    const epochConfigureCommand = stringArg(args, "--epoch-configure-command", defaultConfigureCommand(globals));
    const epochExcludePaths = sourceListArg(args, "--epoch-exclude-paths");
    const epochLinkPaths = stringArg(args, "--epoch-link-paths", "orig")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
    const epochPauseThreshold = nonNegativeInt(numberArg(args, "--epoch-regression-pause-threshold", 12));
    const epochRequeueLimit = nonNegativeInt(numberArg(args, "--epoch-regression-requeue-limit", 32));
    const epochRetryMs = nonNegativeInt(numberArg(args, "--epoch-retry-ms", 10 * 60_000));
    // Rank 2: minimum spacing between the expensive per-iteration board refresh (see
    // shouldRefreshSchedulerBoard). Default 15s (vs the ~5s tick) throttles the event-loop
    // stall while keeping admission/priority fresh; the first iteration always runs.
    const boardRefreshMs = nonNegativeInt(numberArg(args, "--board-refresh-ms", 15_000));
    const fullKgMaintenanceMode = stringArg(args, "--full-kg-maintenance-mode", globals.project?.dashboard.fullKgMaintenanceMode ?? "full").trim().toLowerCase();
    let runningEpoch: Promise<void> | null = null;
    let nextEpochAllowedMs = 0;
    let nextPriorityRefreshMs = 0;
    let epochCycles = 0;
    let epochPaused = false;
    let lastEpoch: EpochCycleResult | undefined;
    const epochErrors: EpochError[] = [];
    let epochPriorityRefreshes = 0;
    let epochTargetsMadeAvailable = 0;
    let epochAdmissions = 0;
    let epochAvailabilityRefreshes = 0;
    let epochTargetsAdmitted = 0;
    let lastSchedulerEpoch: EpochProgressSummary | null = null;
    let lastKnowledgeMaintenanceMs = maintenanceIntervalMs > 0 ? 0 : Date.now();
    const fastMaintenanceIntervalMs = fastKnowledgeMaintenanceIntervalMs(globals, args);
    const fastMaintenanceReportCount = fastKnowledgeMaintenanceReportCount(globals, args);
    let lastFastMaintenanceMs = Date.now();
    let lastFastMaintenanceReportIso = latestFastRefreshFinishedAt(store, runId, run.createdAt);
    let runningFastKnowledgeMaintenance: Promise<void> | null = null;
    let pendingFastKnowledgeMaintenance = false;

    while (!stopRequested) {
      let didWork = false;

      if (!drainRequested && !runningKnowledgeMaintenance && maintenanceIntervalMs > 0 && Date.now() - lastKnowledgeMaintenanceMs >= maintenanceIntervalMs) {
        lastKnowledgeMaintenanceMs = Date.now();
        let task: Promise<void>;
        task = runKnowledgeMaintenance(globals, knowledgeMaintenanceArgs(args, runId, !globals.dryRunAgents))
          .then((result) => {
            knowledgeMaintenanceRuns.push(result);
          })
          .catch((error) => {
            knowledgeMaintenanceErrors.push({ error: error instanceof Error ? error.message : String(error) });
          })
          .finally(() => {
            if (runningKnowledgeMaintenance === task) runningKnowledgeMaintenance = null;
          });
        runningKnowledgeMaintenance = task;
        didWork = true;
      }

      const targetPressureBefore = targetPressureSnapshotForRunLoop({
        admissionTargetSize: workerPoolTargetSize,
        candidateLimit,
        candidateWindow,
        maxWorkers,
        runningWorkers,
        runningWorkerIds,
        runId,
        store,
        targetFilter,
      });
      const nowMs = Date.now();
      const launchEpochCycle = (trigger: string, schedulerEpochId?: string): void => {
        const epochOrdinal = epochCycles + 1;
        let task: Promise<void>;
        task = (async () => {
            try {
              let boundaryResult: EpochCycleResult | undefined;
              if (globals.dryRunAgents) {
                // Dry runs skip the snapshot/build but still close/start
                // scheduler epochs so tests exercise deterministic admission.
                epochCycles += 1;
              } else {
                console.error(`[run-loop] epoch ${epochOrdinal}: ${trigger}; snapshotting and rebuilding report`);
                const result = await runEpochCycle(store, runId, globals.repoRoot, globals.stateDir, {
                  baseRef: globals.project?.baseRef,
                  changesTarget: globals.project?.validation.qaTarget,
                  configureCommand: epochConfigureCommand,
                  extraExcludePaths: epochExcludePaths,
                  label: `epoch-${epochOrdinal}`,
                  linkPaths: epochLinkPaths,
                  projectId: globals.project?.projectId ?? globals.projectId ?? null,
                  qaScan: { orchestratorRoot: packageRoot() },
                  regressionPauseThreshold: epochPauseThreshold,
                  regressionRequeueLimit: epochRequeueLimit,
                  reportRelPath: globals.project?.validation.reportPath,
                  reportChangesRelPath: globals.project?.validation.reportChangesPath,
                  worktreeDir: epochWorktreeDir,
                });
                boundaryResult = result;
                epochCycles += 1;
                lastEpoch = result;
                epochPaused = result.repair.paused;
                console.error(
                  `[run-loop] epoch ${epochOrdinal}: matched_code ${result.matchedCodePercent ?? "?"}%, ` +
                    `${result.regressions.regressedFunctions} regressed functions, ${result.repair.requeued} repairs readmitted, ` +
                    `qa gate ${result.qaGate === null ? "not run" : `${result.qaGate.status} (${result.qaGate.errors} errors, ${result.qaGate.warnings} warnings)`} ` +
                    `(${Math.round(result.durationMs / 1000)}s)`,
                );
                if (result.repair.paused) {
                  addEvent(store, runId, "epoch_regression_pause", "run-loop", {
                    epoch: epochOrdinal,
                    qa_gate: result.qaGate,
                    reasons: result.repair.reasons,
                    regressions: result.regressions,
                    save_point_id: result.savePointId,
                    created_by: "run-loop",
                  });
                  console.error(`[run-loop] epoch ${epochOrdinal}: paused on regressions; retrying in ${Math.round(epochRetryMs / 1000)}s`);
                  if (schedulerEpochId) {
                    closeSchedulerEpoch(store, schedulerEpochId, {
                      status: "paused",
                      boundaryStatus: "regression_pause",
                      routingSummary: {
                        trigger,
                        save_point_id: result.savePointId,
                        regressions: result.regressions,
                        repair: result.repair,
                        qa_gate: result.qaGate,
                      },
                    });
                  }
                  nextEpochAllowedMs = Date.now() + epochRetryMs;
                  return;
                }
              }

              if (!globals.dryRunAgents && fullKgMaintenanceMode !== "skip" && fullKgMaintenanceMode !== "none" && fullKgMaintenanceMode !== "off") {
                const maintenanceGlobals = boundaryResult?.worktreeDir ? { ...globals, repoRoot: boundaryResult.worktreeDir } : globals;
                addEvent(store, runId, "epoch_full_refresh_started", "run-loop", {
                  epoch: epochOrdinal,
                  lane: "full_boundary",
                  mode: fullKgMaintenanceMode,
                  repo_root: maintenanceGlobals.repoRoot,
                  created_by: "run-loop",
                });
                const maintenance = await runKnowledgeMaintenance(maintenanceGlobals, fullBoundaryKnowledgeMaintenanceArgs(args, runId, fullKgMaintenanceMode));
                knowledgeMaintenanceRuns.push({ ...maintenance, lane: "full_boundary", mode: fullKgMaintenanceMode, repo_root: maintenanceGlobals.repoRoot });
                addEvent(store, runId, "epoch_full_refresh_finished", "run-loop", {
                  epoch: epochOrdinal,
                  lane: "full_boundary",
                  mode: fullKgMaintenanceMode,
                  repo_root: maintenanceGlobals.repoRoot,
                  created_by: "run-loop",
                });
              }

              if (schedulerEpochId) {
                closeSchedulerEpoch(store, schedulerEpochId, {
                  status: "completed",
                  boundaryStatus: globals.dryRunAgents ? "dry_run" : "success",
                  routingSummary: {
                    trigger,
                    dry_run: globals.dryRunAgents,
                    save_point_id: boundaryResult?.savePointId ?? null,
                    matched_code_percent: boundaryResult?.matchedCodePercent ?? null,
                    regressions: boundaryResult?.regressions ?? null,
                    repair: boundaryResult?.repair ?? null,
                    qa_gate: boundaryResult?.qaGate ?? null,
                  },
                });
              }

              const nextEpoch = ensureSchedulerEpochFromBoard({
                config: schedulerEpochConfig,
                globals,
                graphDbPath,
                runId,
                store,
              });
              lastSchedulerEpoch = nextEpoch.progress;
              epochAdmissions += (nextEpoch.admission?.admitted ?? 0) + (nextEpoch.existingAdmission?.admitted ?? 0);
              epochAvailabilityRefreshes += nextEpoch.availabilityRefresh.inserted > 0 ? 1 : 0;
              epochTargetsAdmitted += (nextEpoch.admission?.admitted ?? 0) + (nextEpoch.existingAdmission?.admitted ?? 0);
              epochTargetsMadeAvailable += (nextEpoch.admission?.admitted ?? 0) + nextEpoch.availabilityRefresh.inserted;
              epochPriorityRefreshes += nextEpoch.priorityRefreshes;
              if ((nextEpoch.progress.admitted === 0 || nextEpoch.progress.remaining === 0) && nextEpoch.progress.available === 0 && nextEpoch.progress.claimed === 0) {
                closeSchedulerEpoch(store, nextEpoch.epoch.id, {
                  status: "exhausted",
                  boundaryStatus: "board_exhausted",
                  routingSummary: { trigger: "post_boundary_admission", board_exhausted: nextEpoch.boardExhausted },
                });
                addEvent(store, runId, "epoch_exhausted", "run-loop", {
                  epoch_id: nextEpoch.epoch.id,
                  ordinal: nextEpoch.progress.ordinal,
                  size: nextEpoch.progress.size,
                  created_by: "run-loop",
                });
                nextEpochAllowedMs = Date.now() + epochRetryMs;
              } else {
                addEvent(store, runId, "epoch_admitted", "run-loop", {
                  epoch_id: nextEpoch.epoch.id,
                  ordinal: nextEpoch.progress.ordinal,
                  admitted: nextEpoch.progress.admitted,
                  available: nextEpoch.progress.available,
                  size: nextEpoch.progress.size,
                  created_by: "run-loop",
                });
                if (nextEpoch.availabilityRefresh.inserted > 0 || (nextEpoch.admission?.admitted ?? 0) > 0) {
                  didWork = true;
                }
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              epochErrors.push({ error: message });
              console.error(`[run-loop] epoch ${epochOrdinal} failed: ${message}`);
              addEvent(store, runId, "epoch_cycle_error", "run-loop", {
                epoch: epochOrdinal,
                error: message.slice(0, 2000),
                created_by: "run-loop",
              });
              if (schedulerEpochId) {
                closeSchedulerEpoch(store, schedulerEpochId, {
                  status: "error",
                  boundaryStatus: "error",
                  routingSummary: { trigger, error: message.slice(0, 2000) },
                });
              }
              nextEpochAllowedMs = Date.now() + epochRetryMs;
            }
        })().finally(() => {
          if (runningEpoch === task) runningEpoch = null;
        });
        runningEpoch = task;
      };

      if (!drainRequested && epochCycleEnabled && fastMaintenanceIntervalMs > 0 && !runningEpoch) {
        const reportsSinceFast = workerStateCloseCountSince(store, runId, lastFastMaintenanceReportIso);
        const fastDecision = evaluateFastKnowledgeMaintenanceDecision({
          intervalMs: fastMaintenanceIntervalMs,
          lastMaintenanceMs: lastFastMaintenanceMs,
          nowMs,
          reportCountTrigger: fastMaintenanceReportCount,
          reportsSinceRefresh: reportsSinceFast,
          running: Boolean(runningFastKnowledgeMaintenance),
        });
        if (fastDecision.action !== "none") {
          if (fastDecision.action === "defer") {
            if (!pendingFastKnowledgeMaintenance) {
              pendingFastKnowledgeMaintenance = true;
              addEvent(store, runId, "epoch_fast_refresh_deferred", "run-loop", {
                reason: fastDecision.reason,
                reports_since_refresh: fastDecision.reportsSinceRefresh,
                created_by: "run-loop",
              });
            }
          } else if (fastDecision.action === "skip_no_new_reports") {
            lastFastMaintenanceMs = nowMs;
            addEvent(store, runId, "epoch_fast_refresh_skipped", "run-loop", {
              reason: "no_new_reports",
              created_by: "run-loop",
            });
          } else {
            pendingFastKnowledgeMaintenance = false;
            lastFastMaintenanceMs = nowMs;
            const activeEpoch = activeSchedulerEpoch(store, runId);
            addEvent(store, runId, "epoch_fast_refresh_started", "run-loop", {
              epoch_id: activeEpoch?.id ?? null,
              reports_since_refresh: fastDecision.reportsSinceRefresh,
              reason: fastDecision.reason,
              created_by: "run-loop",
            });
            let task: Promise<void>;
            task = runKnowledgeMaintenance(globals, fastKnowledgeMaintenanceArgs(args, runId))
              .then((result) => {
                const completedAt = new Date().toISOString();
                fastKnowledgeMaintenanceRuns.push({ ...result, lane: "fast_run_evidence" });
                lastFastMaintenanceReportIso = completedAt;
                const epoch = activeSchedulerEpoch(store, runId);
                let progress: EpochProgressSummary | null = null;
                let priorityRefreshes = 0;
                let availabilityRefreshInserted = 0;
                if (epoch) {
                  recordSchedulerEpochFastRefresh(store, epoch.id);
                  const board = loadKnowledgeBoardSnapshot(globals.repoRoot, schedulerEpochConfig.candidateWindow, {
                    excludeSourcePaths: sourceListArg(args, "--exclude-sources"),
                    graphDbPath,
                    objdiffPath: globals.project?.validation.objdiffPath,
                    projectId: globals.project?.projectId ?? globals.projectId,
                    reportPath: globals.project?.validation.reportPath,
                  });
                  priorityRefreshes = refreshEpochTargetPriorities(store, {
                    epochId: epoch.id,
                    runId,
                    candidates: board.candidates,
                  }).refreshed;
                  const availabilityRefresh = refreshEpochTargetAvailability(store, epoch.id);
                  availabilityRefreshInserted = availabilityRefresh.inserted;
                  if (availabilityRefreshInserted > 0) {
                    epochAvailabilityRefreshes += 1;
                    epochTargetsMadeAvailable += availabilityRefreshInserted;
                  }
                  progress = schedulerEpochProgress(store, epoch.id);
                  lastSchedulerEpoch = progress;
                  epochPriorityRefreshes += priorityRefreshes;
                }
                addEvent(store, runId, "epoch_fast_refresh_finished", "run-loop", {
                  epoch_id: epoch?.id ?? null,
                  reports_since_refresh: fastDecision.reportsSinceRefresh,
                  priority_refreshes: priorityRefreshes,
                  ready_refill_inserted: availabilityRefreshInserted,
                  progress,
                  created_by: "run-loop",
                });
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                fastKnowledgeMaintenanceErrors.push({ error: message });
                addEvent(store, runId, "epoch_fast_refresh_finished", "run-loop", {
                  status: "error",
                  error: message.slice(0, 2000),
                  created_by: "run-loop",
                });
              })
              .finally(() => {
                if (runningFastKnowledgeMaintenance === task) runningFastKnowledgeMaintenance = null;
              });
            runningFastKnowledgeMaintenance = task;
            didWork = true;
          }
        }
      }

      if (!drainRequested && epochCycleEnabled) {
        if (
          !runningEpoch &&
          nowMs >= nextEpochAllowedMs &&
          !epochPaused &&
          shouldRefreshSchedulerBoard({ iterationsCompleted: iterations, nowMs, nextRefreshMs: nextPriorityRefreshMs })
        ) {
          nextPriorityRefreshMs = Date.now() + boardRefreshMs;
          const epochResult = ensureSchedulerEpochFromBoard({
            config: schedulerEpochConfig,
            globals,
            graphDbPath,
            runId,
            store,
          });
          lastSchedulerEpoch = epochResult.progress;
          const admittedNow = (epochResult.admission?.admitted ?? 0) + (epochResult.existingAdmission?.admitted ?? 0);
          const madeAvailableNow = (epochResult.admission?.admitted ?? 0) + epochResult.availabilityRefresh.inserted;
          if (admittedNow > 0) {
            epochAdmissions += 1;
            epochTargetsAdmitted += admittedNow;
          }
          if (epochResult.availabilityRefresh.inserted > 0) epochAvailabilityRefreshes += 1;
          if (epochResult.priorityRefreshes > 0) epochPriorityRefreshes += epochResult.priorityRefreshes;
          if (madeAvailableNow > 0 || epochResult.priorityRefreshes > 0) didWork = true;
          epochTargetsMadeAvailable += madeAvailableNow;

          if (admittedNow > 0) {
            addEvent(store, runId, "epoch_admitted", "run-loop", {
              epoch_id: epochResult.epoch.id,
              ordinal: epochResult.progress.ordinal,
              admitted: epochResult.progress.admitted,
              admitted_now: admittedNow,
              available: epochResult.progress.available,
              size: epochResult.progress.size,
              created_by: "run-loop",
            });
          }

          if (epochResult.progress.admitted === 0 && targetPressureBefore.activeWorkers === 0 && targetPressureBefore.admittedTargets === 0) {
            closeSchedulerEpoch(store, epochResult.epoch.id, {
              status: "exhausted",
              boundaryStatus: "board_exhausted",
              routingSummary: { trigger: "admission", board_exhausted: epochResult.boardExhausted },
            });
            addEvent(store, runId, "epoch_exhausted", "run-loop", {
              epoch_id: epochResult.epoch.id,
              ordinal: epochResult.progress.ordinal,
              size: epochResult.progress.size,
              created_by: "run-loop",
            });
            nextEpochAllowedMs = Date.now() + epochRetryMs;
          } else if (epochResult.progress.admitted > 0 && epochResult.progress.remaining === 0 && epochResult.progress.claimed === 0 && runningWorkers.size === 0) {
            didWork = true;
            launchEpochCycle(`scheduler epoch ${epochResult.progress.ordinal} completed`, epochResult.epoch.id);
          }
        }
      }

      if (!drainRequested && providerPausedSinceMs != null && !runningProviderProbe && Date.now() >= nextProviderProbeMs) {
        const probeDir = resolve(globals.stateDir, "runs", runId, "provider_probes");
        let probeTask: Promise<void>;
        probeTask = probeProvider(globals, probeDir, runId)
          .then((probe) => {
            if (probe.healthy) {
              const pausedForMs = Date.now() - (providerPausedSinceMs ?? Date.now());
              console.error(`[run-loop] provider probe succeeded after ${Math.round(pausedForMs / 1000)}s paused; resuming worker spawns`);
              providerPausedSinceMs = null;
              providerProbeBackoffMs = PROVIDER_PROBE_INITIAL_BACKOFF_MS;
            } else {
              lastProviderError = probe.error ?? lastProviderError;
              providerProbeBackoffMs = Math.min(providerProbeBackoffMs * 2, PROVIDER_PROBE_MAX_BACKOFF_MS);
              nextProviderProbeMs = Date.now() + providerProbeBackoffMs;
              console.error(
                `[run-loop] provider probe failed (${probe.error ?? "unknown"}); next probe in ${Math.round(providerProbeBackoffMs / 1000)}s`,
              );
            }
          })
          .finally(() => {
            if (runningProviderProbe === probeTask) runningProviderProbe = null;
          });
        runningProviderProbe = probeTask;
      }

      // Rank 1 — pending-claim watchdog. Reap workers stuck in the pre-claim path (spawned,
      // in runningWorkerIds, but holding no active claim) so they stop pinning openSlots to 0
      // and blocking replacement spawns. Runs once per iteration, before the spawn gate.
      reapStuckPendingWorkers({
        workerProcs: runningWorkerProcs,
        claimedWorkerIds: activeClaimedWorkerIds(store, runId, runningWorkerIds),
        nowMs: Date.now(),
        timeoutMs: PENDING_CLAIM_TIMEOUT_MS,
        onReap: (workerId, ageMs) => {
          console.error(`[run-loop] reaping stuck pre-claim worker ${workerId} after ${ageMs}ms without an active claim`);
          addEvent(store, runId, "pending_worker_reaped", "run-loop", { worker_id: workerId, age_ms: ageMs, created_by: "run-loop" });
        },
      });

      const activeWorkers = activeWorkerCount(store, runId);
      const activeLocalWorkers = activeLocalWorkerCount(store, runId, runningWorkerIds);
      const schedulableTargets = schedulableTargetCount(store, runId, targetFilter);
      const openSlots = workerOpenSlots({
        maxWorkers,
        activeWorkers,
        runningWorkers: runningWorkers.size,
        activeLocalWorkers,
      });
      const iterationBudgetExhausted = maxIterations > 0 && iterations >= maxIterations;
      const workersToStart = drainRequested || providerPausedSinceMs != null || iterationBudgetExhausted ? 0 : Math.min(openSlots, schedulableTargets);
      // Rank 0 — instrumentation: the spawn gate is starving despite open demand (should be
      // rare once the watchdog reaps pins; a persistent hit means a slot is stuck pre-claim).
      if (workersToStart === 0 && !drainRequested && providerPausedSinceMs == null && !iterationBudgetExhausted && schedulableTargets > 0 && activeWorkers < maxWorkers) {
        console.error(
          `[run-loop] spawn-starved: openSlots=${openSlots} activeWorkers=${activeWorkers} activeLocalWorkers=${activeLocalWorkers} runningWorkers=${runningWorkers.size} pendingLocalWorkers=${Math.max(0, runningWorkers.size - activeLocalWorkers)} schedulableTargets=${schedulableTargets}`,
        );
      }
      for (let index = 0; index < workersToStart; index += 1) {
        workerOrdinal += 1;
        workersStarted += 1;
        didWork = true;
        const workerId = `runloop-${process.pid}-${workerOrdinal}-${randomUUID().slice(0, 8)}`;
        let task: Promise<void>;
        task = runWorkerProcess(
          globals,
          {
            runId,
            workerId,
            baseRev,
            ttlSeconds,
            thinkingLevel: workerThinkingLevel,
            postReturnCheckCommand,
            workerConfigureCommand,
            graphDbPath,
            targetFilter,
          },
          runningWorkerProcs,
        )
          .then((result) => {
            workerResults.push(result);
            // Provider failures return the target to admitted and pause spawning until a probe
            // succeeds — the provider being down is not the pool's fault, so it never
            // trips exit-on-worker-error.
            if (result.providerFailure) {
              lastProviderError = result.error ?? "provider error";
              if (providerPausedSinceMs == null) {
                providerPausedSinceMs = Date.now();
                providerPauses += 1;
                providerProbeBackoffMs = PROVIDER_PROBE_INITIAL_BACKOFF_MS;
                nextProviderProbeMs = Date.now() + providerProbeBackoffMs;
                console.error(
                  `[run-loop] provider failure from ${workerId}: ${lastProviderError}; pausing worker spawns until a provider probe succeeds`,
                );
              }
              return;
            }
            // failed is set only for explicit tool_error (infrastructure) results;
            // needs_rework gate rejections and heuristic tool_error guesses are normal
            // completions and never trip exit-on-worker-error.
            if (result.failed) {
              workerErrors.push({
                workerId,
                error: result.error ?? `Worker state closed as ${result.lifecycleStatus}`,
              });
              if (exitOnWorkerError) {
                stopRequested = true;
                stoppedReason = "worker_error";
              }
            }
          })
          .catch((error) => {
            workerErrors.push({
              workerId,
              error: error instanceof Error ? error.message : String(error),
            });
            if (exitOnWorkerError) {
              stopRequested = true;
              stoppedReason = "worker_error";
            }
          })
          .finally(() => {
            runningWorkers.delete(task);
            runningWorkerIds.delete(workerId);
          });
        runningWorkers.add(task);
        runningWorkerIds.add(workerId);
      }

      // Auto integration-conflict resolver gate (opt-in via --auto-resolve-conflicts). Launch
      // one resolver subprocess per queued conflict on the --resolver-* model (e.g. glm) so the
      // campaign worker's model is not burned on merges. Not gated on providerPaused: the
      // resolver runs a different provider than the (possibly-paused) worker provider.
      if (autoResolveConflicts && !drainRequested) {
        const runningItemIds = new Set(runningConflictResolvers.keys());
        const pendingItemIds = pendingConflictIntegrationIds(store, runId);
        const toLaunch = selectConflictItemsToLaunch({
          pendingItemIds,
          runningItemIds,
          cap: resolverMaxConcurrency,
          exhaustedItemIds: conflictResolverExhausted,
        });
        for (const itemId of toLaunch) {
          const paths = conflictItemArtifactPaths(globals.stateDir, runId, itemId);
          if (!existsSync(paths.itemPath)) continue; // conflict item file not written yet; retry next tick
          const attempts = (conflictResolverAttempts.get(itemId) ?? 0) + 1;
          conflictResolverAttempts.set(itemId, attempts);
          if (attempts >= resolverMaxAttempts) conflictResolverExhausted.add(itemId);
          didWork = true;
          spawnConflictResolver(
            globals,
            {
              itemId,
              runId,
              itemPath: paths.itemPath,
              queueSummaryPath: paths.queueSummaryPath,
              resolverProvider: resolverModelConfig.provider,
              resolverModel: resolverModelConfig.model,
              resolverThinkingLevel: resolverModelConfig.thinkingLevel,
            },
            runningConflictResolvers,
          );
          console.error(`[run-loop] auto-resolving integration conflict ${itemId} on ${resolverModelConfig.provider}/${resolverModelConfig.model} (attempt ${attempts})`);
          addEvent(store, runId, "worker_integration_resolver_launched", "run-loop", {
            id: itemId,
            resolver_provider: resolverModelConfig.provider,
            resolver_model: resolverModelConfig.model,
            attempt: attempts,
            created_by: "run-loop",
          });
        }
      }

      if (!drainRequested && !runningScheduler && nextUnhandledEvent(store, runId)) {
        const tickArgs = schedulerTickArgs(args, { admissionTargetSize: workerPoolTargetSize, candidateLimit, candidateWindow, runId });
        let task: Promise<void>;
        task = runSchedulerTick(globals, tickArgs)
          .then((result) => {
            schedulerResults.push(result);
            if (result.schedulerEpoch) lastSchedulerEpoch = result.schedulerEpoch;
            const admittedByTick = (result.epochAdmission?.admitted ?? 0) + (result.existingEpochAdmission?.admitted ?? 0);
            if (admittedByTick > 0) {
              epochAdmissions += 1;
              epochTargetsAdmitted += admittedByTick;
            }
            if ((result.epochAvailabilityRefresh?.inserted ?? 0) > 0) epochAvailabilityRefreshes += 1;
            epochTargetsMadeAvailable += (result.epochAdmission?.admitted ?? 0) + (result.epochAvailabilityRefresh?.inserted ?? 0);
            epochPriorityRefreshes += result.epochPriorityRefreshes ?? 0;
          })
          .catch((error) => {
            schedulerResults.push({
              runId,
              eventType: "scheduler_error",
              eventProducer: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            if (runningScheduler === task) runningScheduler = null;
          });
        runningScheduler = task;
        didWork = true;
      }

      if (didWork || runningWorkers.size === 0) iterations += 1;
      if (didWork || runningWorkers.size > 0 || runningEpoch || runningFastKnowledgeMaintenance) idleIterations = 0;
      else idleIterations += 1;

      if (maxIdleIterations > 0 && idleIterations >= maxIdleIterations && unhandledEventCount(store, runId) === 0) {
        stoppedReason = "idle";
        break;
      }
      if (maxIterations > 0 && iterations >= maxIterations && runningWorkers.size === 0 && !runningEpoch) {
        stoppedReason = "max_iterations";
        break;
      }
      if (
        drainRequested &&
        runningWorkers.size === 0 &&
        !runningEpoch &&
        !runningScheduler &&
        !runningFastKnowledgeMaintenance &&
        !runningKnowledgeMaintenance &&
        !runningProviderProbe
      ) {
        stoppedReason = "drained";
        break;
      }

      await waitForRestingTrigger(runningWorkers, idleSleepMs, [runningEpoch, runningFastKnowledgeMaintenance]);
    }

    if (runningWorkers.size > 0) {
      // A stopped pool must not wedge for hours awaiting worker TTLs (workers
      // ignore SIGTERM). Give in-flight workers a short grace, then kill them;
      // claim recovery returns any interrupted active targets to admitted state.
      addEvent(store, runId, "pool_stopping", "run-loop", {
        reason: stoppedReason,
        running_workers: runningWorkers.size,
        created_by: "run-loop",
      });
      const grace = new Promise<void>((resolveGrace) => setTimeout(resolveGrace, 30_000));
      await Promise.race([Promise.allSettled([...runningWorkers]).then(() => undefined), grace]);
      for (const { proc } of runningWorkerProcs.values()) proc.kill(9);
      await Promise.allSettled([...runningWorkers]);
    }
    // Kill any in-flight conflict resolvers on shutdown; their items stay 'conflict' and are
    // re-launched on the next run (bounded by the retry cap).
    for (const { proc } of runningConflictResolvers.values()) proc.kill(9);
    if (runningEpoch) await runningEpoch;
    if (runningScheduler) await runningScheduler;
    if (runningFastKnowledgeMaintenance) await runningFastKnowledgeMaintenance;
    if (runningKnowledgeMaintenance) await runningKnowledgeMaintenance;
    if (runningProviderProbe) await runningProviderProbe;
    if (stoppedReason === "running") stoppedReason = "complete";
    const finalActiveSchedulerEpoch = activeSchedulerEpoch(store, runId);
    const finalSchedulerEpoch = lastSchedulerEpoch ?? (finalActiveSchedulerEpoch ? schedulerEpochProgress(store, finalActiveSchedulerEpoch.id) : null);

    return {
      runId,
      mode: "run_loop",
      stoppedReason,
      iterations,
      idleIterations,
      desiredWorkers: run.desiredWorkers,
      maxWorkers,
      schedulerTicks: schedulerResults.filter((result) => result.status !== "no_unhandled_events").length,
      epochCycle: epochCycleEnabled,
      epochCycles,
      schedulerEpoch: finalSchedulerEpoch,
      epochAdmissions,
      epochAvailabilityRefreshes,
      epochTargetsAdmitted,
      epochErrors,
      epochPaused,
      lastEpoch,
      epochPriorityRefreshes,
      epochTargetsMadeAvailable,
      workersStarted,
      workerResults,
      workerErrors,
      providerPauses,
      providerPaused: providerPausedSinceMs != null,
      lastProviderError,
      knowledgeMaintenanceRuns,
      knowledgeMaintenanceErrors,
      fastKnowledgeMaintenanceRuns,
      fastKnowledgeMaintenanceErrors,
      dryRun: globals.dryRunAgents,
      finalStatus: {
        activeWorkers: activeWorkerCount(store, runId),
        admittedTargets: admittedTargetCount(store, runId),
        blockedAdmittedTargets: blockedAdmittedTargetCount(store, runId),
        schedulableTargets: schedulableTargetCount(store, runId, targetFilter),
        unhandledEvents: unhandledEventCount(store, runId),
      },
    };
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGUSR1", drain);
    store.db.close();
  }
}

export async function runLoop(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  console.log(JSON.stringify(await runRunLoop(globals, args), null, 2));
}
