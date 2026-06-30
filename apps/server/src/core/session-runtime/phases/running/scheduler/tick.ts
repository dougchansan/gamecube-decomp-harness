import { loadKnowledgeBoardSnapshot, resourceGraphDbPath } from "@server/core/knowledge";
import {
  activeWorkerCount,
  activeSchedulerEpoch,
  admitExistingEpochTargets,
  admitEpochTargets,
  parseEpochSize,
  refreshEpochTargetPriorities,
  refreshEpochTargetAvailability,
  schedulerEpochProgress,
  startSchedulerEpoch,
  getLatestRun,
  getRun,
  markEventHandled,
  nextUnhandledEvent,
  openState,
  targetPressureSnapshot,
  type EpochAdmissionResult,
  type ExistingEpochAdmissionResult,
  type EpochProgressSummary,
  type EpochAvailabilityRefreshResult,
  type EpochSizeSpec,
  type SchedulerEpochConfig,
  type SchedulerEpochRecord,
  type StateStore,
} from "@server/core/session-runtime/run-state";
import { numberArg, stringArg, type GlobalArgs } from "@server/core/project-registry/runtime-options.js";
import { assertSchedulableRun } from "@server/core/session-runtime/phases/running/jobs/shared.js";

export interface SchedulerTickResult {
  runId: string;
  status?: "no_unhandled_events";
  handledEvent?: unknown;
  eventType?: string;
  eventProducer?: string;
  eventCreatedAt?: string;
  schedulerTargetUpdates?: number;
  schedulerEpoch?: EpochProgressSummary;
  existingEpochAdmission?: ExistingEpochAdmissionResult;
  epochAdmission?: EpochAdmissionResult;
  epochAvailabilityRefresh?: EpochAvailabilityRefreshResult;
  epochPriorityRefreshes?: number;
  targetPressure?: {
    activeWorkers: number;
    admittedTargets: number;
    blockedAdmittedTargets: number;
    admissionTargetSize: number;
    candidateLimit: number;
    candidateWindow: number;
    schedulableTargets: number;
    unhandledEvents: number;
  };
  dryRun?: boolean;
}

export interface SchedulerEpochEnsureResult {
  epoch: SchedulerEpochRecord;
  admission?: EpochAdmissionResult;
  existingAdmission?: ExistingEpochAdmissionResult;
  availabilityRefresh: EpochAvailabilityRefreshResult;
  priorityRefreshes: number;
  progress: EpochProgressSummary;
  candidateWindow: number;
  boardExhausted: boolean;
}

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function positiveIntArg(args: Map<string, string | true>, name: string, fallback: number): number {
  return Math.max(1, nonNegativeInt(numberArg(args, name, fallback)));
}

function rawEpochSize(globals: GlobalArgs, args: Map<string, string | true>, admissionTargetSize: number): string | number {
  const explicit = args.get("--epoch-size");
  if (typeof explicit === "string") return explicit;
  return globals.project?.dashboard.epochSize ?? admissionTargetSize;
}

export function schedulerEpochConfigFromArgs(
  globals: GlobalArgs,
  args: Map<string, string | true>,
  params: { admissionTargetSize: number; candidateWindow: number },
): SchedulerEpochConfig {
  const size = parseEpochSize(rawEpochSize(globals, args, params.admissionTargetSize));
  const workerPoolSize = positiveIntArg(args, "--epoch-ready-queue-size", globals.project?.dashboard.epochReadyQueueSize ?? params.admissionTargetSize);
  return {
    size,
    workerPoolSize,
    candidateWindow: Math.max(1, params.candidateWindow),
  };
}

function remainingFixedAdmission(size: EpochSizeSpec, progress: EpochProgressSummary): number {
  if (size.mode === "full") return Number.POSITIVE_INFINITY;
  return Math.max(0, (size.value ?? 0) - progress.admitted);
}

function combineEpochAdmissions(previous: EpochAdmissionResult | undefined, next: EpochAdmissionResult): EpochAdmissionResult {
  if (!previous) return next;
  return {
    ...next,
    admitted: previous.admitted + next.admitted,
    candidateCount: previous.candidateCount + next.candidateCount,
    skippedExisting: previous.skippedExisting + next.skippedExisting,
    skippedMissingSource: previous.skippedMissingSource + next.skippedMissingSource,
  };
}

function historicalTargetKeyCount(store: StateStore, runId: string): number {
  const row = store.db.query("SELECT COUNT(DISTINCT target_key) AS count FROM epoch_targets WHERE session_id = ?").get(runId) as
    | Record<string, unknown>
    | undefined;
  return nonNegativeInt(Number(row?.count ?? 0));
}

export function ensureSchedulerEpochFromBoard(params: {
  config: SchedulerEpochConfig;
  globals: GlobalArgs;
  graphDbPath: string;
  runId: string;
  store: StateStore;
}): SchedulerEpochEnsureResult {
  let epoch = activeSchedulerEpoch(params.store, params.runId) ?? startSchedulerEpoch(params.store, params.runId, params.config);
  let candidateWindow = Math.max(1, params.config.candidateWindow);
  let progress = schedulerEpochProgress(params.store, epoch.id);
  let admission: EpochAdmissionResult | undefined;
  let existingAdmission: ExistingEpochAdmissionResult | undefined;
  let boardExhausted = false;

  const remaining = progress.admitted === 0 ? remainingFixedAdmission(params.config.size, progress) : 0;
  if (remaining > 0) {
    const admissionCandidateWindow =
      params.config.size.mode === "full" ? candidateWindow : candidateWindow + historicalTargetKeyCount(params.store, params.runId);
    const board = loadKnowledgeBoardSnapshot(params.globals.repoRoot, admissionCandidateWindow, { graphDbPath: params.graphDbPath });
    const passSize: EpochSizeSpec = params.config.size.mode === "full" ? params.config.size : { mode: "fixed", value: remaining };
    admission = combineEpochAdmissions(
      admission,
      admitEpochTargets(params.store, {
        epochId: epoch.id,
        runId: params.runId,
        candidates: board.candidates,
        size: passSize,
        workerPoolSize: params.config.workerPoolSize,
      }),
    );
    boardExhausted = board.candidates.length < admissionCandidateWindow;
    progress = schedulerEpochProgress(params.store, epoch.id);
  }

  const refreshBoard = loadKnowledgeBoardSnapshot(params.globals.repoRoot, candidateWindow, { graphDbPath: params.graphDbPath });
  const priorityRefreshes = refreshEpochTargetPriorities(params.store, {
    epochId: epoch.id,
    runId: params.runId,
    candidates: refreshBoard.candidates,
  }).refreshed;
  const availabilityRefresh = refreshEpochTargetAvailability(params.store, epoch.id);
  epoch = activeSchedulerEpoch(params.store, params.runId) ?? epoch;
  progress = schedulerEpochProgress(params.store, epoch.id);
  return { epoch, admission, existingAdmission, availabilityRefresh, priorityRefreshes, progress, candidateWindow, boardExhausted };
}

export async function runSchedulerTick(globals: GlobalArgs, args: Map<string, string | true>): Promise<SchedulerTickResult> {
  const store = openState(globals.stateDir);
  try {
    const runId = stringArg(args, "--run-id", getLatestRun(store)?.id ?? "");
    if (!runId) throw new Error("No run found. Run init-run first.");
    const run = getRun(store, runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    assertSchedulableRun(run, "tick");

    const event = nextUnhandledEvent(store, runId);
    if (!event) return { runId, status: "no_unhandled_events" };

    const candidateLimit = nonNegativeInt(
      numberArg(args, "--candidate-limit", globals.project?.dashboard.candidateLimit ?? Math.max(32, run.desiredWorkers * 2)),
    );
    const admissionTargetSize = nonNegativeInt(
      numberArg(args, "--queue-target-size", globals.project?.dashboard.queueTargetSize ?? Math.max(candidateLimit, run.desiredWorkers * 2)),
    );
    const requestedCandidateWindow = Math.max(
      candidateLimit,
      admissionTargetSize,
      nonNegativeInt(numberArg(args, "--candidate-window", globals.project?.dashboard.candidateWindow ?? Math.max(candidateLimit, admissionTargetSize * 8))),
    );
    const graphDbPath = stringArg(args, "--graph-db", globals.graphDbPath ?? resourceGraphDbPath());
    let epochResult: SchedulerEpochEnsureResult | null = null;
    epochResult = ensureSchedulerEpochFromBoard({
      config: schedulerEpochConfigFromArgs(globals, args, { admissionTargetSize, candidateWindow: requestedCandidateWindow }),
      globals,
      graphDbPath,
      runId,
      store,
    });
    markEventHandled(store, String(event.id));
    const targetPressure = targetPressureSnapshot(store, runId);

    return {
      runId,
      handledEvent: event.id,
      eventType: String(event.event_type ?? ""),
      eventProducer: String(event.producer ?? ""),
      eventCreatedAt: String(event.created_at ?? ""),
      schedulerTargetUpdates: (epochResult.admission?.admitted ?? 0) + epochResult.availabilityRefresh.inserted + epochResult.priorityRefreshes,
      schedulerEpoch: epochResult?.progress,
      existingEpochAdmission: epochResult?.existingAdmission,
      epochAdmission: epochResult?.admission,
      epochAvailabilityRefresh: epochResult?.availabilityRefresh,
      epochPriorityRefreshes: epochResult?.priorityRefreshes,
      targetPressure: {
        activeWorkers: activeWorkerCount(store, runId),
        admittedTargets: targetPressure.admittedTargets,
        blockedAdmittedTargets: targetPressure.blockedAdmittedTargets,
        admissionTargetSize,
        candidateLimit,
        candidateWindow: epochResult?.candidateWindow ?? requestedCandidateWindow,
        schedulableTargets: targetPressure.schedulableTargets,
        unhandledEvents: targetPressure.unhandledEvents,
      },
      dryRun: globals.dryRunAgents,
    };
  } finally {
    store.db.close();
  }
}

export async function tick(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  console.log(JSON.stringify(await runSchedulerTick(globals, args), null, 2));
}
