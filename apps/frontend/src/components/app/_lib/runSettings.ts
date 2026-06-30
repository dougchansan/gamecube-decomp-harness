import type { FormState } from "@/lib/format";
import { DEFAULT_WORKER_TIMEOUT_SECONDS } from "@/lib/workerConfig";

const RUN_SETTINGS_KEY = "runSettings.v1";

export function schedulingForWorkers(workers: number) {
  const maxWorkers = Number.isFinite(workers) && workers > 0 ? Math.trunc(workers) : 16;
  const queueTargetSize = maxWorkers * 4;
  return {
    maxWorkers,
    candidateLimit: queueTargetSize,
    candidateWindow: queueTargetSize,
    epochSize: String(queueTargetSize),
    epochReadyQueueSize: queueTargetSize,
    fastKgMaintenanceIntervalMs: 180000,
    fastKgMaintenanceReportCount: Math.max(4, maxWorkers),
    queueLowWatermark: maxWorkers,
    queueTargetSize,
  };
}

type SavedRunSettings = Pick<
  FormState,
  | "maxWorkers"
  | "idleSleepMs"
  | "provider"
  | "model"
  | "thinkingLevel"
  | "workerThinkingLevel"
  | "epochSize"
  | "epochReadyQueueSize"
  | "agentTimeoutSeconds"
  | "fastKgMaintenanceEnabled"
  | "fastKgMaintenanceIntervalMs"
  | "fastKgMaintenanceReportCount"
  | "fullKgMaintenanceMode"
>;

function loadRunSettings(): Partial<SavedRunSettings> {
  try {
    const raw = localStorage.getItem(RUN_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const settings: Partial<SavedRunSettings> = {};
    if (typeof parsed.maxWorkers === "number" && parsed.maxWorkers > 0) settings.maxWorkers = Math.trunc(parsed.maxWorkers);
    if (typeof parsed.idleSleepMs === "number" && parsed.idleSleepMs >= 100) settings.idleSleepMs = Math.trunc(parsed.idleSleepMs);
    if (typeof parsed.provider === "string" && parsed.provider) settings.provider = parsed.provider;
    if (typeof parsed.model === "string" && parsed.model) settings.model = parsed.model;
    if (typeof parsed.thinkingLevel === "string" && parsed.thinkingLevel) settings.thinkingLevel = parsed.thinkingLevel;
    if (typeof parsed.workerThinkingLevel === "string" && parsed.workerThinkingLevel) settings.workerThinkingLevel = parsed.workerThinkingLevel;
    if (typeof parsed.epochSize === "string" && parsed.epochSize) settings.epochSize = parsed.epochSize;
    if (typeof parsed.epochReadyQueueSize === "number" && parsed.epochReadyQueueSize > 0) settings.epochReadyQueueSize = Math.trunc(parsed.epochReadyQueueSize);
    if (typeof parsed.agentTimeoutSeconds === "number" && parsed.agentTimeoutSeconds > 0) settings.agentTimeoutSeconds = Math.trunc(parsed.agentTimeoutSeconds);
    if (typeof parsed.fastKgMaintenanceEnabled === "boolean") settings.fastKgMaintenanceEnabled = parsed.fastKgMaintenanceEnabled;
    if (typeof parsed.fastKgMaintenanceIntervalMs === "number" && parsed.fastKgMaintenanceIntervalMs >= 0) settings.fastKgMaintenanceIntervalMs = Math.trunc(parsed.fastKgMaintenanceIntervalMs);
    if (typeof parsed.fastKgMaintenanceReportCount === "number" && parsed.fastKgMaintenanceReportCount >= 0) settings.fastKgMaintenanceReportCount = Math.trunc(parsed.fastKgMaintenanceReportCount);
    if (typeof parsed.fullKgMaintenanceMode === "string" && parsed.fullKgMaintenanceMode) settings.fullKgMaintenanceMode = parsed.fullKgMaintenanceMode;
    return settings;
  } catch {
    return {};
  }
}

export function saveRunSettings(form: FormState) {
  try {
    const settings: SavedRunSettings = {
      maxWorkers: form.maxWorkers,
      idleSleepMs: form.idleSleepMs,
      provider: form.provider,
      model: form.model,
      thinkingLevel: form.thinkingLevel,
      workerThinkingLevel: form.workerThinkingLevel,
      epochSize: form.epochSize,
      epochReadyQueueSize: form.epochReadyQueueSize,
      agentTimeoutSeconds: form.agentTimeoutSeconds,
      fastKgMaintenanceEnabled: form.fastKgMaintenanceEnabled,
      fastKgMaintenanceIntervalMs: form.fastKgMaintenanceIntervalMs,
      fastKgMaintenanceReportCount: form.fastKgMaintenanceReportCount,
      fullKgMaintenanceMode: form.fullKgMaintenanceMode,
    };
    localStorage.setItem(RUN_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this session if storage is unavailable.
  }
}

export function initialForm(): FormState {
  const saved = loadRunSettings();
  const merged = { ...defaultForm, ...saved };
  const sizing = schedulingForWorkers(merged.maxWorkers);
  return {
    ...merged,
    ...sizing,
    epochSize: saved.epochSize ?? sizing.epochSize,
    epochReadyQueueSize: saved.epochReadyQueueSize ?? sizing.epochReadyQueueSize,
    agentTimeoutSeconds: saved.agentTimeoutSeconds ?? merged.agentTimeoutSeconds,
    fastKgMaintenanceEnabled: saved.fastKgMaintenanceEnabled ?? merged.fastKgMaintenanceEnabled,
    fastKgMaintenanceIntervalMs: saved.fastKgMaintenanceIntervalMs ?? sizing.fastKgMaintenanceIntervalMs,
    fastKgMaintenanceReportCount: saved.fastKgMaintenanceReportCount ?? sizing.fastKgMaintenanceReportCount,
    fullKgMaintenanceMode: saved.fullKgMaintenanceMode ?? merged.fullKgMaintenanceMode,
  };
}

const defaultForm: FormState = {
  projectId: "",
  usePathOverrides: false,
  repoRoot: "",
  stateDir: "",
  graphDbPath: "",
  processName: "pkmn-colosseum-live",
  ...schedulingForWorkers(16),
  idleSleepMs: 5000,
  goalValue: 100,
  provider: "codex-lb",
  model: "gpt-5.5",
  thinkingLevel: "medium",
  workerThinkingLevel: "medium",
  agentTimeoutSeconds: DEFAULT_WORKER_TIMEOUT_SECONDS,
  fastKgMaintenanceEnabled: true,
  fullKgMaintenanceMode: "full",
};
