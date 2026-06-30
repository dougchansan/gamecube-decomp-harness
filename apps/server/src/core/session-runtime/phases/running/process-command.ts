export interface RunningProcessCommandBody {
  agentTimeoutSeconds?: unknown;
  candidateWindow?: unknown;
  dryRunAgents?: unknown;
  epochReadyQueueSize?: unknown;
  epochSize?: unknown;
  fastKgMaintenanceEnabled?: unknown;
  fastKgMaintenanceIntervalMs?: unknown;
  fastKgMaintenanceReportCount?: unknown;
  fullKgMaintenanceMode?: unknown;
  idleSleepMs?: unknown;
  epochConfigureCommand?: unknown;
  maxWorkers?: unknown;
  model?: unknown;
  processName?: unknown;
  provider?: unknown;
  queueLowWatermark?: unknown;
  queueTargetSize?: unknown;
  runId?: unknown;
  thinkingLevel?: unknown;
  workerConfigureCommand?: unknown;
  workerThinkingLevel?: unknown;
}

export interface RunningProcessProjectDefaults {
  dashboard?: {
    agentTimeoutSeconds?: unknown;
    epochReadyQueueSize?: unknown;
    epochSize?: unknown;
    fastKgMaintenanceIntervalMs?: unknown;
    fastKgMaintenanceReportCount?: unknown;
    fullKgMaintenanceMode?: unknown;
  };
  processName?: unknown;
  projectId?: string;
}

export interface RunningProcessCommandInput {
  body: RunningProcessCommandBody;
  graphDbPath: string;
  noRefillBatch: boolean;
  project: RunningProcessProjectDefaults | null;
  repoRoot: string;
  runId: string;
  serverJobPath: string;
  stateDir: string;
}

export interface RunningProcessCommandPlan {
  command: string[];
  graphDbPath: string;
  maxWorkers: number;
  name: string;
  repoRoot: string;
  runId: string;
  stateDir: string;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function intValue(value: unknown, fallback: number, min = 0): number {
  const parsed = Math.trunc(numberValue(value, fallback));
  return Math.max(min, parsed);
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true";
}

function processName(value: unknown): string {
  const raw = text(value, "melee-live").trim() || "melee-live";
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "melee-live";
}

export function runningScheduling(maxWorkersValue: unknown): {
  candidateLimit: number;
  candidateWindow: number;
  epochReadyQueueSize: number;
  epochSize: string;
  fastKgMaintenanceIntervalMs: number;
  fastKgMaintenanceReportCount: number;
  maxWorkers: number;
  queueLowWatermark: number;
  queueTargetSize: number;
} {
  const maxWorkers = intValue(maxWorkersValue, 16, 1);
  const queueTargetSize = maxWorkers * 4;
  return {
    candidateLimit: queueTargetSize,
    candidateWindow: queueTargetSize,
    epochReadyQueueSize: queueTargetSize,
    epochSize: String(queueTargetSize),
    fastKgMaintenanceIntervalMs: 180_000,
    fastKgMaintenanceReportCount: Math.max(4, maxWorkers),
    maxWorkers,
    queueLowWatermark: maxWorkers,
    queueTargetSize,
  };
}

export function buildRunningProcessCommand(input: RunningProcessCommandInput): RunningProcessCommandPlan {
  const { body, graphDbPath, noRefillBatch, project, repoRoot, runId, serverJobPath, stateDir } = input;
  const name = processName(project?.processName ?? body.processName);
  const provider = text(body.provider, "codex-lb");
  const model = text(body.model, "gpt-5.5");
  const thinkingLevel = text(body.thinkingLevel, "medium");
  const workerThinkingLevel = text(body.workerThinkingLevel, "medium");
  const normalScheduling = runningScheduling(body.maxWorkers);
  const maxWorkers = normalScheduling.maxWorkers;
  const candidateLimit = noRefillBatch ? 0 : normalScheduling.candidateLimit;
  const candidateWindow = noRefillBatch ? 0 : intValue(body.candidateWindow, normalScheduling.candidateWindow, 0);
  const queueLowWatermark = noRefillBatch ? 0 : intValue(body.queueLowWatermark, normalScheduling.queueLowWatermark, 0);
  const queueTargetSize = noRefillBatch ? 0 : intValue(body.queueTargetSize, normalScheduling.queueTargetSize, 0);
  const epochSize = noRefillBatch ? "1" : text(body.epochSize, String(project?.dashboard?.epochSize ?? normalScheduling.epochSize));
  const epochReadyQueueSize = noRefillBatch ? 1 : intValue(body.epochReadyQueueSize, numberValue(project?.dashboard?.epochReadyQueueSize, normalScheduling.epochReadyQueueSize), 1);
  const fastKgMaintenanceEnabled = !noRefillBatch && body.fastKgMaintenanceEnabled !== false;
  const fastKgMaintenanceIntervalMs = intValue(
    body.fastKgMaintenanceIntervalMs,
    numberValue(project?.dashboard?.fastKgMaintenanceIntervalMs, normalScheduling.fastKgMaintenanceIntervalMs),
    0,
  );
  const fastKgMaintenanceReportCount = intValue(
    body.fastKgMaintenanceReportCount,
    numberValue(project?.dashboard?.fastKgMaintenanceReportCount, normalScheduling.fastKgMaintenanceReportCount),
    0,
  );
  const fullKgMaintenanceMode = text(body.fullKgMaintenanceMode, project?.dashboard?.fullKgMaintenanceMode ? String(project.dashboard.fullKgMaintenanceMode) : "full");
  const schedulableLowWatermark = noRefillBatch ? 0 : maxWorkers;
  const queueRefreshIntervalMs = noRefillBatch ? 0 : 60000;
  const idleSleepMs = intValue(body.idleSleepMs, 5000, 100);
  const workerConfigureCommand = text(body.workerConfigureCommand).trim();
  const epochConfigureCommand = text(body.epochConfigureCommand).trim();
  const agentTimeoutSeconds = numberValue(
    body.agentTimeoutSeconds,
    numberValue(project?.dashboard?.agentTimeoutSeconds, noRefillBatch ? 3000 : 0),
  );

  const command = ["bun", serverJobPath];
  if (project?.projectId) command.push("--project", project.projectId);
  command.push("--repo-root", repoRoot, "--state-dir", stateDir, "--provider", provider, "--model", model, "--thinking-level", thinkingLevel);
  if (boolValue(body.dryRunAgents)) command.push("--dry-run-agents");
  if (agentTimeoutSeconds > 0) command.push("--agent-timeout-seconds", String(Math.trunc(agentTimeoutSeconds)));
  command.push(
    "babysit",
    "--max-workers",
    String(maxWorkers),
    "--idle-sleep-ms",
    String(idleSleepMs),
    "--worker-thinking-level",
    workerThinkingLevel,
    "--candidate-limit",
    String(candidateLimit),
    "--queue-target-size",
    String(queueTargetSize),
    "--epoch-size",
    epochSize,
    "--epoch-ready-queue-size",
    String(epochReadyQueueSize),
    "--candidate-window",
    String(candidateWindow),
    "--queue-refresh-interval-ms",
    String(queueRefreshIntervalMs),
    "--queue-low-watermark",
    String(queueLowWatermark),
    "--schedulable-low-watermark",
    String(schedulableLowWatermark),
    "--graph-db",
    graphDbPath,
    "--fast-kg-maintenance-interval-ms",
    String(fastKgMaintenanceIntervalMs),
    "--fast-kg-maintenance-report-count",
    String(fastKgMaintenanceReportCount),
    "--full-kg-maintenance-mode",
    fullKgMaintenanceMode,
    "--force-recover-claims",
  );
  if (!fastKgMaintenanceEnabled) command.push("--no-fast-kg-maintenance");
  if (workerConfigureCommand) command.push("--worker-configure-command", workerConfigureCommand);
  if (epochConfigureCommand) command.push("--epoch-configure-command", epochConfigureCommand);
  if (noRefillBatch) {
    command.push("--no-epoch-cycle", "--no-blocked-queue-replan", "--max-idle-iterations", "3");
  }
  if (runId) command.push("--run-id", runId);
  return { command, graphDbPath, maxWorkers, name, repoRoot, runId, stateDir };
}
