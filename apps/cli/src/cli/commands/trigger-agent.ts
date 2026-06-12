import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadKnowledgeBoardSnapshot, packageRoot, resourceGraphDbPath } from "@decomp-orchestrator/knowledge";
import {
  activeWorkerCount,
  addEvent,
  blockedQueuedTargetCount,
  DEFAULT_WORKER_TTL_SECONDS,
  getLatestRun,
  getRun,
  listSavePoints,
  nextUnhandledEvent,
  openState,
  queuedTargetCount,
  refillQueuedTargets,
  schedulableTargetCount,
  unhandledEventCount,
  unhandledPoolEventCount,
  type QueueRefillResult,
  type StateStore,
} from "@decomp-orchestrator/core/state";
import { withBusyRetry } from "@decomp-orchestrator/core/state/db";
import { runEpochCycle, type EpochCycleResult } from "@decomp-orchestrator/core/epoch";
import { runPiAgent } from "@decomp-orchestrator/agents/runtime";
import { booleanArg, numberArg, stringArg, workerReportTypeArg, type GlobalArgs } from "../args.js";
import { assertSchedulableRun } from "./shared.js";
import { runDirectorTick, type DirectorTickResult } from "./tick.js";
import type { WorkerCycleResult } from "./worker.js";
import { runKnowledgeMaintenance } from "./kg.js";

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

interface QueuePressureSnapshot {
  activeWorkers: number;
  blockedQueuedTargets: number;
  candidateLimit: number;
  candidateWindow: number;
  maxWorkers: number;
  openSlots: number;
  queuedTargets: number;
  queueTargetSize: number;
  runningWorkers: number;
  schedulableTargets: number;
}

interface ReplanPolicy {
  activeLowWatermark: number;
  blockedQueueReplan: boolean;
  longTailReplanMs: number;
  queueLowWatermark: number;
  replanCooldownMs: number;
  replanIntervalMs: number;
  schedulableLowWatermark: number;
}

interface ReplanState {
  lastQueueRefill?: QueueRefillResult | null;
  lastPeriodicReplanMs: number;
  lastReplanRequestMs: number;
  longTailSinceMs: number | null;
  nowMs: number;
}

export interface ReplanDecision {
  reason:
    | "active_low_watermark"
    | "blocked_queue_pressure"
    | "long_tail_timeout"
    | "periodic_replan"
    | "queue_refill_exhausted"
    | "queue_low_watermark"
    | "schedulable_refill_exhausted"
    | "schedulable_low_watermark";
  longTailSinceMs: number | null;
}

export interface TriggerAgentResult {
  runId: string;
  mode: "trigger_agent";
  stoppedReason: string;
  iterations: number;
  idleIterations: number;
  desiredWorkers: number;
  maxWorkers: number;
  directorTicks: number;
  epochCycle: boolean;
  epochCycles: number;
  epochErrors: EpochError[];
  epochPaused: boolean;
  lastEpoch?: EpochCycleResult;
  queueRefills: number;
  queuePriorityRefreshes: number;
  queueTargetsAdded: number;
  lastQueueRefill?: QueueRefillResult;
  workersStarted: number;
  workerResults: WorkerCycleResult[];
  workerErrors: WorkerError[];
  providerPauses: number;
  providerPaused: boolean;
  lastProviderError?: string;
  knowledgeMaintenanceRuns: Record<string, unknown>[];
  knowledgeMaintenanceErrors: KnowledgeMaintenanceError[];
  dryRun: boolean;
  finalStatus: {
    activeWorkers: number;
    blockedQueuedTargets: number;
    queuedTargets: number;
    schedulableTargets: number;
    unhandledEvents: number;
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROVIDER_PROBE_INITIAL_BACKOFF_MS = 30_000;
const PROVIDER_PROBE_MAX_BACKOFF_MS = 300_000;

// Cheapest truthful health check: a tiny no-tools session through the exact provider
// path workers use. An LB liveness endpoint can say "ok" while its upstream account
// pool is exhausted; a completion can't lie.
async function probeProvider(globals: GlobalArgs, outputDir: string): Promise<{ healthy: boolean; error?: string }> {
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
  return resolve(import.meta.dir, "../../../../..");
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
            FROM leases
            JOIN queue ON leases.queue_id = queue.id
            WHERE queue.run_id = ?
              AND leases.status = 'active'
              AND leases.worker_id IN (${placeholders})
          `,
        )
        .get(runId, ...ids) as Record<string, unknown>,
  );
  return Number(row.count ?? 0);
}

export function workerOpenSlots(params: { maxWorkers: number; activeWorkers: number; runningWorkers: number; activeLocalWorkers: number }): number {
  const pendingLocalWorkers = Math.max(0, params.runningWorkers - params.activeLocalWorkers);
  return Math.max(0, params.maxWorkers - params.activeWorkers - pendingLocalWorkers);
}

function longTailActive(snapshot: QueuePressureSnapshot, policy: ReplanPolicy): boolean {
  const hasLiveWork = snapshot.activeWorkers > 0 || snapshot.runningWorkers > 0;
  const underfilled = snapshot.activeWorkers < snapshot.maxWorkers || snapshot.openSlots > 0;
  const queueLow = snapshot.queuedTargets <= policy.queueLowWatermark;
  const schedulableLow = snapshot.schedulableTargets <= policy.schedulableLowWatermark;
  const blockedPressure = policy.blockedQueueReplan && snapshot.blockedQueuedTargets > 0 && snapshot.openSlots > 0 && snapshot.schedulableTargets < snapshot.openSlots;
  return (
    hasLiveWork &&
    snapshot.maxWorkers > 0 &&
    underfilled &&
    snapshot.activeWorkers <= policy.activeLowWatermark &&
    (queueLow || blockedPressure || schedulableLow || snapshot.blockedQueuedTargets > 0)
  );
}

function nextLongTailSinceMs(snapshot: QueuePressureSnapshot, policy: ReplanPolicy, previous: number | null, nowMs: number): number | null {
  return longTailActive(snapshot, policy) ? previous ?? nowMs : null;
}

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function candidateLimitArg(args: Map<string, string | true>, maxWorkers: number): number {
  return nonNegativeInt(numberArg(args, "--candidate-limit", Math.max(32, maxWorkers * 2)));
}

function queueTargetSizeArg(args: Map<string, string | true>, params: { candidateLimit: number; maxWorkers: number }): number {
  return nonNegativeInt(numberArg(args, "--queue-target-size", Math.max(params.candidateLimit, params.maxWorkers * 2)));
}

function candidateWindowArg(args: Map<string, string | true>, params: { candidateLimit: number; queueTargetSize: number }): number {
  const fallback = Math.max(params.candidateLimit, params.queueTargetSize * 8);
  return Math.max(params.candidateLimit, params.queueTargetSize, nonNegativeInt(numberArg(args, "--candidate-window", fallback)));
}

function nextCandidateWindow(current: number): number {
  if (current <= 0) return 1;
  return current * 2;
}

function replanPolicy(args: Map<string, string | true>, params: { maxWorkers: number; queueTargetSize: number }): ReplanPolicy {
  return {
    activeLowWatermark: nonNegativeInt(numberArg(args, "--active-low-watermark", Math.ceil(params.maxWorkers * 0.75))),
    blockedQueueReplan: !booleanArg(args, "--no-blocked-queue-replan"),
    longTailReplanMs: nonNegativeInt(numberArg(args, "--long-tail-replan-ms", 5 * 60_000)),
    queueLowWatermark: nonNegativeInt(numberArg(args, "--queue-low-watermark", Math.ceil(params.queueTargetSize * 0.25))),
    replanCooldownMs: nonNegativeInt(numberArg(args, "--replan-cooldown-ms", 5 * 60_000)),
    replanIntervalMs: nonNegativeInt(numberArg(args, "--replan-interval-ms", 0)),
    schedulableLowWatermark: nonNegativeInt(numberArg(args, "--schedulable-low-watermark", params.maxWorkers)),
  };
}

function queueSnapshot(params: {
  candidateLimit: number;
  candidateWindow: number;
  maxWorkers: number;
  queueTargetSize: number;
  runningWorkers: Set<Promise<void>>;
  runningWorkerIds: Set<string>;
  runId: string;
  store: StateStore;
}): QueuePressureSnapshot {
  const activeWorkers = activeWorkerCount(params.store, params.runId);
  const activeLocalWorkers = activeLocalWorkerCount(params.store, params.runId, params.runningWorkerIds);
  const openSlots = workerOpenSlots({
    maxWorkers: params.maxWorkers,
    activeWorkers,
    runningWorkers: params.runningWorkers.size,
    activeLocalWorkers,
  });
  return {
    activeWorkers,
    blockedQueuedTargets: blockedQueuedTargetCount(params.store, params.runId),
    candidateLimit: params.candidateLimit,
    candidateWindow: params.candidateWindow,
    maxWorkers: params.maxWorkers,
    openSlots,
    queuedTargets: queuedTargetCount(params.store, params.runId),
    queueTargetSize: params.queueTargetSize,
    runningWorkers: params.runningWorkers.size,
    schedulableTargets: schedulableTargetCount(params.store, params.runId),
  };
}

function shouldAttemptQueueRefill(snapshot: QueuePressureSnapshot, policy: ReplanPolicy): boolean {
  const blockedPressure =
    policy.blockedQueueReplan && snapshot.blockedQueuedTargets > 0 && snapshot.openSlots > 0 && snapshot.schedulableTargets < snapshot.openSlots;
  return (
    snapshot.queuedTargets < snapshot.queueTargetSize ||
    snapshot.schedulableTargets < Math.min(snapshot.maxWorkers, policy.schedulableLowWatermark) ||
    blockedPressure
  );
}

function combineRefillResults(previous: QueueRefillResult | null, next: QueueRefillResult): QueueRefillResult {
  if (!previous) return next;
  return {
    ...next,
    inserted: previous.inserted + next.inserted,
    refreshed: previous.refreshed + next.refreshed,
    queuedBefore: previous.queuedBefore,
    schedulableBefore: previous.schedulableBefore,
  };
}

export function refillQueueFromBoard(params: {
  forceRefresh?: boolean;
  globals: GlobalArgs;
  graphDbPath?: string;
  policy: ReplanPolicy;
  runId: string;
  snapshot: QueuePressureSnapshot;
  store: StateStore;
}): QueueRefillResult | null {
  if (!shouldAttemptQueueRefill(params.snapshot, params.policy) && !params.forceRefresh) return null;
  const targetSize = params.snapshot.queueTargetSize;
  const minSchedulableSources = Math.min(params.snapshot.maxWorkers, params.policy.schedulableLowWatermark);
  let candidateWindow = params.snapshot.candidateWindow;
  let combined: QueueRefillResult | null = null;

  for (;;) {
    const board = loadKnowledgeBoardSnapshot(params.globals.repoRoot, candidateWindow, {
      graphDbPath: params.graphDbPath ?? params.globals.graphDbPath ?? resourceGraphDbPath(),
    });
    const refill = refillQueuedTargets(params.store, params.runId, board.candidates, {
      targetSize,
      minSchedulableSources,
    });
    combined = combineRefillResults(combined, refill);

    const targetSatisfied = combined.queuedAfter >= targetSize && combined.schedulableAfter >= minSchedulableSources;
    const boardExhausted = board.candidates.length < candidateWindow;
    if (targetSatisfied || boardExhausted) return combined;

    const nextWindow = nextCandidateWindow(candidateWindow);
    if (nextWindow <= candidateWindow) return combined;
    candidateWindow = nextWindow;
  }
}

function exhaustedRefillDecision(refill: QueueRefillResult | null | undefined, longTailSinceMs: number | null): ReplanDecision | null {
  if (!refill) return null;
  if (refill.schedulableAfter < refill.minSchedulableSources) {
    return { reason: "schedulable_refill_exhausted", longTailSinceMs };
  }
  if (refill.queuedAfter < refill.targetSize) {
    return { reason: "queue_refill_exhausted", longTailSinceMs };
  }
  return null;
}

export function evaluateReplanDecision(snapshot: QueuePressureSnapshot, policy: ReplanPolicy, state: ReplanState): ReplanDecision | null {
  const hasLiveWork = snapshot.activeWorkers > 0 || snapshot.runningWorkers > 0;
  const hasCapacityPressure = hasLiveWork && snapshot.maxWorkers > 0;
  const underfilled = snapshot.activeWorkers < snapshot.maxWorkers || snapshot.openSlots > 0;
  const schedulableLow = snapshot.schedulableTargets <= policy.schedulableLowWatermark;
  const queueLow = snapshot.queuedTargets <= policy.queueLowWatermark;
  const blockedPressure = policy.blockedQueueReplan && snapshot.blockedQueuedTargets > 0 && snapshot.openSlots > 0 && snapshot.schedulableTargets < snapshot.openSlots;
  const longTailSinceMs = nextLongTailSinceMs(snapshot, policy, state.longTailSinceMs, state.nowMs);
  const cooldownActive = policy.replanCooldownMs > 0 && state.nowMs - state.lastReplanRequestMs < policy.replanCooldownMs;

  if (!hasCapacityPressure) return null;
  if (cooldownActive) return null;

  const exhaustedRefill = exhaustedRefillDecision(state.lastQueueRefill, longTailSinceMs);
  if (exhaustedRefill) return exhaustedRefill;
  if (policy.replanIntervalMs > 0 && state.nowMs - state.lastPeriodicReplanMs >= policy.replanIntervalMs) {
    return { reason: "periodic_replan", longTailSinceMs };
  }
  if (blockedPressure) return { reason: "blocked_queue_pressure", longTailSinceMs };
  if (queueLow) return { reason: "queue_low_watermark", longTailSinceMs };
  if (underfilled && schedulableLow) return { reason: "schedulable_low_watermark", longTailSinceMs };
  if (longTailSinceMs != null && policy.longTailReplanMs > 0 && state.nowMs - longTailSinceMs >= policy.longTailReplanMs) {
    return { reason: "long_tail_timeout", longTailSinceMs };
  }
  if (underfilled && snapshot.activeWorkers > 0 && snapshot.activeWorkers <= policy.activeLowWatermark && (queueLow || snapshot.blockedQueuedTargets > 0)) {
    return { reason: "active_low_watermark", longTailSinceMs };
  }

  return null;
}

function writeReplanEvent(
  store: StateStore,
  runId: string,
  decision: ReplanDecision,
  snapshot: QueuePressureSnapshot,
  policy: ReplanPolicy,
  refill?: QueueRefillResult | null,
): string {
  return addEvent(store, runId, "pool_below_target", "trigger-agent", {
    reason: decision.reason,
    snapshot,
    policy,
    refill: refill ?? null,
    created_by: "trigger-agent",
  });
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

function knowledgeMaintenanceIntervalMs(globals: GlobalArgs, args: Map<string, string | true>): number {
  if (booleanArg(args, "--no-knowledge-maintenance")) return 0;
  const fallback = globals.dryRunAgents ? 0 : 5 * 60_000;
  return Math.max(0, Math.floor(numberArg(args, "--knowledge-maintenance-interval-ms", fallback)));
}

/** Completed leases (any worker report except provider_error) after the given time. */
function completedLeaseCountSince(store: StateStore, runId: string, sinceIso: string): number {
  const row = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT COUNT(*) AS count
            FROM worker_reports
            JOIN leases ON leases.id = worker_reports.lease_id
            JOIN queue ON queue.id = leases.queue_id
            WHERE queue.run_id = ?
              AND worker_reports.report_type != 'provider_error'
              AND worker_reports.created_at > ?
          `,
        )
        .get(runId, sinceIso) as Record<string, unknown> | undefined,
  );
  return Number(row?.count ?? 0);
}

async function waitForRestingTrigger(runningWorkers: Set<Promise<void>>, idleSleepMs: number, extras: Array<Promise<void> | null> = []): Promise<void> {
  const live = [...runningWorkers, ...extras.filter((task): task is Promise<void> => task != null)];
  if (live.length === 0) {
    await sleep(idleSleepMs);
    return;
  }
  await Promise.race([sleep(idleSleepMs), ...live]);
}

function directorTickArgs(
  args: Map<string, string | true>,
  params: { candidateLimit: number; candidateWindow: number; queueTargetSize: number; runId: string },
): Map<string, string | true> {
  return cloneArgs(args, [
    ["--run-id", params.runId],
    ["--candidate-limit", String(params.candidateLimit)],
    ["--candidate-window", String(params.candidateWindow)],
    ["--queue-target-size", String(params.queueTargetSize)],
  ]);
}

function workerCommand(
  globals: GlobalArgs,
  params: {
    runId: string;
    workerId: string;
    reportType: string;
    baseRev: string;
    ttlSeconds: number;
    thinkingLevel: string;
    repairAttempts: number;
    postReturnCheckCommand: string;
    graphDbPath: string;
  },
): string[] {
  const bin = resolve(orchestratorRoot(), "apps/cli/src/bin/decomp-orchestrator.ts");
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
  command.push(
    "worker",
    "--run-id",
    params.runId,
    "--worker-id",
    params.workerId,
    "--report-type",
    params.reportType,
    "--base-rev",
    params.baseRev,
    "--ttl-seconds",
    String(params.ttlSeconds),
    "--repair-attempts",
    String(params.repairAttempts),
  );
  if (params.postReturnCheckCommand) command.push("--post-return-check-command", params.postReturnCheckCommand);
  command.push("--graph-db", params.graphDbPath);
  return command;
}

async function runWorkerProcess(
  globals: GlobalArgs,
  params: {
    runId: string;
    workerId: string;
    reportType: string;
    baseRev: string;
    ttlSeconds: number;
    thinkingLevel: string;
    repairAttempts: number;
    postReturnCheckCommand: string;
    graphDbPath: string;
  },
  procRegistry?: Set<{ kill: (signal?: number) => void; exited: Promise<number> }>,
): Promise<WorkerCycleResult> {
  const command = workerCommand(globals, params);
  const proc = Bun.spawn(command, {
    cwd: orchestratorRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  procRegistry?.add(proc);
  void proc.exited.finally(() => procRegistry?.delete(proc));
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

export async function runTriggerAgent(globals: GlobalArgs, args: Map<string, string | true>): Promise<TriggerAgentResult> {
  const store = openState(globals.stateDir);
  const workerResults: WorkerCycleResult[] = [];
  const workerErrors: WorkerError[] = [];
  const directorResults: DirectorTickResult[] = [];
  const knowledgeMaintenanceRuns: Record<string, unknown>[] = [];
  const knowledgeMaintenanceErrors: KnowledgeMaintenanceError[] = [];
  const runningWorkers = new Set<Promise<void>>();
  const runningWorkerIds = new Set<string>();
  const runningWorkerProcs = new Set<{ kill: (signal?: number) => void; exited: Promise<number> }>();
  let runningDirector: Promise<void> | null = null;
  let runningKnowledgeMaintenance: Promise<void> | null = null;
  let stoppedReason = "running";
  let stopRequested = false;
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

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const runId = stringArg(args, "--run-id", getLatestRun(store)?.id ?? "");
    if (!runId) throw new Error("No run found. Run init-run first.");
    const run = getRun(store, runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    assertSchedulableRun(run, "trigger-agent");

    const maxIterations = booleanArg(args, "--once") ? 1 : numberArg(args, "--max-iterations", 0);
    const maxIdleIterations = numberArg(args, "--max-idle-iterations", 0);
    const idleSleepMs = numberArg(args, "--idle-sleep-ms", 5_000);
    const requestedMaxWorkers = numberArg(args, "--max-workers", run.desiredWorkers);
    const maxWorkers = Math.max(0, Math.min(run.desiredWorkers, requestedMaxWorkers));
    if (requestedMaxWorkers > run.desiredWorkers) {
      console.error(
        `[trigger-agent] --max-workers ${requestedMaxWorkers} exceeds run desired_workers ${run.desiredWorkers}; clamping to ${maxWorkers}. ` +
          `Raise the run's desired_workers (or re-init with --desired-workers) to use the full pool.`,
      );
    }
    const candidateLimit = nonNegativeInt(numberArg(args, "--candidate-limit", globals.project?.dashboard.candidateLimit ?? Math.max(32, maxWorkers * 2)));
    const queueTargetSize = nonNegativeInt(
      numberArg(args, "--queue-target-size", globals.project?.dashboard.queueTargetSize ?? Math.max(candidateLimit, maxWorkers * 2)),
    );
    const candidateWindow = Math.max(
      candidateLimit,
      queueTargetSize,
      nonNegativeInt(numberArg(args, "--candidate-window", globals.project?.dashboard.candidateWindow ?? Math.max(candidateLimit, queueTargetSize * 8))),
    );
    const reportType = workerReportTypeArg(args, "--report-type", "stalled_no_useful_guess");
    const baseRev = stringArg(args, "--base-rev", "unknown");
    const ttlSeconds = numberArg(args, "--ttl-seconds", DEFAULT_WORKER_TTL_SECONDS);
    const repairAttempts = Math.max(0, Math.trunc(numberArg(args, "--repair-attempts", globals.dryRunAgents ? 0 : 2)));
    const postReturnCheckCommand = stringArg(args, "--post-return-check-command", "");
    const graphDbPath = stringArg(args, "--graph-db", globals.graphDbPath ?? resourceGraphDbPath());
    const exitOnWorkerError = booleanArg(args, "--exit-on-worker-error");
    const workerThinkingLevel = stringArg(args, "--worker-thinking-level", globals.thinkingLevel);
    const maintenanceIntervalMs = knowledgeMaintenanceIntervalMs(globals, args);
    const policy = replanPolicy(args, { maxWorkers, queueTargetSize });
    const epochCycleEnabled = !booleanArg(args, "--no-epoch-cycle");
    const epochWorktreeDir = stringArg(args, "--epoch-worktree", resolve(globals.stateDir, "epoch_worktree"));
    const epochConfigureCommand = stringArg(args, "--epoch-configure-command", "python3 configure.py --require-protos");
    const epochLinkPaths = stringArg(args, "--epoch-link-paths", "orig")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
    const epochPauseThreshold = nonNegativeInt(numberArg(args, "--epoch-regression-pause-threshold", 12));
    const epochRequeueLimit = nonNegativeInt(numberArg(args, "--epoch-regression-requeue-limit", 32));
    const epochRetryMs = nonNegativeInt(numberArg(args, "--epoch-retry-ms", 10 * 60_000));
    // Checkpoint cadence in completed leases. The queue keeps topping up from
    // the board (watermark refill) and the epoch runs every N completions;
    // 0 restores the legacy drain-to-zero mode, where inserts happen only
    // after a checkpoint. Drain-to-zero starves on live runs: the director
    // tops the queue up faster than it empties, so the epoch never fires.
    // Default scales with pool size — 4 full worker rotations per checkpoint —
    // so bigger pools don't checkpoint proportionally more often.
    const epochLeaseInterval = nonNegativeInt(numberArg(args, "--epoch-lease-interval", maxWorkers * 4));
    // Seed from the DB so a pool restart resumes the countdown instead of
    // resetting it — otherwise frequent restarts could postpone checkpoints
    // indefinitely.
    const lastEpochSavePoint = listSavePoints(store, 200).find((savePoint) => savePoint.triggerKind === "epoch");
    let completionsSinceEpoch = completedLeaseCountSince(store, runId, lastEpochSavePoint?.createdAt ?? run.createdAt);
    let runningEpoch: Promise<void> | null = null;
    let nextEpochAllowedMs = 0;
    let epochCycles = 0;
    let epochPaused = false;
    let lastEpoch: EpochCycleResult | undefined;
    const epochErrors: EpochError[] = [];
    let queueRefills = 0;
    let queuePriorityRefreshes = 0;
    let queueTargetsAdded = 0;
    let lastQueueRefill: QueueRefillResult | undefined;
    let lastReplanRequestMs = 0;
    let lastPeriodicReplanMs = Date.now();
    let longTailSinceMs: number | null = null;
    let lastKnowledgeMaintenanceMs = maintenanceIntervalMs > 0 ? 0 : Date.now();
    const queueRefreshIntervalMs = nonNegativeInt(numberArg(args, "--queue-refresh-interval-ms", 60_000));
    let lastQueueRefreshMs = queueRefreshIntervalMs > 0 ? 0 : Date.now();

    while (!stopRequested) {
      let didWork = false;

      if (!runningKnowledgeMaintenance && maintenanceIntervalMs > 0 && Date.now() - lastKnowledgeMaintenanceMs >= maintenanceIntervalMs) {
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

      const beforeRefill = queueSnapshot({
        candidateLimit,
        candidateWindow,
        maxWorkers,
        queueTargetSize,
        runningWorkers,
        runningWorkerIds,
        runId,
        store,
      });
      const nowMs = Date.now();
      const launchEpochCycle = (trigger: string): void => {
        const epochOrdinal = epochCycles + 1;
        let task: Promise<void>;
        task = (async () => {
            try {
              if (globals.dryRunAgents) {
                // Dry runs skip the snapshot/build and refill straight from the
                // current board so the pool keeps cycling in tests.
                epochCycles += 1;
                completionsSinceEpoch = 0;
              } else {
                console.error(`[trigger-agent] epoch ${epochOrdinal}: ${trigger}; snapshotting and rebuilding report`);
                const result = await runEpochCycle(store, runId, globals.repoRoot, globals.stateDir, {
                  baseRef: globals.project?.baseRef,
                  configureCommand: epochConfigureCommand,
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
                epochCycles += 1;
                lastEpoch = result;
                epochPaused = result.repair.paused;
                if (!result.repair.paused) completionsSinceEpoch = 0;
                console.error(
                  `[trigger-agent] epoch ${epochOrdinal}: matched_code ${result.matchedCodePercent ?? "?"}%, ` +
                    `${result.regressions.regressedFunctions} regressed functions, ${result.repair.requeued} repairs requeued, ` +
                    `qa gate ${result.qaGate === null ? "not run" : `${result.qaGate.status} (${result.qaGate.errors} errors, ${result.qaGate.warnings} warnings)`} ` +
                    `(${Math.round(result.durationMs / 1000)}s)`,
                );
                if (result.repair.paused) {
                  addEvent(store, runId, "epoch_regression_pause", "trigger-agent", {
                    epoch: epochOrdinal,
                    qa_gate: result.qaGate,
                    reasons: result.repair.reasons,
                    regressions: result.regressions,
                    save_point_id: result.savePointId,
                    created_by: "trigger-agent",
                  });
                  console.error(`[trigger-agent] epoch ${epochOrdinal}: paused on regressions; retrying in ${Math.round(epochRetryMs / 1000)}s`);
                  nextEpochAllowedMs = Date.now() + epochRetryMs;
                  return;
                }
              }
              const refillSnapshot = queueSnapshot({
                candidateLimit,
                candidateWindow,
                maxWorkers,
                queueTargetSize,
                runningWorkers,
                runningWorkerIds,
                runId,
                store,
              });
              const epochRefill = refillQueueFromBoard({ forceRefresh: true, globals, graphDbPath, policy, runId, snapshot: refillSnapshot, store });
              if (epochRefill) {
                queueRefills += 1;
                queueTargetsAdded += epochRefill.inserted;
                lastQueueRefill = epochRefill;
                if (epochRefill.queuedAfter === 0) {
                  // Board exhausted: hand the long tail to the director and back
                  // off instead of rebuilding the report in a tight loop.
                  if (unhandledPoolEventCount(store, runId) === 0) {
                    writeReplanEvent(store, runId, { reason: "queue_refill_exhausted", longTailSinceMs: null }, refillSnapshot, policy, epochRefill);
                  }
                  nextEpochAllowedMs = Date.now() + epochRetryMs;
                }
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              epochErrors.push({ error: message });
              console.error(`[trigger-agent] epoch ${epochOrdinal} failed: ${message}`);
              addEvent(store, runId, "epoch_cycle_error", "trigger-agent", {
                epoch: epochOrdinal,
                error: message.slice(0, 2000),
                created_by: "trigger-agent",
              });
              nextEpochAllowedMs = Date.now() + epochRetryMs;
            }
        })().finally(() => {
          if (runningEpoch === task) runningEpoch = null;
        });
        runningEpoch = task;
      };

      if (epochCycleEnabled && epochLeaseInterval === 0) {
        // Legacy epoch mode: the queue is a batch that only drains. Queued
        // priorities still refresh periodically, but inserts happen only in
        // the epoch pipeline, after the report has been rebuilt.
        const refreshDue = queueRefreshIntervalMs > 0 && beforeRefill.queuedTargets > 0 && nowMs - lastQueueRefreshMs >= queueRefreshIntervalMs;
        if (refreshDue) {
          const board = loadKnowledgeBoardSnapshot(globals.repoRoot, candidateWindow, { graphDbPath });
          const refreshOnly = refillQueuedTargets(store, runId, board.candidates, { targetSize: 0, minSchedulableSources: 0 });
          lastQueueRefreshMs = nowMs;
          if (refreshOnly.refreshed > 0) {
            queuePriorityRefreshes += refreshOnly.refreshed;
            didWork = true;
          }
        }
        if (beforeRefill.queuedTargets === 0 && !runningEpoch && nowMs >= nextEpochAllowedMs) {
          didWork = true;
          launchEpochCycle("queue drained");
        }
      } else {
        const refillNeeded = shouldAttemptQueueRefill(beforeRefill, policy);
        const refreshDue = queueRefreshIntervalMs > 0 && beforeRefill.queuedTargets > 0 && nowMs - lastQueueRefreshMs >= queueRefreshIntervalMs;
        const refill = refillQueueFromBoard({ forceRefresh: refreshDue, globals, graphDbPath, policy, runId, snapshot: beforeRefill, store });
        if (refill) {
          if (refillNeeded) queueRefills += 1;
          if (refill.refreshed > 0) queuePriorityRefreshes += refill.refreshed;
          queueTargetsAdded += refill.inserted;
          if (refillNeeded) lastQueueRefill = refill;
          if (refreshDue) lastQueueRefreshMs = nowMs;
          if (refill.inserted > 0 || refill.refreshed > 0) didWork = true;
        }

        const replanSnapshot = queueSnapshot({
          candidateLimit,
          candidateWindow,
          maxWorkers,
          queueTargetSize,
          runningWorkers,
          runningWorkerIds,
          runId,
          store,
        });
        const replanDecision = evaluateReplanDecision(replanSnapshot, policy, {
          lastQueueRefill: refill,
          lastPeriodicReplanMs,
          lastReplanRequestMs,
          longTailSinceMs,
          nowMs: Date.now(),
        });
        longTailSinceMs = nextLongTailSinceMs(replanSnapshot, policy, longTailSinceMs, Date.now());
        if (replanDecision && unhandledPoolEventCount(store, runId) === 0) {
          writeReplanEvent(store, runId, replanDecision, replanSnapshot, policy, refill);
          lastReplanRequestMs = Date.now();
          if (replanDecision.reason === "periodic_replan") lastPeriodicReplanMs = lastReplanRequestMs;
          didWork = true;
        }

        // Checkpoint by work done, not queue level: every N completed leases
        // (or when the board is truly exhausted), commit + rebuild the report
        // while the pool keeps running. The epoch commit already excludes
        // files held by active leases, so no drain is needed.
        if (
          epochCycleEnabled &&
          !runningEpoch &&
          nowMs >= nextEpochAllowedMs &&
          (completionsSinceEpoch >= epochLeaseInterval || (completionsSinceEpoch > 0 && replanSnapshot.queuedTargets === 0))
        ) {
          didWork = true;
          launchEpochCycle(`${completionsSinceEpoch} leases completed since last checkpoint`);
        }
      }

      if (providerPausedSinceMs != null && !runningProviderProbe && Date.now() >= nextProviderProbeMs) {
        const probeDir = resolve(globals.stateDir, "runs", runId, "provider_probes");
        let probeTask: Promise<void>;
        probeTask = probeProvider(globals, probeDir)
          .then((probe) => {
            if (probe.healthy) {
              const pausedForMs = Date.now() - (providerPausedSinceMs ?? Date.now());
              console.error(`[trigger-agent] provider probe succeeded after ${Math.round(pausedForMs / 1000)}s paused; resuming worker spawns`);
              providerPausedSinceMs = null;
              providerProbeBackoffMs = PROVIDER_PROBE_INITIAL_BACKOFF_MS;
            } else {
              lastProviderError = probe.error ?? lastProviderError;
              providerProbeBackoffMs = Math.min(providerProbeBackoffMs * 2, PROVIDER_PROBE_MAX_BACKOFF_MS);
              nextProviderProbeMs = Date.now() + providerProbeBackoffMs;
              console.error(
                `[trigger-agent] provider probe failed (${probe.error ?? "unknown"}); next probe in ${Math.round(providerProbeBackoffMs / 1000)}s`,
              );
            }
          })
          .finally(() => {
            if (runningProviderProbe === probeTask) runningProviderProbe = null;
          });
        runningProviderProbe = probeTask;
      }

      const activeWorkers = activeWorkerCount(store, runId);
      const activeLocalWorkers = activeLocalWorkerCount(store, runId, runningWorkerIds);
      const queuedTargets = schedulableTargetCount(store, runId);
      const openSlots = workerOpenSlots({
        maxWorkers,
        activeWorkers,
        runningWorkers: runningWorkers.size,
        activeLocalWorkers,
      });
      const workersToStart = providerPausedSinceMs != null ? 0 : Math.min(openSlots, queuedTargets);
      for (let index = 0; index < workersToStart; index += 1) {
        workerOrdinal += 1;
        workersStarted += 1;
        didWork = true;
        const workerId = `trigger-${process.pid}-${workerOrdinal}-${randomUUID().slice(0, 8)}`;
        let task: Promise<void>;
        task = runWorkerProcess(
          globals,
          {
            runId,
            workerId,
            reportType,
            baseRev,
            ttlSeconds,
            thinkingLevel: workerThinkingLevel,
            repairAttempts,
            postReturnCheckCommand,
            graphDbPath,
          },
          runningWorkerProcs,
        )
          .then((result) => {
            workerResults.push(result);
            // Provider failures requeue their target and pause spawning until a probe
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
                  `[trigger-agent] provider failure from ${workerId}: ${lastProviderError}; pausing worker spawns until a provider probe succeeds`,
                );
              }
              return;
            }
            completionsSinceEpoch += 1;
            // failed is set only for explicit tool_error (infrastructure) results;
            // needs_rework gate rejections and heuristic tool_error guesses are normal
            // completions and never trip exit-on-worker-error.
            if (result.failed) {
              workerErrors.push({
                workerId,
                error: result.error ?? `Worker reported ${result.reportType ?? "error"}`,
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

      if (!runningDirector && nextUnhandledEvent(store, runId)) {
        const tickArgs = directorTickArgs(args, { candidateLimit, candidateWindow, queueTargetSize, runId });
        let task: Promise<void>;
        task = runDirectorTick(globals, tickArgs)
          .then((result) => {
            directorResults.push(result);
          })
          .catch((error) => {
            directorResults.push({
              runId,
              directorPiError: error instanceof Error ? error.message : String(error),
              failed: true,
            });
          })
          .finally(() => {
            if (runningDirector === task) runningDirector = null;
          });
        runningDirector = task;
        didWork = true;
      }

      if (didWork || runningWorkers.size === 0) iterations += 1;
      if (didWork || runningWorkers.size > 0 || runningEpoch) idleIterations = 0;
      else idleIterations += 1;

      if (maxIdleIterations > 0 && idleIterations >= maxIdleIterations && unhandledEventCount(store, runId) === 0) {
        stoppedReason = "idle";
        break;
      }
      if (maxIterations > 0 && iterations >= maxIterations && runningWorkers.size === 0 && !runningEpoch) {
        stoppedReason = "max_iterations";
        break;
      }

      await waitForRestingTrigger(runningWorkers, idleSleepMs, [runningEpoch]);
    }

    if (runningWorkers.size > 0) {
      // A stopped pool must not wedge for hours awaiting worker TTLs (workers
      // ignore SIGTERM). Give in-flight workers a short grace, then kill them;
      // babysit's lease recovery requeues whatever they were holding.
      addEvent(store, runId, "pool_stopping", "trigger-agent", {
        reason: stoppedReason,
        running_workers: runningWorkers.size,
        created_by: "trigger-agent",
      });
      const grace = new Promise<void>((resolveGrace) => setTimeout(resolveGrace, 30_000));
      await Promise.race([Promise.allSettled([...runningWorkers]).then(() => undefined), grace]);
      for (const proc of runningWorkerProcs) proc.kill(9);
      await Promise.allSettled([...runningWorkers]);
    }
    if (runningEpoch) await runningEpoch;
    if (runningDirector) await runningDirector;
    if (runningKnowledgeMaintenance) await runningKnowledgeMaintenance;
    if (runningProviderProbe) await runningProviderProbe;
    if (stoppedReason === "running") stoppedReason = "complete";

    return {
      runId,
      mode: "trigger_agent",
      stoppedReason,
      iterations,
      idleIterations,
      desiredWorkers: run.desiredWorkers,
      maxWorkers,
      directorTicks: directorResults.filter((result) => result.status !== "no_unhandled_events").length,
      epochCycle: epochCycleEnabled,
      epochCycles,
      epochErrors,
      epochPaused,
      lastEpoch,
      queueRefills,
      queuePriorityRefreshes,
      queueTargetsAdded,
      lastQueueRefill,
      workersStarted,
      workerResults,
      workerErrors,
      providerPauses,
      providerPaused: providerPausedSinceMs != null,
      lastProviderError,
      knowledgeMaintenanceRuns,
      knowledgeMaintenanceErrors,
      dryRun: globals.dryRunAgents,
      finalStatus: {
        activeWorkers: activeWorkerCount(store, runId),
        blockedQueuedTargets: blockedQueuedTargetCount(store, runId),
        queuedTargets: queuedTargetCount(store, runId),
        schedulableTargets: schedulableTargetCount(store, runId),
        unhandledEvents: unhandledEventCount(store, runId),
      },
    };
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    store.db.close();
  }
}

export async function triggerAgent(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  console.log(JSON.stringify(await runTriggerAgent(globals, args), null, 2));
}
