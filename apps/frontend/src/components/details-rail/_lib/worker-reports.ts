import { asArray, asObject, delta, num, scoreOrPercent, scorePairLooksPercent, text, type Dashboard, type JsonObject } from "@/lib/format";

export type WorkerStateOutcome = "exact" | "improved" | "no_progress" | "validation_failed" | "tool_error" | "provider_error";
export type WorkerStateFilter = "all" | WorkerStateOutcome;
type WorkerStateResult = "exact" | "improved" | "no_progress";
type StopReason = "target_complete" | "stalled";

export const reportsPageSize = 8;

export const reportFilters: Array<{ description: string; id: WorkerStateFilter; label: string }> = [
  { id: "all", label: "All", description: "Every worker state in this run or recent window." },
  { id: "exact", label: "Exact", description: "Worker states whose runner-selected checkpoint reached exact match." },
  { id: "improved", label: "Improved", description: "Worker states with runner-validated positive score movement." },
  { id: "no_progress", label: "No Progress", description: "Worker states with no runner-validated positive score movement." },
  { id: "validation_failed", label: "Validation Failed", description: "Worker states whose latest validation failed hard gates." },
  { id: "tool_error", label: "Tool Error", description: "A tool, command, build, or parse infrastructure failure blocked trustworthy worker evaluation." },
  { id: "provider_error", label: "Provider Error", description: "The LLM provider failed before the target was really attempted; worker spawns paused until a probe succeeded." },
];

const reportFilterIds: WorkerStateFilter[] = reportFilters.map((option) => option.id);

export function workerStateStatusLabel(value: unknown): string {
  const status = text(value);
  return status ? status.replace(/_/g, " ") : "unknown";
}

export function attemptNumber(value: unknown, fallback = NaN): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function attemptLooksPercent(attempt: JsonObject): boolean {
  return scorePairLooksPercent(attempt.oldScore, attempt.newScore, attempt.delta);
}

function positivePercentAttempts(report: JsonObject): JsonObject[] {
  return asArray(report.attempts)
    .map(asObject)
    .filter((attempt) => attemptLooksPercent(attempt) && attemptNumber(attempt.delta, 0) > 0);
}

function reportRunnerTarget(report: JsonObject): JsonObject | null {
  const validation = asObject(report.runnerValidation);
  if (text(validation.status) !== "passed") return null;
  const target = asObject(validation.target);
  return Object.keys(target).length > 0 ? target : null;
}

function runnerTargetDelta(target: JsonObject): number {
  const before = attemptNumber(target.before, NaN);
  const after = attemptNumber(target.after, NaN);
  return Number.isFinite(before) && Number.isFinite(after) ? after - before : NaN;
}

export function reportScoreDelta(report: JsonObject): number {
  const runnerTarget = reportRunnerTarget(report);
  if (runnerTarget) {
    const runnerDelta = runnerTargetDelta(runnerTarget);
    if (Number.isFinite(runnerDelta)) return Math.max(0, runnerDelta);
  }
  const recorded = attemptNumber(report.scoreDelta, NaN);
  if (Number.isFinite(recorded)) return recorded;
  return positivePercentAttempts(report).reduce((sum, attempt) => sum + Math.max(0, attemptNumber(attempt.delta, 0)), 0);
}

function reportHasExactAttempt(report: JsonObject): boolean {
  const runnerTarget = reportRunnerTarget(report);
  if (runnerTarget) return runnerTarget.exact === true;
  return asArray(report.attempts)
    .map(asObject)
    .some((attempt) => attemptLooksPercent(attempt) && attemptNumber(attempt.oldScore) < 99.99999 && attemptNumber(attempt.newScore) >= 99.99999);
}

function reportFailed(report: JsonObject): boolean {
  const gate = asObject(report.acceptanceGate);
  const validation = asObject(report.runnerValidation);
  const repairAttempts = asObject(report.repairAttempts);
  const validationStatus = text(validation.status);
  const exhaustedFiniteRepairBudget = repairAttempts.exhausted === true && text(repairAttempts.policy) !== "unbounded_until_claim_timeout";
  return (
    gate.accepted === false ||
    (validationStatus !== "" && validationStatus !== "passed" && validationStatus !== "skipped") ||
    exhaustedFiniteRepairBudget
  );
}

function runnerValidationRejected(report: JsonObject): boolean {
  const status = text(asObject(report.runnerValidation).status);
  return status !== "" && status !== "passed" && status !== "skipped";
}

export function reportResult(report: JsonObject): WorkerStateResult {
  const runnerTarget = reportRunnerTarget(report);
  if (runnerTarget) {
    if (runnerTarget.exact === true) return "exact";
    if (runnerTarget.improved === true || runnerTargetDelta(runnerTarget) > 0) return "improved";
    return "no_progress";
  }
  if (runnerValidationRejected(report)) return "no_progress";
  const explicit = text(report.result);
  if (reportHasExactAttempt(report)) return "exact";
  if (explicit === "no_progress") return explicit;
  if (explicit === "exact" || explicit === "improved") return reportScoreDelta(report) > 0 ? "improved" : "no_progress";
  if (reportScoreDelta(report) > 0) return "improved";
  return "no_progress";
}

export function reportStopReason(report: JsonObject, result = reportResult(report)): StopReason {
  const explicit = text(report.stopReason);
  if (explicit === "target_complete" || explicit === "stalled") return explicit;
  if (explicit === "no_useful_hypothesis") return "stalled";
  if (result === "exact") return "target_complete";
  return "stalled";
}

export function reportOutcome(report: JsonObject): WorkerStateOutcome {
  const lifecycle = text(report.lifecycleStatus);
  const errorKind = text(asObject(report.error).kind);
  if (errorKind === "provider_error") return "provider_error";
  if (lifecycle === "error" || Object.keys(asObject(report.error)).length > 0) return "tool_error";
  if (reportFailed(report)) return "validation_failed";
  const result = reportResult(report);
  if (result === "exact") return "exact";
  if (result === "improved") return "improved";
  return "no_progress";
}

export function reportMatchesFilter(report: JsonObject, filter: WorkerStateFilter): boolean {
  if (filter === "all") return true;
  return reportOutcome(report) === filter;
}

function emptyReportCounts(): Record<WorkerStateFilter, number> {
  return {
    all: 0,
    exact: 0,
    improved: 0,
    no_progress: 0,
    validation_failed: 0,
    tool_error: 0,
    provider_error: 0,
  };
}

export function reportCountsForReports(reports: JsonObject[]): Record<WorkerStateFilter, number> {
  const counts = emptyReportCounts();
  counts.all = reports.length;
  for (const report of reports) counts[reportOutcome(report)] += 1;
  return counts;
}

export function reportTotalCounts(dashboard: Dashboard | null, loadedCounts: Record<WorkerStateFilter, number>): Record<WorkerStateFilter, number> {
  const summary = asObject(dashboard?.runSummary);
  const outcomeCounts = asObject(summary.workerStateOutcomeCounts);
  const counts = { ...loadedCounts };
  for (const id of reportFilterIds) {
    const sourceValue = id === "all" ? outcomeCounts.all ?? summary.totalWorkerStates : outcomeCounts[id];
    const parsed = Number(sourceValue);
    if (Number.isFinite(parsed)) counts[id] = parsed;
  }
  return counts;
}

export function reportWindowText(filter: WorkerStateFilter, loadedCounts: Record<WorkerStateFilter, number>, totalCounts: Record<WorkerStateFilter, number>, loadedAll: boolean): string {
  const loadedForFilter = loadedCounts[filter];
  const totalForFilter = totalCounts[filter];
  if (filter === "all") {
    if (loadedAll && loadedForFilter >= totalForFilter) return `${num(totalForFilter)} worker states loaded`;
    return `${num(loadedForFilter)}/${num(totalForFilter)} worker states recent`;
  }
  if (loadedAll && loadedForFilter >= totalForFilter) return `${num(totalForFilter)} matching worker states loaded`;
  return `${num(loadedForFilter)}/${num(totalForFilter)} matching worker states in ${loadedAll ? "loaded set" : `recent ${num(loadedCounts.all)}`}`;
}

export function pageReportText(filter: WorkerStateFilter, loadedCounts: Record<WorkerStateFilter, number>, totalCounts: Record<WorkerStateFilter, number>): string {
  const loadedForFilter = loadedCounts[filter];
  const totalForFilter = totalCounts[filter];
  if (loadedForFilter === totalForFilter) return `${num(loadedForFilter)} worker states`;
  return `${num(loadedForFilter)}/${num(totalForFilter)} shown`;
}

export function reportBorderClass(report: JsonObject): string {
  const outcome = reportOutcome(report);
  if (outcome === "tool_error") return "border-l-down";
  if (outcome === "provider_error") return "border-l-warn";
  if (outcome === "validation_failed") return "border-l-warn";
  if (outcome === "exact") return "border-l-up";
  if (outcome === "improved") return "border-l-cyan";
  return "border-l-purple";
}

export function reportFinishLabel(report: JsonObject): string {
  const outcome = reportOutcome(report);
  if (outcome === "exact") return "exact";
  if (outcome === "improved") return "improved";
  if (outcome === "no_progress") return "no progress";
  if (outcome === "tool_error") return "tool error";
  if (outcome === "provider_error") return "provider error";
  return "validation failed";
}

export function reportOutcomeDescription(report: JsonObject): string {
  const outcome = reportOutcome(report);
  if (outcome === "exact") return "Exact: the runner-selected checkpoint reached 100%.";
  if (outcome === "improved") return "Improved: runner validation recorded positive percent score movement.";
  if (outcome === "no_progress") return "No Progress: runner validation did not record positive percent score movement.";
  if (outcome === "validation_failed") return "Validation Failed: runner hard gates failed.";
  if (outcome === "tool_error") return "Tool Error: a tool, command, build, or parse infrastructure failure blocked trustworthy worker evaluation.";
  if (outcome === "provider_error") return "Provider Error: the LLM provider failed before the target was really attempted; worker spawns paused until a provider probe succeeded.";
  return "Worker state outcome is unknown.";
}

export function stopReasonLabel(value: StopReason): string {
  if (value === "target_complete") return "target complete";
  return "stalled";
}

export function compactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function statusText(report: JsonObject): string {
  const gate = asObject(report.acceptanceGate);
  const validation = asObject(report.runnerValidation);
  const accepted = gate.accepted === false ? "gate failed" : gate.accepted === true ? "accepted" : "";
  const runner = text(validation.status);
  return [accepted, runner ? `validation ${runner}` : ""].filter(Boolean).join(" / ") || "-";
}

export function reasonLines(report: JsonObject): string[] {
  const gate = asObject(report.acceptanceGate);
  const validation = asObject(report.runnerValidation);
  const error = asObject(report.error);
  return [
    ...asArray(error.reasons),
    text(error.summary || error.kind),
    ...asArray(gate.reasons),
    ...asArray(validation.reasons),
  ]
    .map((item) => text(item))
    .filter(Boolean);
}

export function attemptScoreText(attempt: JsonObject): string {
  const percent = attemptLooksPercent(attempt);
  return `${percent ? "pct" : "local"} ${scoreOrPercent(attempt.oldScore, percent)} -> ${scoreOrPercent(attempt.newScore, percent)} (${delta(attempt.delta)})`;
}

export function modelAttemptBuildLabel(attempt: JsonObject): { label: string; className: string; title: string } {
  if (attempt.compiled === true) {
    return { label: "compiled", className: "text-up", title: "The model reported this attempt as compiled." };
  }
  return {
    label: "model note",
    className: "text-dim",
    title: "Model-authored attempt description without runner-owned build evidence. See Runner Validation for deterministic build results.",
  };
}

export function runnerAttemptBuildLabel(attempt: JsonObject): { label: string; className: string } {
  if (attempt.compiled === true) return { label: "compiled", className: "text-up" };
  if (text(attempt.status) === "build_failed") return { label: "build failed", className: "text-down" };
  return { label: "no build", className: "text-dim" };
}

export function runnerAttemptScoreText(attempt: JsonObject): string {
  const oldScore = attemptNumber(attempt.oldScore, NaN);
  const newScore = attemptNumber(attempt.newScore, NaN);
  if (!Number.isFinite(oldScore) && !Number.isFinite(newScore)) return "-";
  return `pct ${scoreOrPercent(attempt.oldScore, true)} -> ${scoreOrPercent(attempt.newScore, true)} (${delta(attempt.delta)})`;
}

export function traceEventTone(eventType: string): string {
  if (eventType === "runner_validation_passed" || eventType === "report_recorded") return "text-up";
  if (eventType === "runner_validation_rejected" || eventType === "repair_requested") return "text-warn";
  if (eventType === "acceptance_gate") return "text-soft";
  return "text-dim";
}

export function traceEventLabel(event: JsonObject): string {
  const attemptIndex = Number(event.attemptIndex);
  const eventType = text(event.eventType).replace(/_/g, " ");
  return Number.isFinite(attemptIndex) ? `a${attemptIndex} ${eventType}` : eventType;
}

// Compact model/agent tag for a trace row, e.g. "glm-5.2" — resolved
// server-side (read-model.ts) from pi_sessions at the max escalation_level
// for the event's (claim, attempt). Empty when no rung could be resolved.
export function traceEventAgentTag(event: JsonObject): string {
  return text(event.agentLabel);
}

export function traceScoreText(event: JsonObject): string {
  const score = asObject(event.score);
  const before = Number(score.before);
  const after = Number(score.after);
  if (!Number.isFinite(before) && !Number.isFinite(after)) return "";
  return `${scoreOrPercent(score.before, true)} -> ${scoreOrPercent(score.after, true)}${score.exact === true ? " (exact)" : ""}`;
}
