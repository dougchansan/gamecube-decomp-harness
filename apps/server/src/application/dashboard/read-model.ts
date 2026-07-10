import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { latestCheckpointSummary } from "@server/core/session-runtime/phases/pr/checkpoint";
import { runningEpochCheckpointProgress, runningEpochHistory } from "@server/core/session-runtime/phases/running/epochs";
import { knowledgeCuratorEnrichmentPath } from "@server/core/knowledge";
import { openState, statusSnapshot } from "@server/core/session-runtime/run-state";
import { latestDashboardArtifactPayload } from "@server/core/orchestrator-state";
import { activeProjectSessionProjection } from "@server/core/project-session/store";
import { projectToSummary as defaultProjectToSummary, type ProjectRuntimeContext, type ResolvedProject } from "@server/core/project-registry";
import { latestChildDirectory, latestPrSplitPlanSummary, latestQaRepairSummary, latestRegressionCheckSummary } from "@server/core/session-runtime/phases/pr/artifacts";

export type JsonObject = Record<string, unknown>;
type WorkerStateOutcome = "exact" | "improved" | "no_progress" | "validation_failed" | "tool_error" | "provider_error";
type WorkerStateResult = "exact" | "improved" | "no_progress";
type StopReason = "target_complete" | "stalled";

export type DashboardProjectContext = ProjectRuntimeContext;

export interface DashboardReadModelDependencies {
  appendLog?: (stream: "stdout" | "stderr" | "ui", text: string) => void;
  buildPrRecordsView: (stateDir: string, runId: string) => JsonObject;
  campaignStatus: (repoRoot: string, stateDir: string, baseRefFallback: string) => JsonObject;
  processStatus: (stateDir: string, project: ResolvedProject | null) => JsonObject;
  projectToSummary?: (project: ResolvedProject) => unknown;
}

let readModelDependencies: DashboardReadModelDependencies | null = null;

function dashboardDeps(): DashboardReadModelDependencies {
  if (!readModelDependencies) throw new Error("Dashboard read model dependencies have not been configured.");
  return readModelDependencies;
}

function projectSummary(project: ResolvedProject): unknown {
  return readModelDependencies?.projectToSummary ? readModelDependencies.projectToSummary(project) : defaultProjectToSummary(project);
}

function readModelLog(stream: "stdout" | "stderr" | "ui", text: string): void {
  readModelDependencies?.appendLog?.(stream, text);
}

export function createDashboardReadModel(dependencies: DashboardReadModelDependencies): {
  dashboardStableSignature: (dashboard: JsonObject) => string;
  dashboardTick: (dashboard: JsonObject) => JsonObject;
  runDashboard: (paths: DashboardProjectContext) => Promise<JsonObject>;
  runDetails: (stateDir: string, explicitRunId?: string, project?: ResolvedProject | null) => JsonObject;
} {
  readModelDependencies = dependencies;
  return { dashboardStableSignature, dashboardTick, runDashboard, runDetails };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
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

// Preserves SQL NULL as JS null (rather than coercing to 0) so telemetry
// columns that were never populated render as "n/a" instead of a fake zero.
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentLike(value: unknown): boolean {
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
}

function attemptHasPercentScores(attempt: JsonObject): boolean {
  const oldScore = "oldScore" in attempt ? attempt.oldScore : attempt.old_score;
  const newScore = "newScore" in attempt ? attempt.newScore : attempt.new_score;
  if (!percentLike(oldScore) || !percentLike(newScore)) return false;
  const oldValue = numberValue(oldScore, NaN);
  const newValue = numberValue(newScore, NaN);
  const delta = numberValue("delta" in attempt ? attempt.delta : null, NaN);
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) return true;
  const scoreMovement = newValue - oldValue;
  return Math.abs(scoreMovement) < 0.0005 || Math.sign(delta) === Math.sign(scoreMovement);
}

function timeMs(value: unknown): number {
  const text = stringValue(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dashboardStableSignature(dashboard: JsonObject): string {
  return JSON.stringify(dashboard, (key, value) => (key === "elapsedMs" || key === "lastWorkerStateAgeMs" ? 0 : value));
}

export function dashboardTick(dashboard: JsonObject): JsonObject {
  const summary = asObject(dashboard.runSummary);
  return {
    elapsedMs: numberValue(summary.elapsedMs),
    lastWorkerStateAgeMs: summary.lastWorkerStateAgeMs ?? null,
    at: new Date().toISOString(),
  };
}

function readJsonObject(path: string): JsonObject {
  try {
    if (!path || !existsSync(path)) return {};
    return asObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

function jsonObjectValue(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return asObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function dashboardArtifactPayload(stateDir: string, selector: Parameters<typeof latestDashboardArtifactPayload>[1]): JsonObject {
  const store = openState(stateDir);
  try {
    return latestDashboardArtifactPayload(store, selector);
  } finally {
    store.db.close();
  }
}

function latestInitialSnapshot(stateDir: string, runId: string): JsonObject {
  return dashboardArtifactPayload(stateDir, {
    runId,
    artifactType: "board_snapshot",
    artifactKey: "initial",
  });
}

function measuresFromSnapshot(snapshot: JsonObject): JsonObject {
  return asObject(snapshot.measures);
}

function compactMeasures(measures: JsonObject): JsonObject {
  return {
    fuzzy_match_percent: numberValue(measures.fuzzy_match_percent, NaN),
    matched_code_percent: numberValue(measures.matched_code_percent, NaN),
    complete_code_percent: numberValue(measures.complete_code_percent, NaN),
    matched_functions_percent: numberValue(measures.matched_functions_percent, NaN),
    complete_units: numberValue(measures.complete_units, NaN),
    total_units: numberValue(measures.total_units, NaN),
  };
}

function summaryHasValue(summary: JsonObject): boolean {
  return Object.values(summary).some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
}

function enrichProjectSessionBaseline(projectSession: JsonObject | null): JsonObject | null {
  if (!projectSession) return projectSession;
  const phases = asObject(projectSession.phases);
  const preparing = asObject(phases.preparing);
  const baseline = asObject(preparing.baseline);
  if (Object.keys(baseline).length === 0 || summaryHasValue(asObject(baseline.summary))) return projectSession;
  const reportRun = asObject(baseline.reportRun);
  const resetReport = asObject(baseline.resetReport);
  const summary =
    (summaryHasValue(asObject(reportRun.summary)) ? asObject(reportRun.summary) : null) ??
    (summaryHasValue(asObject(resetReport.summary)) ? asObject(resetReport.summary) : null);
  if (!summary) return projectSession;
  return {
    ...projectSession,
    phases: {
      ...phases,
      preparing: {
        ...preparing,
        baseline: {
          ...baseline,
          summary,
        },
      },
    },
  };
}

function activeSessionRunId(projectSession: JsonObject | null): string {
  if (!projectSession) return "";
  return stringValue(projectSession.activeRunId, stringValue(projectSession.active_run_id));
}

function activeSessionRepoRoot(projectSession: JsonObject | null, runId: string): string {
  if (!projectSession || !runId || activeSessionRunId(projectSession) !== runId) return "";
  const sync = asObject(asObject(asObject(projectSession.phases).preparing).sync);
  return stringValue(sync.sessionCurrentWorktreePath, stringValue(sync.sessionWorktreePath));
}

function activeSessionBaseline(projectSession: JsonObject | null, runId: string): JsonObject | null {
  if (!projectSession || !runId || activeSessionRunId(projectSession) !== runId) return null;
  const baseline = asObject(asObject(asObject(projectSession.phases).preparing).baseline);
  return Object.keys(baseline).length > 0 ? baseline : null;
}

function measuresFromSessionSummary(summary: JsonObject): JsonObject {
  return {
    fuzzy_match_percent: numberValue(summary.fuzzyMatchPercent, NaN),
    matched_code_percent: numberValue(summary.matchedCodePercent, NaN),
    complete_code_percent: numberValue(summary.completeCodePercent, NaN),
    matched_functions_percent: numberValue(summary.matchedFunctionsPercent, NaN),
    complete_units: numberValue(summary.completeUnits, NaN),
    total_units: numberValue(summary.totalUnits, NaN),
  };
}

function sessionBaselineBoard(projectSession: JsonObject | null, runId: string): JsonObject | null {
  const baseline = activeSessionBaseline(projectSession, runId);
  if (!baseline) return null;
  const summary = asObject(baseline.summary);
  const measures = measuresFromSessionSummary(summary);
  if (!summaryHasValue(measures)) return null;
  const reportRun = asObject(baseline.reportRun);
  const timestamps = asObject(reportRun.timestamps);
  return {
    generatedAt: stringValue(timestamps.report, stringValue(baseline.completedAt)),
    measures,
    candidates: [],
    reportPath: stringValue(reportRun.reportPath),
    source: "session_baseline",
  };
}

function measureDelta(initial: JsonObject, current: JsonObject, key: string): number {
  const start = numberValue(initial[key], NaN);
  const now = numberValue(current[key], NaN);
  return Number.isFinite(start) && Number.isFinite(now) ? now - start : 0;
}

function loadCurrentBoard(
  stateDir: string,
  runId: string,
  campaign?: JsonObject,
): { error?: string; generatedAt?: string; measures: JsonObject; candidates: unknown[]; reportPath?: string; source?: string; savePointSha?: string | null } {
  const current = runId
    ? dashboardArtifactPayload(stateDir, {
        runId,
        artifactType: "board_snapshot",
        artifactKey: "current",
      })
    : {};
  const currentMeasures = asObject(current.measures);
  if (summaryHasValue(currentMeasures)) {
    return {
      generatedAt: stringValue(current.generatedAt) || undefined,
      measures: compactMeasures(currentMeasures),
      candidates: asArray(current.candidates),
      reportPath: stringValue(current.reportPath),
      source: stringValue(current.source, "database"),
      savePointSha: stringValue(current.savePointSha) || null,
    };
  }

  const initial = runId
    ? dashboardArtifactPayload(stateDir, {
        runId,
        artifactType: "board_snapshot",
        artifactKey: "initial",
      })
    : {};
  const initialMeasures = asObject(initial.measures);
  if (summaryHasValue(initialMeasures)) {
    return {
      generatedAt: stringValue(initial.generatedAt) || undefined,
      measures: compactMeasures(initialMeasures),
      candidates: asArray(initial.candidates),
      reportPath: stringValue(initial.reportPath),
      source: "initial_board",
    };
  }

  const savePoint = asObject(campaign?.savePoint);
  const savePointMeasures = asObject(asObject(savePoint.payload).measures);
  if (summaryHasValue(savePointMeasures)) {
    return {
      generatedAt: stringValue(savePoint.createdAt) || undefined,
      measures: compactMeasures(savePointMeasures),
      candidates: [],
      reportPath: stringValue(savePoint.reportPath),
      source: "save_point",
      savePointSha: stringValue(savePoint.commitSha) || null,
    };
  }

  return {
    error: "No report snapshot has been recorded in the local database yet.",
    measures: {},
    candidates: [],
    source: "database",
  };
}

function sqlLimit(limit: number): string {
  const safeLimit = Math.max(0, Math.floor(limit));
  return safeLimit > 0 ? `LIMIT ${safeLimit}` : "";
}

// Runner-owned score outcome: when runner validation passed, its target block is
// the canonical evidence for result/delta/exact, regardless of what the compact
// checkpoint-note attempts[] narrative contains.
function runnerValidationTarget(runnerValidation: JsonObject): JsonObject | null {
  if (stringValue(runnerValidation.status) !== "passed") return null;
  const target = asObject(runnerValidation.target);
  return Object.keys(target).length > 0 ? target : null;
}

function runnerValidationDelta(runnerValidation: JsonObject): number | null {
  const target = runnerValidationTarget(runnerValidation);
  if (!target) return null;
  const before = numberValue(target.before, NaN);
  const after = numberValue(target.after, NaN);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return after - before;
}

function runnerAttemptsByWorkerState(stateDir: string, runId: string): Map<string, JsonObject[]> {
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT *
          FROM worker_checkpoints
          WHERE session_id = ?
          ORDER BY worker_state_id ASC, attempt_index ASC, validation_time ASC
        `,
      )
      .all(runId) as JsonObject[];
    const byWorkerState = new Map<string, JsonObject[]>();
    for (const row of rows) {
      const workerStateId = stringValue(row.worker_state_id);
      const list = byWorkerState.get(workerStateId) ?? [];
      list.push({
        attemptIndex: numberValue(row.attempt_index, NaN),
        compiled: stringValue(row.build_status) === "compiled",
        oldScore: numberValue(row.old_score, NaN),
        newScore: numberValue(row.new_score, NaN),
        delta: numberValue(row.delta, NaN),
        status: stringValue(row.validation_status),
        artifactPath: stringValue(row.artifact_path),
        patchPath: stringValue(row.patch_path),
        exact: numberValue(row.exact_match) === 1,
        hardGatesPassed: numberValue(row.hard_gates_passed) === 1,
        selectable: numberValue(row.selectable) === 1,
        selected: numberValue(row.selected) === 1,
        source: "runner",
      });
      byWorkerState.set(workerStateId, list);
    }
    return byWorkerState;
  } finally {
    store.db.close();
  }
}

// Older worker-state summaries can lack checkpoint rows; synthesize the final
// runner checkpoint from the embedded runner_validation block.
function syntheticRunnerAttempts(runnerValidation: JsonObject): JsonObject[] {
  const status = stringValue(runnerValidation.status);
  if (!status || status === "skipped") return [];
  const target = asObject(runnerValidation.target);
  const before = numberValue(target.before, NaN);
  const after = numberValue(target.after, NaN);
  return [
    {
      attemptIndex: NaN,
      compiled: status !== "build_failed" && (Object.keys(target).length > 0 || numberValue(runnerValidation.exitCode, NaN) === 0),
      oldScore: before,
      newScore: after,
      delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : NaN,
      status,
      artifactPath: stringValue(runnerValidation.summaryPath),
      source: "runner",
    },
  ];
}

function workerStateSummaryPath(row: JsonObject, summary: JsonObject): string {
  const explicit = stringValue(summary.summary_path);
  if (explicit) return explicit;
  const artifactDir = stringValue(row.artifact_dir);
  return artifactDir ? resolve(artifactDir, "state", "worker_state.json") : "";
}

function checkpointRef(row: JsonObject, prefix: "best" | "latest"): JsonObject | null {
  const id = stringValue(row[`${prefix}_checkpoint_id`]);
  if (!id) return null;
  return {
    id,
    attemptIndex: numberValue(row[`${prefix}_attempt_index`], NaN),
    validationTime: stringValue(row[`${prefix}_validation_time`]),
    oldScore: numberValue(row[`${prefix}_old_score`], NaN),
    newScore: numberValue(row[`${prefix}_new_score`], NaN),
    delta: numberValue(row[`${prefix}_delta`], NaN),
    exact: numberValue(row[`${prefix}_exact_match`]) === 1,
    hardGatesPassed: numberValue(row[`${prefix}_hard_gates_passed`]) === 1,
    selectable: numberValue(row[`${prefix}_selectable`]) === 1,
    selected: numberValue(row[`${prefix}_selected`]) === 1,
    validationStatus: stringValue(row[`${prefix}_validation_status`]),
    artifactPath: stringValue(row[`${prefix}_artifact_path`]),
    patchPath: stringValue(row[`${prefix}_patch_path`]),
    failureReasons: stringArrayValue(row[`${prefix}_failure_reasons_json`]),
    metadata: jsonObjectValue(row[`${prefix}_metadata_json`]),
  };
}

function runnerValidationFromWorkerStateRow(row: JsonObject, summary: JsonObject): JsonObject {
  for (const prefix of ["best", "latest"] as const) {
    const artifact = readJsonObject(stringValue(row[`${prefix}_artifact_path`]));
    if (stringValue(artifact.status)) return artifact;
    const metadata = jsonObjectValue(row[`${prefix}_metadata_json`]);
    const metadataValidation = asObject(metadata.runner_validation);
    if (stringValue(metadataValidation.status)) return metadataValidation;
  }
  return asObject(summary.latest_runner_validation);
}

function workerResultForState(row: JsonObject, runnerValidation: JsonObject): WorkerStateResult {
  if (numberValue(row.exact) === 1) return "exact";
  const delta = runnerValidationDelta(runnerValidation);
  if (delta !== null && delta > 0 && stringValue(row.best_checkpoint_id)) return "improved";
  return "no_progress";
}

function workerStatesForRun(stateDir: string, runId: string, limit = 100): JsonObject[] {
  const runnerAttempts = runnerAttemptsByWorkerState(stateDir, runId);
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT
            worker_state.id AS worker_state_id,
            worker_state.session_id,
            worker_state.epoch_id,
            worker_state.epoch_target_id,
            worker_state.target_claim_id,
            worker_state.worker_id,
            worker_state.lifecycle_status,
            worker_state.write_set_json,
            worker_state.worker_session_ids_json,
            worker_state.artifact_dir,
            worker_state.worktree_path,
            worker_state.started_at,
            worker_state.ended_at,
            worker_state.baseline_score,
            worker_state.best_checkpoint_id,
            worker_state.best_score,
            worker_state.exact,
            worker_state.timeout_summary,
            worker_state.error_summary,
            worker_state.summary_json,
            epochs.ordinal AS epoch_ordinal,
            epoch_targets.unit,
            epoch_targets.symbol,
            epoch_targets.source_path,
            epoch_targets.size,
            epoch_targets.baseline_score AS fuzzy,
            epoch_targets.status AS epoch_target_status,
            epoch_targets.cracked_by_provider AS cracked_by_provider,
            epoch_targets.cracked_by_model AS cracked_by_model,
            epoch_targets.cracked_at_escalation AS cracked_at_escalation,
            epoch_targets.tokens_to_crack AS tokens_to_crack,
            epoch_targets.time_to_crack_ms AS time_to_crack_ms,
            best.id AS best_checkpoint_id,
            best.attempt_index AS best_attempt_index,
            best.validation_time AS best_validation_time,
            best.old_score AS best_old_score,
            best.new_score AS best_new_score,
            best.delta AS best_delta,
            best.exact_match AS best_exact_match,
            best.hard_gates_passed AS best_hard_gates_passed,
            best.selectable AS best_selectable,
            best.selected AS best_selected,
            best.validation_status AS best_validation_status,
            best.artifact_path AS best_artifact_path,
            best.patch_path AS best_patch_path,
            best.failure_reasons_json AS best_failure_reasons_json,
            best.metadata_json AS best_metadata_json,
            latest.id AS latest_checkpoint_id,
            latest.attempt_index AS latest_attempt_index,
            latest.validation_time AS latest_validation_time,
            latest.old_score AS latest_old_score,
            latest.new_score AS latest_new_score,
            latest.delta AS latest_delta,
            latest.exact_match AS latest_exact_match,
            latest.hard_gates_passed AS latest_hard_gates_passed,
            latest.selectable AS latest_selectable,
            latest.selected AS latest_selected,
            latest.validation_status AS latest_validation_status,
            latest.artifact_path AS latest_artifact_path,
            latest.patch_path AS latest_patch_path,
            latest.failure_reasons_json AS latest_failure_reasons_json,
            latest.metadata_json AS latest_metadata_json,
            integration.id AS integration_id,
            integration.status AS integration_status,
            integration.disposition AS integration_disposition,
            integration.failure_reasons_json AS integration_failure_reasons_json
          FROM worker_state
          LEFT JOIN epochs ON epochs.id = worker_state.epoch_id
          LEFT JOIN epoch_targets ON epoch_targets.id = worker_state.epoch_target_id
          LEFT JOIN worker_checkpoints AS best ON best.id = worker_state.best_checkpoint_id
          LEFT JOIN worker_output_integrations AS integration ON integration.id = (
            SELECT id
            FROM worker_output_integrations
            WHERE worker_output_integrations.worker_state_id = worker_state.id
            ORDER BY
              CASE status WHEN 'applied' THEN 0 WHEN 'applying' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
              created_at DESC
            LIMIT 1
          )
          LEFT JOIN worker_checkpoints AS latest ON latest.id = (
            SELECT id
            FROM worker_checkpoints
            WHERE worker_checkpoints.worker_state_id = worker_state.id
            ORDER BY validation_time DESC, attempt_index DESC
            LIMIT 1
          )
          WHERE worker_state.session_id = ?
          ORDER BY COALESCE(worker_state.ended_at, latest.validation_time, worker_state.started_at) DESC
          ${sqlLimit(limit)}
        `,
      )
      .all(runId) as JsonObject[];

    return rows.map((row) => {
      const summary = jsonObjectValue(row.summary_json);
      const agentNote = asObject(summary.agent_note);
      const target = { ...row, ...asObject(summary.target), ...asObject(agentNote.target) };
      const attempts = asArray(agentNote.attempts).map(asObject);
      const writeSet = [
        ...asArray(summary.write_set).map((item) => stringValue(item)).filter(Boolean),
        ...stringArrayValue(row.write_set_json),
      ];
      if (writeSet.length === 0 && stringValue(target.source_path)) writeSet.push(stringValue(target.source_path));
      const runnerValidation = runnerValidationFromWorkerStateRow(row, summary);
      const runnerDelta = runnerValidationDelta(runnerValidation);
      const attemptScoreDelta = attempts
        .filter(attemptHasPercentScores)
        .reduce((sum, attempt) => sum + Math.max(0, numberValue(attempt.delta)), 0);
      const scoreDelta = runnerDelta !== null ? Math.max(0, runnerDelta) : attemptScoreDelta;
      const workerStateId = stringValue(row.worker_state_id);
      const workerRunnerAttempts = runnerAttempts.get(workerStateId) ?? syntheticRunnerAttempts(runnerValidation);
      // Per-worker-state trace files are only read on the explicit full-details load,
      // not on the 2.5s dashboard poll.
      const activity = limit === 0 ? activeClaimActivity(stateDir, runId, workerStateId) : null;
      const result = workerResultForState(row, runnerValidation);
      const bestCheckpoint = checkpointRef(row, "best");
      const latestCheckpoint = checkpointRef(row, "latest");
      const validationStatus = stringValue(bestCheckpoint?.validationStatus, stringValue(latestCheckpoint?.validationStatus, stringValue(runnerValidation.status)));
      return {
        id: workerStateId,
        workerStateId,
        epochId: row.epoch_id,
        epochOrdinal: numberValue(row.epoch_ordinal, NaN),
        epochTargetId: row.epoch_target_id,
        workerCheckpointId: stringValue(row.best_checkpoint_id, stringValue(row.latest_checkpoint_id)),
        claimId: row.target_claim_id,
        targetClaimId: row.target_claim_id,
        workerId: row.worker_id,
        lifecycleStatus: row.lifecycle_status,
        validationStatus,
        result,
        stopReason: result === "exact" ? "target_complete" : "stalled",
        neededFact: null,
        createdAt: stringValue(row.ended_at, stringValue(row.started_at)),
        summary: stringValue(summary.summary, stringValue(row.timeout_summary, stringValue(row.error_summary, "No summary recorded."))),
        target: {
          unit: stringValue(target.unit),
          symbol: stringValue(target.symbol),
          sourcePath: stringValue(target.source_path),
          size: numberValue(target.size),
          fuzzy: numberValue(target.fuzzy, numberValue(target.fuzzy_match_percent)),
          // Telemetry (Track B): "who cracked it" benchmark keys (populated by Track A).
          crackedByProvider: stringValue(row.cracked_by_provider) || null,
          crackedByModel: stringValue(row.cracked_by_model) || null,
          crackedAtEscalation: numberOrNull(row.cracked_at_escalation),
          tokensToCrack: numberOrNull(row.tokens_to_crack),
          timeToCrackMs: numberOrNull(row.time_to_crack_ms),
        },
        writeSet: [...new Set(writeSet)],
        attempts: attempts.map((attempt) => ({
          description: stringValue(attempt.description),
          compiled: attempt.compiled === true,
          oldScore: numberValue(attempt.old_score, NaN),
          newScore: numberValue(attempt.new_score, NaN),
          delta: numberValue(attempt.delta, 0),
          artifactPath: stringValue(attempt.artifact_path),
          source: "model",
        })),
        runnerAttempts: workerRunnerAttempts,
        activity,
        scoreDelta,
        patchPath: stringValue(bestCheckpoint?.patchPath, stringValue(latestCheckpoint?.patchPath)),
        acceptanceGate: {},
        runnerValidation,
        repairAttempts: asObject(summary.continuation_attempts),
        error: asObject(summary.error),
        nextRecommendation: stringValue(agentNote.next_recommendation),
        epochTargetStatus: row.epoch_target_status,
        selectedCheckpoint: bestCheckpoint,
        latestCheckpoint,
        integration: {
          id: stringValue(row.integration_id),
          status: stringValue(row.integration_status),
          disposition: stringValue(row.integration_disposition),
          failureReasons: stringArrayValue(row.integration_failure_reasons_json),
        },
        summaryPath: workerStateSummaryPath(row, summary),
      };
    });
  } finally {
    store.db.close();
  }
}

function touchedFilesFromWorkerStates(workerStates: JsonObject[]): JsonObject[] {
  const touched = new Map<string, JsonObject>();
  for (const workerState of workerStates) {
    const outcome = workerStateOutcome(workerState);
    const files = asArray(workerState.writeSet).map((item) => stringValue(item)).filter(Boolean);
    for (const path of files) {
      const current = touched.get(path) ?? {
        path,
        workerStates: 0,
        improvedStates: 0,
        noProgressStates: 0,
        validationFailedStates: 0,
        toolErrorStates: 0,
        providerErrorStates: 0,
        scoreDelta: 0,
        lastAt: "",
      };
      current.workerStates = numberValue(current.workerStates) + 1;
      current.improvedStates = numberValue(current.improvedStates) + (outcome === "exact" || outcome === "improved" ? 1 : 0);
      current.noProgressStates = numberValue(current.noProgressStates) + (outcome === "no_progress" ? 1 : 0);
      current.validationFailedStates = numberValue(current.validationFailedStates) + (outcome === "validation_failed" ? 1 : 0);
      current.toolErrorStates = numberValue(current.toolErrorStates) + (outcome === "tool_error" ? 1 : 0);
      current.providerErrorStates = numberValue(current.providerErrorStates) + (outcome === "provider_error" ? 1 : 0);
      current.scoreDelta = numberValue(current.scoreDelta) + numberValue(workerState.scoreDelta);
      current.lastAt = stringValue(workerState.createdAt, stringValue(current.lastAt));
      touched.set(path, current);
    }
  }
  return [...touched.values()].sort((left, right) => stringValue(right.lastAt).localeCompare(stringValue(left.lastAt)));
}

function readJsonLines(path: string, maxLines: number): JsonObject[] {
  try {
    if (!path || !existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .slice(-maxLines)
      .map((line) => readInlineJson(line))
      .filter((record) => Object.keys(record).length > 0);
  } catch {
    return [];
  }
}

function compactActivityEvent(event: JsonObject): JsonObject {
  const score = asObject(event.score);
  return {
    createdAt: stringValue(event.created_at),
    attemptIndex: numberValue(event.attempt_index, NaN),
    phase: stringValue(event.phase),
    eventType: stringValue(event.event_type),
    summary: stringValue(event.summary),
    score: Object.keys(score).length > 0 ? { before: score.before ?? null, after: score.after ?? null, exact: score.exact === true } : null,
    artifactPath: stringValue(event.artifact_path),
    sessionId: stringValue(event.session_id),
  };
}

// Worker states started before activity.jsonl existed still have return-gate and
// repair-request artifacts; synthesize a coarse timeline from those.
function activityFromReturnGates(workerLogDir: string): JsonObject[] {
  const validationDir = resolve(workerLogDir, "runner_validation");
  if (!existsSync(validationDir)) return [];
  let gateFiles: Array<{ index: number; path: string }> = [];
  try {
    gateFiles = readdirSync(validationDir)
      .map((file) => {
        const match = /^attempt-(\d+)\.return_gate\.json$/.exec(file);
        return match ? { index: Number(match[1]), path: resolve(validationDir, file) } : null;
      })
      .filter((entry): entry is { index: number; path: string } => entry !== null)
      .sort((left, right) => left.index - right.index);
  } catch {
    return [];
  }
  return gateFiles.slice(-4).map((entry) => {
    const gate = readJsonObject(entry.path);
    const validation = asObject(gate.runner_validation);
    const target = asObject(validation.target);
    const repairReasons = asArray(gate.repair_reasons).map((item) => stringValue(item)).filter(Boolean);
    let createdAt = "";
    try {
      createdAt = statSync(entry.path).mtime.toISOString();
    } catch {
      createdAt = "";
    }
    return {
      created_at: createdAt,
      attempt_index: numberValue(gate.attempt_index, entry.index),
      phase: repairReasons.length > 0 ? "repair_request" : "validation",
      event_type: repairReasons.length > 0 ? "runner_validation_rejected" : "runner_validation_passed",
      summary: repairReasons.length > 0 ? repairReasons.join("; ").slice(0, 400) : `runner validation ${stringValue(validation.status, "unknown")}`,
      score:
        Object.keys(target).length > 0
          ? { before: target.before ?? null, after: target.after ?? null, exact: target.exact === true }
          : undefined,
      artifact_path: entry.path,
    };
  });
}

function activeClaimActivity(stateDir: string, runId: string, workerStateId: string): JsonObject {
  const workerLogDir = resolve(stateDir, "runs", runId, "worker_state", workerStateId);
  let source = "activity_log";
  let events = readJsonLines(resolve(workerLogDir, "activity.jsonl"), 60);
  if (events.length === 0) {
    events = activityFromReturnGates(workerLogDir);
    source = events.length > 0 ? "return_gates" : "none";
  }
  const toolEvents = readJsonLines(resolve(workerLogDir, "tool_events.jsonl"), 30);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastTool = toolEvents.length > 0 ? toolEvents[toolEvents.length - 1] : null;
  const lastScoreEvent = [...events].reverse().find((event) => {
    const score = asObject(event.score);
    return Number.isFinite(numberValue(score.after, NaN)) || Number.isFinite(numberValue(score.before, NaN));
  });
  const lastRepair = [...events].reverse().find((event) => stringValue(event.event_type) === "repair_requested" || stringValue(event.event_type) === "runner_validation_rejected");
  const attemptIndex = events.reduce((max, event) => Math.max(max, numberValue(event.attempt_index, -1)), -1);
  return {
    source,
    workerLogDir,
    attemptIndex: attemptIndex >= 0 ? attemptIndex : null,
    phase: lastEvent ? stringValue(lastEvent.phase) : "",
    lastEvent: lastEvent ? compactActivityEvent(lastEvent) : null,
    lastTool: lastTool
      ? {
          createdAt: stringValue(lastTool.created_at),
          tool: stringValue(lastTool.tool),
          status: stringValue(lastTool.status),
          exitCode: lastTool.exit_code ?? null,
          errorKind: stringValue(lastTool.error_kind),
          durationMs: numberValue(lastTool.duration_ms, NaN),
        }
      : null,
    lastScore: lastScoreEvent ? asObject(lastScoreEvent.score) : null,
    lastRepairSummary: lastRepair ? stringValue(lastRepair.summary) : "",
    recentEvents: events.slice(-12).map(compactActivityEvent),
    toolEventCount: toolEvents.length,
  };
}

function activeFilesForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT
            target_claims.id AS claim_id,
            target_claims.epoch_id,
            target_claims.epoch_target_id,
            target_claims.worker_id,
            target_claims.base_rev,
            target_claims.worktree_path,
            target_claims.ttl,
            target_claims.heartbeat_at,
            target_claims.claimed_at,
            worker_state.id AS worker_state_id,
            epochs.ordinal AS epoch_ordinal,
            epoch_targets.id AS target_id,
            epoch_targets.unit,
            epoch_targets.symbol,
            epoch_targets.source_path,
            epoch_targets.size,
            epoch_targets.baseline_score,
            epoch_targets.priority,
            epoch_targets.reason
          FROM target_claims
          JOIN worker_state ON worker_state.target_claim_id = target_claims.id
          LEFT JOIN epochs ON epochs.id = target_claims.epoch_id
          JOIN epoch_targets ON epoch_targets.id = target_claims.epoch_target_id
          WHERE target_claims.session_id = ?
            AND target_claims.status = 'active'
          ORDER BY target_claims.claimed_at ASC
        `,
      )
      .all(runId) as JsonObject[];
    return rows.map((row) => ({
      claimId: row.claim_id,
      workerStateId: row.worker_state_id,
      epochId: row.epoch_id,
      epochOrdinal: numberValue(row.epoch_ordinal, NaN),
      epochTargetId: row.epoch_target_id,
      workerId: row.worker_id,
      baseRev: row.base_rev,
      worktreePath: row.worktree_path,
      ttl: row.ttl,
      heartbeatAt: row.heartbeat_at,
      claimedAt: row.claimed_at,
      activity: activeClaimActivity(stateDir, runId, stringValue(row.worker_state_id)),
      targetId: row.target_id,
      unit: stringValue(row.unit),
      symbol: stringValue(row.symbol),
      sourcePath: stringValue(row.source_path),
      size: numberValue(row.size),
      fuzzy: numberValue(row.baseline_score, NaN),
      matched: NaN,
      complete: NaN,
      priority: numberValue(row.priority, NaN),
      reason: stringValue(row.reason),
    }));
  } finally {
    store.db.close();
  }
}

function workerStatePositiveAttempts(workerState: JsonObject): JsonObject[] {
  return asArray(workerState.attempts)
    .map(asObject)
    .filter((attempt) => attemptHasPercentScores(attempt) && numberValue(attempt.delta) > 0);
}

function workerStateScoreDelta(workerState: JsonObject): number {
  const recorded = numberValue(workerState.scoreDelta, NaN);
  if (Number.isFinite(recorded)) return recorded;
  return workerStatePositiveAttempts(workerState).reduce((sum, attempt) => sum + Math.max(0, numberValue(attempt.delta)), 0);
}

function workerStateRunnerTarget(workerState: JsonObject): JsonObject | null {
  return runnerValidationTarget(asObject(workerState.runnerValidation));
}

function workerStateHasExactCheckpoint(workerState: JsonObject): boolean {
  const runnerTarget = workerStateRunnerTarget(workerState);
  if (runnerTarget) return runnerTarget.exact === true;
  return workerStatePositiveAttempts(workerState).some(
    (attempt) => numberValue(attempt.oldScore, NaN) < 99.99999 && numberValue(attempt.newScore, NaN) >= 99.99999,
  );
}

function workerStateValidationFailed(workerState: JsonObject): boolean {
  const validation = asObject(workerState.runnerValidation);
  const repairAttempts = asObject(workerState.repairAttempts);
  const validationStatus = stringValue(validation.status);
  const exhaustedFiniteRepairBudget = repairAttempts.exhausted === true && stringValue(repairAttempts.policy) !== "unbounded_until_claim_timeout";
  return (
    (validationStatus !== "" && validationStatus !== "passed" && validationStatus !== "skipped") ||
    exhaustedFiniteRepairBudget
  );
}

function runnerValidationRejected(workerState: JsonObject): boolean {
  const status = stringValue(asObject(workerState.runnerValidation).status);
  return status !== "" && status !== "passed" && status !== "skipped";
}

function workerStateResult(workerState: JsonObject): WorkerStateResult {
  const runnerTarget = workerStateRunnerTarget(workerState);
  if (runnerTarget) {
    if (runnerTarget.exact === true) return "exact";
    if (runnerTarget.improved === true || numberValue(runnerValidationDelta(asObject(workerState.runnerValidation)), 0) > 0) return "improved";
    return "no_progress";
  }
  if (runnerValidationRejected(workerState)) return "no_progress";
  const explicit = stringValue(workerState.result);
  if (workerStateHasExactCheckpoint(workerState)) return "exact";
  if (explicit === "no_progress") return explicit;
  if (explicit === "exact" || explicit === "improved") return workerStateScoreDelta(workerState) > 0 ? "improved" : "no_progress";
  return workerStateScoreDelta(workerState) > 0 ? "improved" : "no_progress";
}

function workerStateStopReason(workerState: JsonObject, result = workerStateResult(workerState)): StopReason {
  const explicit = stringValue(workerState.stopReason);
  if (explicit === "target_complete" || explicit === "stalled") return explicit;
  if (explicit === "no_useful_hypothesis") return "stalled";
  if (result === "exact") return "target_complete";
  return "stalled";
}

function workerStateOutcome(workerState: JsonObject): WorkerStateOutcome {
  const lifecycle = stringValue(workerState.lifecycleStatus);
  const errorKind = stringValue(asObject(workerState.error).kind);
  if (errorKind === "provider_error") return "provider_error";
  if (lifecycle === "error" || Object.keys(asObject(workerState.error)).length > 0) return "tool_error";
  if (workerStateValidationFailed(workerState)) return "validation_failed";
  const result = workerStateResult(workerState);
  if (result === "exact") return "exact";
  if (result === "improved") return "improved";
  return "no_progress";
}

function workerStateOutcomeCounts(workerStates: JsonObject[]): JsonObject {
  const counts: Record<WorkerStateOutcome | "all", number> = {
    all: workerStates.length,
    exact: 0,
    improved: 0,
    no_progress: 0,
    validation_failed: 0,
    tool_error: 0,
    provider_error: 0,
  };
  for (const workerState of workerStates) counts[workerStateOutcome(workerState)] += 1;
  return counts;
}

function improvementRowsFromWorkerStates(workerStates: JsonObject[]): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const workerState of workerStates) {
    const integration = asObject(workerState.integration);
    const integrationStatus = stringValue(integration.status);
    if (integrationStatus && integrationStatus !== "applied" && integrationStatus !== "pending" && integrationStatus !== "applying") continue;
    const target = asObject(workerState.target);
    const base = {
      workerStateId: workerState.id,
      workerCheckpointId: workerState.workerCheckpointId,
      lifecycleStatus: workerState.lifecycleStatus,
      validationStatus: workerState.validationStatus,
      integrationStatus,
      integrationDisposition: stringValue(integration.disposition),
      createdAt: workerState.createdAt,
      workerId: workerState.workerId,
      symbol: stringValue(target.symbol),
      unit: stringValue(target.unit),
      sourcePath: stringValue(target.sourcePath, asArray(workerState.writeSet).map((item) => stringValue(item)).find(Boolean) ?? ""),
      summary: stringValue(workerState.summary),
      patchPath: stringValue(workerState.patchPath),
    };

    // Runner-validated progress is canonical even when the compact checkpoint
    // note attempts[] narrative has no numeric score fields.
    const runnerTarget = workerStateRunnerTarget(workerState);
    if (!runnerTarget && runnerValidationRejected(workerState)) continue;
    const runnerDelta = runnerValidationDelta(asObject(workerState.runnerValidation));
    if (runnerTarget && runnerDelta !== null && (runnerDelta > 0 || runnerTarget.exact === true)) {
      const before = numberValue(runnerTarget.before, NaN);
      const after = numberValue(runnerTarget.after, NaN);
      rows.push({
        ...base,
        totalDelta: Math.max(0, runnerDelta),
        bestDelta: Math.max(0, runnerDelta),
        oldScore: before,
        newScore: after,
        attempts: Math.max(1, workerStatePositiveAttempts(workerState).length),
        exactMatches: runnerTarget.exact === true && before < 99.99999 ? 1 : 0,
        source: "runner",
      });
      continue;
    }

    const attempts = workerStatePositiveAttempts(workerState);
    if (attempts.length === 0) continue;
    const bestAttempt = attempts.reduce((best, attempt) => (numberValue(attempt.delta) > numberValue(best.delta) ? attempt : best), attempts[0] ?? {});
    const oldScores = attempts.map((attempt) => numberValue(attempt.oldScore, NaN)).filter(Number.isFinite);
    const newScores = attempts.map((attempt) => numberValue(attempt.newScore, NaN)).filter(Number.isFinite);
    const totalDelta = attempts.reduce((sum, attempt) => sum + numberValue(attempt.delta), 0);
    const exactMatches = attempts.filter((attempt) => numberValue(attempt.oldScore, NaN) < 99.99999 && numberValue(attempt.newScore, NaN) >= 99.99999).length;
    rows.push({
      ...base,
      totalDelta,
      bestDelta: numberValue(bestAttempt.delta),
      oldScore: oldScores.length ? Math.min(...oldScores) : NaN,
      newScore: newScores.length ? Math.max(...newScores) : NaN,
      attempts: attempts.length,
      exactMatches,
      source: "model",
    });
  }
  return rows.sort((left, right) => stringValue(right.createdAt).localeCompare(stringValue(left.createdAt)));
}

function fileImprovementRows(improvements: JsonObject[]): JsonObject[] {
  const files = new Map<string, JsonObject>();
  for (const improvement of improvements) {
    const path = stringValue(improvement.sourcePath, "unknown");
      const current = files.get(path) ?? {
        path,
        workerStates: 0,
        symbols: new Set<string>(),
        totalDelta: 0,
      bestDelta: 0,
      bestScore: NaN,
      exactMatches: 0,
      firstAt: "",
      lastAt: "",
    };
    current.workerStates = numberValue(current.workerStates) + 1;
    current.totalDelta = numberValue(current.totalDelta) + numberValue(improvement.totalDelta);
    current.bestDelta = Math.max(numberValue(current.bestDelta), numberValue(improvement.bestDelta));
    const score = numberValue(improvement.newScore, NaN);
    current.bestScore = Number.isFinite(score) ? Math.max(numberValue(current.bestScore, -Infinity), score) : current.bestScore;
    current.exactMatches = numberValue(current.exactMatches) + numberValue(improvement.exactMatches);
    current.lastAt = stringValue(current.lastAt).localeCompare(stringValue(improvement.createdAt)) > 0 ? current.lastAt : improvement.createdAt;
    current.firstAt = stringValue(current.firstAt) && stringValue(current.firstAt).localeCompare(stringValue(improvement.createdAt)) < 0 ? current.firstAt : improvement.createdAt;
    const symbols = current.symbols instanceof Set ? current.symbols : new Set<string>();
    const symbol = stringValue(improvement.symbol);
    if (symbol) symbols.add(symbol);
    current.symbols = symbols;
    files.set(path, current);
  }
  const rows: JsonObject[] = [];
  for (const file of files.values()) {
    rows.push({
      ...file,
      symbols: [...(file.symbols instanceof Set ? file.symbols : new Set<string>())],
      bestScore: numberValue(file.bestScore, NaN),
    });
  }
  return rows.sort((left, right) => numberValue(right.totalDelta) - numberValue(left.totalDelta));
}

function runSummary(
  status: JsonObject,
  workerStates: JsonObject[],
  initialMeasures: JsonObject,
  currentMeasures: JsonObject,
  improvements: JsonObject[],
  trustedReport: JsonObject = {},
): JsonObject {
  const run = asObject(status.run);
  const createdAtMs = timeMs(run.createdAt);
  const lastWorkerStateAtMs = workerStates.reduce((latest, workerState) => Math.max(latest, timeMs(workerState.createdAt)), 0);
  const outcomeCounts = workerStateOutcomeCounts(workerStates);
  const positiveAttempts = improvements.reduce((sum, improvement) => sum + numberValue(improvement.attempts), 0);
  const targetExactMatches = improvements.reduce((sum, improvement) => sum + numberValue(improvement.exactMatches), 0);
  const trustedCounts = asObject(trustedReport.counts);
  const reportReady = stringValue(trustedReport.status) === "ready";
  return {
    createdAt: stringValue(run.createdAt),
    elapsedMs: createdAtMs ? Math.max(0, Date.now() - createdAtMs) : 0,
    lastWorkerStateAt: lastWorkerStateAtMs ? new Date(lastWorkerStateAtMs).toISOString() : null,
    lastWorkerStateAgeMs: lastWorkerStateAtMs ? Math.max(0, Date.now() - lastWorkerStateAtMs) : null,
    totalWorkerStates: workerStates.length,
    workerStateOutcomeCounts: outcomeCounts,
    improvedWorkerStates: numberValue(outcomeCounts.exact) + numberValue(outcomeCounts.improved),
    noProgressWorkerStates: numberValue(outcomeCounts.no_progress),
    validationFailedWorkerStates: numberValue(outcomeCounts.validation_failed),
    toolErrorWorkerStates: numberValue(outcomeCounts.tool_error),
    providerErrorWorkerStates: numberValue(outcomeCounts.provider_error),
    positiveAttempts,
    improvedSymbols: improvements.length,
    improvedFiles: new Set(improvements.map((improvement) => stringValue(improvement.sourcePath)).filter(Boolean)).size,
    exactMatches: targetExactMatches,
    targetExactMatches,
    reportNewMatches: reportReady ? numberValue(trustedCounts.newMatches) : null,
    reportImprovements: reportReady ? numberValue(trustedCounts.improvements) : null,
    reportStatus: stringValue(trustedReport.status, "missing"),
    totalPositiveDelta: improvements.reduce((sum, improvement) => sum + numberValue(improvement.totalDelta), 0),
    matchedCodeDelta: measureDelta(initialMeasures, currentMeasures, "matched_code_percent"),
    completeCodeDelta: measureDelta(initialMeasures, currentMeasures, "complete_code_percent"),
    matchedFunctionDelta: measureDelta(initialMeasures, currentMeasures, "matched_functions_percent"),
    completeUnitDelta: measureDelta(initialMeasures, currentMeasures, "complete_units"),
  };
}

function eventsForRun(stateDir: string, runId: string, limit = 40): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, event_type, producer, handled_at, created_at, payload_json
            FROM events
            WHERE run_id = ?
            ORDER BY created_at DESC
            ${sqlLimit(limit)}
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => {
      const payload = readInlineJson(stringValue(row.payload_json));
      const target = asObject(payload.target);
      return {
        id: row.id,
        eventType: row.event_type,
        producer: row.producer,
        handledAt: row.handled_at,
        createdAt: row.created_at,
        claimId: payload.claim_id,
        reason: payload.reason,
        symbol: target.symbol,
        sourcePath: target.source_path,
      };
    });
  } finally {
    store.db.close();
  }
}

function countBy(rows: JsonObject[], key: string): JsonObject {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = stringValue(row[key], "unknown") || "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]));
}

function piSessionsForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, target_claim_id, role, session_id, session_file, provider, model, thinking_level, status, output_path, created_at,
                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, attempt_index, escalation_level, ended_at
            FROM pi_sessions
            WHERE run_id = ?
            ORDER BY created_at DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      claimId: row.target_claim_id,
      role: row.role,
      sessionId: row.session_id,
      sessionFile: row.session_file,
      provider: row.provider,
      model: row.model,
      thinkingLevel: row.thinking_level,
      status: row.status,
      outputPath: row.output_path,
      createdAt: row.created_at,
      // Telemetry (Track B): per-invocation token/cost + rung bookkeeping.
      inputTokens: numberOrNull(row.input_tokens),
      outputTokens: numberOrNull(row.output_tokens),
      cacheReadTokens: numberOrNull(row.cache_read_tokens),
      cacheWriteTokens: numberOrNull(row.cache_write_tokens),
      costUsd: numberOrNull(row.cost_usd),
      attemptIndex: numberOrNull(row.attempt_index),
      escalationLevel: numberOrNull(row.escalation_level),
      endedAt: row.ended_at,
    }));
  } finally {
    store.db.close();
  }
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Telemetry (Track B): per-model leaderboard. Attempts/exacts are de-duplicated
// by target_claim_id so a target with multiple pi_sessions on one claim is not
// double-counted (mirrors the fan-out guard on the worker-state view); token/cost
// totals sum over every session. Medians of tokens-to-crack / time-to-crack are
// computed in JS from epoch_targets (SQLite has no MEDIAN); they populate once
// Track A writes the cracked-by denormalization.
// Cumulative across the whole campaign (all runs), NOT the active run. These
// telemetry totals must survive a grind restart onto a fresh run — a per-run
// filter blanks the leaderboard every time init-run mints a new run. `_runId`
// is retained for call-site symmetry but intentionally unused.
function modelBenchmark(stateDir: string, _runId: string): JsonObject {
  const store = openState(stateDir);
  try {
    const leaderboardRows = store.db
      .query(
        `
          SELECT
            ps.provider AS provider,
            ps.model AS model,
            ps.thinking_level AS thinking_level,
            COUNT(DISTINCT ps.target_claim_id) AS attempts,
            COUNT(DISTINCT CASE WHEN ws.exact = 1 THEN ps.target_claim_id END) AS exacts,
            SUM(COALESCE(ps.input_tokens, 0) + COALESCE(ps.output_tokens, 0)) AS total_tokens,
            SUM(ps.cost_usd) AS total_cost_usd
          FROM pi_sessions ps
          JOIN worker_state ws ON ws.target_claim_id = ps.target_claim_id
          GROUP BY ps.provider, ps.model, ps.thinking_level
          ORDER BY exacts DESC, attempts DESC
        `,
      )
      .all() as JsonObject[];

    const crackRows = store.db
      .query(
        `
          SELECT cracked_by_provider AS provider, cracked_by_model AS model,
                 tokens_to_crack AS tokens_to_crack, time_to_crack_ms AS time_to_crack_ms
          FROM epoch_targets
          WHERE cracked_by_model IS NOT NULL
        `,
      )
      .all() as JsonObject[];

    const tokensByModel = new Map<string, number[]>();
    const timeByModel = new Map<string, number[]>();
    for (const row of crackRows) {
      const key = `${stringValue(row.provider)}|${stringValue(row.model)}`;
      const tokens = numberOrNull(row.tokens_to_crack);
      const time = numberOrNull(row.time_to_crack_ms);
      if (tokens !== null) (tokensByModel.get(key) ?? tokensByModel.set(key, []).get(key)!).push(tokens);
      if (time !== null) (timeByModel.get(key) ?? timeByModel.set(key, []).get(key)!).push(time);
    }

    const leaderboard = leaderboardRows.map((row) => {
      const attempts = numberValue(row.attempts);
      const exacts = numberValue(row.exacts);
      const key = `${stringValue(row.provider)}|${stringValue(row.model)}`;
      return {
        provider: stringValue(row.provider) || null,
        model: stringValue(row.model) || null,
        thinkingLevel: stringValue(row.thinking_level) || null,
        attempts,
        exacts,
        successRate: attempts > 0 ? exacts / attempts : 0,
        totalTokens: numberOrNull(row.total_tokens),
        totalCostUsd: numberOrNull(row.total_cost_usd),
        medianTokensToCrack: median(tokensByModel.get(key) ?? []),
        medianTimeToCrackMs: median(timeByModel.get(key) ?? []),
      };
    });

    return { leaderboard };
  } finally {
    store.db.close();
  }
}

// Telemetry (Track B): dense match-over-time series for the progress panel.
function reportSnapshotsForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, at, source, fuzzy_match_percent, matched_code_percent, complete_code_percent,
                   matched_data_percent, matched_functions_percent, complete_units, total_units, report_path
            FROM report_snapshots
            WHERE run_id = ?
            ORDER BY at ASC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      at: row.at,
      source: row.source,
      fuzzyMatchPercent: numberOrNull(row.fuzzy_match_percent),
      matchedCodePercent: numberOrNull(row.matched_code_percent),
      completeCodePercent: numberOrNull(row.complete_code_percent),
      matchedDataPercent: numberOrNull(row.matched_data_percent),
      matchedFunctionsPercent: numberOrNull(row.matched_functions_percent),
      completeUnits: numberOrNull(row.complete_units),
      totalUnits: numberOrNull(row.total_units),
      reportPath: row.report_path,
    }));
  } finally {
    store.db.close();
  }
}

// Panel: fuzzy-match distribution. Buckets every function in the build report
// (functions live under unit.functions and, for older reports, section.functions)
// by fuzzy_match_percent. When the report was generated without function-level
// data (`available: false`) the frontend renders an empty-state instead of a
// misleading all-zero donut.
function fuzzyBandsFromReport(repoRoot: string): JsonObject {
  const reportPath = repoRoot ? resolve(repoRoot, "build/GC6E01/report.json") : "";
  const report = readJsonObject(reportPath);
  const counts = { matched: 0, band90: 0, band80: 0, band70: 0, band50: 0, attempted: 0, unattacked: 0 };
  let total = 0;
  for (const unitValue of asArray(report.units)) {
    const unit = asObject(unitValue);
    const functions = [...asArray(unit.functions)];
    for (const sectionValue of asArray(unit.sections)) functions.push(...asArray(asObject(sectionValue).functions));
    for (const fnValue of functions) {
      const fuzzy = numberValue(asObject(fnValue).fuzzy_match_percent, NaN);
      if (!Number.isFinite(fuzzy)) continue;
      total += 1;
      if (fuzzy >= 100) counts.matched += 1;
      else if (fuzzy >= 90) counts.band90 += 1;
      else if (fuzzy >= 80) counts.band80 += 1;
      else if (fuzzy >= 70) counts.band70 += 1;
      else if (fuzzy >= 50) counts.band50 += 1;
      else if (fuzzy >= 1) counts.attempted += 1;
      else counts.unattacked += 1;
    }
  }
  return { available: total > 0, total, reportPath, counts };
}

// Panel: per-function token/cost. Joins pi_sessions -> target_claims ->
// epoch_targets so each worker invocation's usage is attributed to the symbol it
// worked on. Escalation across models is folded into one per-function total; the
// model that burned the most tokens is surfaced as the representative model.
// Cumulative per-function token/cost across every run (grouped by symbol +
// source_path, since epoch_targets are minted per-run so the same function has a
// different et.id each run). `_runId` retained for call-site symmetry, unused.
function functionTokenUsage(stateDir: string, _runId: string, limit = 30): JsonObject[] {
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT
            et.symbol AS symbol,
            MAX(et.unit) AS unit,
            et.source_path AS source_path,
            ps.provider AS provider,
            ps.model AS model,
            COUNT(ps.id) AS sessions,
            SUM(COALESCE(ps.input_tokens, 0)) AS input_tokens,
            SUM(COALESCE(ps.output_tokens, 0)) AS output_tokens,
            SUM(COALESCE(ps.input_tokens, 0) + COALESCE(ps.output_tokens, 0)) AS total_tokens,
            SUM(COALESCE(ps.cost_usd, 0)) AS cost_usd
          FROM pi_sessions ps
          JOIN target_claims tc ON tc.id = ps.target_claim_id
          JOIN epoch_targets et ON et.id = tc.epoch_target_id
          GROUP BY et.symbol, et.source_path, ps.provider, ps.model
        `,
      )
      .all() as JsonObject[];

    interface FunctionTokenRow {
      epochTargetId: string;
      symbol: string;
      unit: string;
      sourcePath: string;
      provider: string | null;
      model: string | null;
      sessions: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      topModelTokens: number;
    }
    const byFunction = new Map<string, FunctionTokenRow>();
    for (const row of rows) {
      const key = `${stringValue(row.symbol)}|${stringValue(row.source_path)}`;
      const tokens = numberValue(row.total_tokens, 0);
      const existing =
        byFunction.get(key) ??
        {
          epochTargetId: key,
          symbol: stringValue(row.symbol),
          unit: stringValue(row.unit),
          sourcePath: stringValue(row.source_path),
          provider: null,
          model: null,
          sessions: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          topModelTokens: -1,
        };
      existing.sessions += numberValue(row.sessions, 0);
      existing.inputTokens += numberValue(row.input_tokens, 0);
      existing.outputTokens += numberValue(row.output_tokens, 0);
      existing.totalTokens += tokens;
      existing.costUsd += numberValue(row.cost_usd, 0);
      if (tokens > existing.topModelTokens) {
        existing.topModelTokens = tokens;
        existing.provider = stringValue(row.provider) || null;
        existing.model = stringValue(row.model) || null;
      }
      byFunction.set(key, existing);
    }
    return [...byFunction.values()]
      .sort((left, right) => right.totalTokens - left.totalTokens)
      .slice(0, limit)
      .map(({ topModelTokens: _topModelTokens, ...rest }) => rest as unknown as JsonObject);
  } finally {
    store.db.close();
  }
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}

// Panel: permuter farm. The permuter_status / permuter_farm_summary tables are
// owned by a separate process and may not exist yet, so every read is guarded by
// a table-exists check; a missing pair returns `available: false` and the
// frontend hides the panel rather than erroring.
function permuterFarms(stateDir: string): JsonObject {
  const store = openState(stateDir);
  try {
    const hasSummary = tableExists(store.db, "permuter_farm_summary");
    const hasStatus = tableExists(store.db, "permuter_status");
    if (!hasSummary && !hasStatus) return { available: false, farms: [], active: [] };
    const hasPower = tableExists(store.db, "permuter_power");
    const power = hasPower
      ? new Map(
          (
            store.db.query(`SELECT farm, cpu_util, current_watts, cumulative_wh, cumulative_cost_usd FROM permuter_power`).all() as JsonObject[]
          ).map((row) => [stringValue(row.farm), row]),
        )
      : new Map<string, JsonObject>();
    const farms = hasSummary
      ? (
          store.db
            .query(
              `SELECT farm, workers, active, queued, wins, nowins, fails, updated_at
               FROM permuter_farm_summary ORDER BY farm ASC`,
            )
            .all() as JsonObject[]
        ).map((row) => {
          const farm = stringValue(row.farm);
          const powerRow = power.get(farm);
          return {
            farm,
            workers: numberValue(row.workers, 0),
            active: numberValue(row.active, 0),
            queued: numberValue(row.queued, 0),
            wins: numberValue(row.wins, 0),
            nowins: numberValue(row.nowins, 0),
            fails: numberValue(row.fails, 0),
            updatedAt: stringValue(row.updated_at),
            cpuUtil: powerRow ? numberOrNull(powerRow.cpu_util) : null,
            currentWatts: powerRow ? numberOrNull(powerRow.current_watts) : null,
            cumulativeKwh: powerRow ? numberValue(powerRow.cumulative_wh, 0) / 1000 : 0,
            cumulativeCostUsd: powerRow ? numberValue(powerRow.cumulative_cost_usd, 0) : 0,
          };
        })
      : [];
    const active = hasStatus
      ? (
          store.db
            .query(
              `SELECT farm, function_name, state, worker, base_score, best_score, permutation_seconds, updated_at
               FROM permuter_status WHERE state = 'active' ORDER BY permutation_seconds DESC`,
            )
            .all() as JsonObject[]
        ).map((row) => ({
          farm: stringValue(row.farm),
          functionName: stringValue(row.function_name),
          state: stringValue(row.state),
          worker: stringValue(row.worker),
          baseScore: numberOrNull(row.base_score),
          bestScore: numberOrNull(row.best_score),
          permutationSeconds: numberOrNull(row.permutation_seconds),
          updatedAt: stringValue(row.updated_at),
        }))
      : [];
    return { available: true, farms, active };
  } finally {
    store.db.close();
  }
}

// Panel: electricity cost per function. permuter_function_energy accumulates
// wh/cost for a function even after it completes (a completed function keeps
// its accumulated row), so this is the top-25 most expensive functions across
// both farms, not just the currently-active ones.
function permuterFunctionCost(stateDir: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    if (!tableExists(store.db, "permuter_function_energy")) return [];
    return (
      store.db
        .query(
          `SELECT farm, function_name, cumulative_wh, cumulative_cost_usd, last_permutation_seconds, last_state
           FROM permuter_function_energy ORDER BY cumulative_cost_usd DESC LIMIT 25`,
        )
        .all() as JsonObject[]
    ).map((row) => ({
      farm: stringValue(row.farm),
      functionName: stringValue(row.function_name),
      kwh: numberValue(row.cumulative_wh, 0) / 1000,
      costUsd: numberValue(row.cumulative_cost_usd, 0),
      permutationSeconds: numberOrNull(row.last_permutation_seconds),
      state: stringValue(row.last_state),
    }));
  } finally {
    store.db.close();
  }
}

function directorCyclesForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, trigger_event, active_workers, summary_path, decision_path, created_at
            FROM director_cycles
            WHERE run_id = ?
            ORDER BY created_at DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      triggerEvent: row.trigger_event,
      activeWorkers: numberValue(row.active_workers),
      summaryPath: row.summary_path,
      decisionPath: row.decision_path,
      createdAt: row.created_at,
    }));
  } finally {
    store.db.close();
  }
}

function targetClaimsForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT
              target_claims.id,
              target_claims.epoch_id,
              target_claims.epoch_target_id,
              target_claims.worker_id,
              target_claims.base_rev,
              target_claims.write_set_hash,
              target_claims.worktree_path,
              target_claims.ttl,
              target_claims.heartbeat_at,
              target_claims.status,
              target_claims.claimed_at,
              target_claims.closed_at,
              target_claims.close_reason,
              worker_state.id AS worker_state_id,
              worker_state.lifecycle_status,
              epochs.ordinal AS epoch_ordinal,
              epoch_targets.unit,
              epoch_targets.symbol,
              epoch_targets.source_path
            FROM target_claims
            JOIN worker_state ON worker_state.target_claim_id = target_claims.id
            LEFT JOIN epochs ON epochs.id = target_claims.epoch_id
            JOIN epoch_targets ON epoch_targets.id = target_claims.epoch_target_id
            WHERE target_claims.session_id = ?
            ORDER BY COALESCE(target_claims.closed_at, target_claims.heartbeat_at, target_claims.ttl) DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      claimId: row.id,
      epochId: row.epoch_id,
      epochOrdinal: numberValue(row.epoch_ordinal, NaN),
      epochTargetId: row.epoch_target_id,
      workerStateId: row.worker_state_id,
      workerId: row.worker_id,
      baseRev: row.base_rev,
      writeSetHash: row.write_set_hash,
      worktreePath: row.worktree_path,
      ttl: row.ttl,
      heartbeatAt: row.heartbeat_at,
      status: row.status,
      lifecycleStatus: row.lifecycle_status,
      claimedAt: row.claimed_at,
      closedAt: row.closed_at,
      closeReason: row.close_reason,
      unit: row.unit,
      symbol: row.symbol,
      sourcePath: row.source_path,
    }));
  } finally {
    store.db.close();
  }
}

function epochTargetsForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT
              epoch_targets.id AS epoch_target_id,
              epoch_targets.epoch_id,
              epoch_targets.priority AS epoch_target_priority,
              epoch_targets.reason AS epoch_target_reason,
              epoch_targets.status AS epoch_target_status,
              epoch_targets.admitted_at AS admitted_at,
              epoch_targets.claimed_at AS claimed_at,
              epoch_targets.id AS target_id,
              epoch_targets.unit,
              epoch_targets.symbol,
              epoch_targets.source_path,
              epoch_targets.size,
              epoch_targets.baseline_score AS fuzzy,
              epoch_targets.status AS target_status,
              epoch_targets.priority AS target_priority,
              epoch_targets.reason AS target_reason,
              epoch_targets.admitted_at AS target_created_at,
              epochs.ordinal AS epoch_ordinal
            FROM epoch_targets
            LEFT JOIN epochs ON epochs.id = epoch_targets.epoch_id
            WHERE epoch_targets.session_id = ?
            ORDER BY epoch_targets.admitted_at DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      epochTargetId: row.epoch_target_id,
      epochId: row.epoch_id,
      epochOrdinal: numberValue(row.epoch_ordinal, NaN),
      targetId: row.target_id,
      epochTargetStatus: row.epoch_target_status,
      targetStatus: row.target_status,
      priority: numberValue(row.epoch_target_priority, numberValue(row.target_priority)),
      reason: stringValue(row.epoch_target_reason, stringValue(row.target_reason)),
      admittedAt: row.admitted_at,
      claimedAt: row.claimed_at,
      unit: row.unit,
      symbol: row.symbol,
      sourcePath: row.source_path,
      size: numberValue(row.size),
      fuzzy: numberValue(row.fuzzy, NaN),
      matched: NaN,
      complete: NaN,
      risk: null,
    }));
  } finally {
    store.db.close();
  }
}

function checkpointForRun(stateDir: string, runId: string): JsonObject | null {
  const store = openState(stateDir);
  try {
    return latestCheckpointSummary(store, runId) as JsonObject | null;
  } finally {
    store.db.close();
  }
}

function handoffForRun(stateDir: string, runId: string, checkpoint: JsonObject | null): JsonObject {
  return {
    checkpoint,
    qa: latestRegressionCheckSummary(stateDir, runId),
    qaRepair: latestQaRepairSummary(stateDir, runId),
    splitPlan: latestPrSplitPlanSummary(stateDir, runId),
    baseline: dashboardArtifactPayload(stateDir, {
      runId,
      artifactType: "handoff_status",
      artifactKey: "baseline",
    }),
    ship: dashboardArtifactPayload(stateDir, {
      runId,
      artifactType: "handoff_status",
      artifactKey: "ship",
    }),
  };
}

function pushTimeline(timeline: JsonObject[], item: JsonObject): void {
  const at = stringValue(item.at);
  if (!at) return;
  timeline.push(item);
}

function runTimeline(params: {
  workerStates: JsonObject[];
  events: JsonObject[];
  sessions: JsonObject[];
  directorCycles: JsonObject[];
  targetClaims: JsonObject[];
}): JsonObject[] {
  const timeline: JsonObject[] = [];
  for (const workerState of params.workerStates) {
    const target = asObject(workerState.target);
    pushTimeline(timeline, {
      kind: "worker_state",
      at: workerState.createdAt,
      title: stringValue(target.symbol, stringValue(target.sourcePath, "worker state")),
      path: target.sourcePath,
      detail: `${stringValue(workerState.lifecycleStatus)} / ${stringValue(workerState.workerId)}`,
      delta: numberValue(workerState.scoreDelta),
      exactMatches: workerStateHasExactCheckpoint(workerState)
        ? 1
        : workerStatePositiveAttempts(workerState).filter(
            (attempt) => numberValue(attempt.oldScore, NaN) < 99.99999 && numberValue(attempt.newScore, NaN) >= 99.99999,
          ).length,
      id: workerState.id,
    });
  }
  for (const event of params.events) {
    pushTimeline(timeline, {
      kind: "event",
      at: event.createdAt,
      title: stringValue(event.eventType),
      path: event.sourcePath,
      detail: `${stringValue(event.producer)} / ${event.handledAt ? "handled" : "open"}`,
      id: event.id,
    });
  }
  for (const session of params.sessions) {
    const inputTokens = numberOrNull(session.inputTokens);
    const outputTokens = numberOrNull(session.outputTokens);
    const tokens = inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
    pushTimeline(timeline, {
      kind: "pi_session",
      at: session.createdAt,
      title: `${stringValue(session.role)} session`,
      detail: `${stringValue(session.status)} / ${stringValue(session.model)}`,
      id: session.id,
      // Telemetry (Track B): per-session token + rung badge for the timeline.
      tokens,
      escalationLevel: numberOrNull(session.escalationLevel),
    });
  }
  for (const cycle of params.directorCycles) {
    pushTimeline(timeline, {
      kind: "legacy_scheduler_cycle",
      at: cycle.createdAt,
      title: "legacy scheduler cycle",
      detail: `${stringValue(cycle.triggerEvent)} / ${numberValue(cycle.activeWorkers)} active workers`,
      id: cycle.id,
    });
  }
  for (const claim of params.targetClaims) {
    pushTimeline(timeline, {
      kind: "target_claim",
      at: claim.claimedAt || claim.heartbeatAt,
      title: stringValue(claim.symbol, stringValue(claim.sourcePath, "target claim")),
      path: claim.sourcePath,
      detail: `${stringValue(claim.status)} / ${stringValue(claim.workerId)}`,
      id: claim.id,
    });
  }
  return timeline.sort((left, right) => timeMs(right.at) - timeMs(left.at));
}

// "2026-06-10T17-00-28-350Z" (filesystem-safe artifact stamp) -> ISO string.
function artifactDirTimestamp(name: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function curatorAgentRuns(stateDir: string): JsonObject[] {
  const curatorRoot = resolve(stateDir, "knowledge_curator");
  if (!existsSync(curatorRoot)) return [];
  try {
    return readdirSync(curatorRoot)
      .filter((name) => {
        try {
          return statSync(resolve(curatorRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((left, right) => right.localeCompare(left))
      .slice(0, 12)
      .map((name) => {
        const dirPath = resolve(curatorRoot, name);
        let outputPath = "";
        try {
          outputPath = readdirSync(dirPath).find((file) => file.endsWith(".txt")) ?? "";
        } catch {
          outputPath = "";
        }
        return {
          id: name,
          startedAt: artifactDirTimestamp(name),
          dir: dirPath,
          outputPath: outputPath ? resolve(dirPath, outputPath) : "",
        };
      });
  } catch {
    return [];
  }
}

function recentCuratedLessons(): JsonObject[] {
  const enrichmentPath = knowledgeCuratorEnrichmentPath();
  return readJsonLines(enrichmentPath, 500)
    .map((record) => ({
      id: stringValue(record.id),
      kind: stringValue(record.kind),
      status: stringValue(record.status),
      title: stringValue(record.title),
      sourcePath: stringValue(record.source_path),
      trustTier: stringValue(record.trust_tier),
      confidence: numberValue(record.confidence, NaN),
      createdAt: stringValue(record.created_at),
    }))
    .sort((left, right) => stringValue(right.createdAt).localeCompare(stringValue(left.createdAt)))
    .slice(0, 24);
}

function mergedPrIntakeRows(graphDbPath: string): JsonObject[] {
  if (!graphDbPath || !existsSync(graphDbPath)) return [];
  try {
    const db = new Database(graphDbPath, { readonly: true });
    try {
      return (
        db
          .query("SELECT pr, merged_at, indexed_at, touched_files_json, graph_delta_json FROM merged_pr_updates ORDER BY indexed_at DESC LIMIT 12")
          .all() as JsonObject[]
      ).map((row) => {
        let touched: unknown[] = [];
        try {
          touched = asArray(JSON.parse(stringValue(row.touched_files_json, "[]")));
        } catch {
          touched = [];
        }
        const delta = readInlineJson(stringValue(row.graph_delta_json, "{}"));
        return {
          pr: numberValue(row.pr, NaN),
          mergedAt: stringValue(row.merged_at),
          indexedAt: stringValue(row.indexed_at),
          touchedFiles: touched.length,
          graphDelta: delta,
        };
      });
    } finally {
      db.close();
    }
  } catch (error) {
    readModelLog("stderr", `merged PR intake read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function knowledgeIntakeSummary(stateDir: string, graphDbPath: string): JsonObject {
  return {
    curatorRuns: curatorAgentRuns(stateDir),
    recentLessons: recentCuratedLessons(),
    mergedPrUpdates: mergedPrIntakeRows(graphDbPath),
    enrichmentPath: knowledgeCuratorEnrichmentPath(),
  };
}

function runDetails(stateDir: string, explicitRunId = "", project: ResolvedProject | null = null): JsonObject {
  const store = openState(stateDir);
  let status: JsonObject;
  let runId = explicitRunId;
  try {
    status = statusSnapshot(store);
    const run = asObject(status.run);
    if (!runId) runId = stringValue(run.id);
  } finally {
    store.db.close();
  }
  if (!runId) return { project: project ? projectSummary(project) : null, stateDir, status, runId: "", summary: {}, timeline: [] };

  const workerStates = workerStatesForRun(stateDir, runId, 0);
  const events = eventsForRun(stateDir, runId, 0);
  const sessions = piSessionsForRun(stateDir, runId);
  const benchmark = modelBenchmark(stateDir, runId);
  const reportSnapshots = reportSnapshotsForRun(stateDir, runId);
  const directorCycles = directorCyclesForRun(stateDir, runId);
  const targetClaims = targetClaimsForRun(stateDir, runId);
  const epochTargets = epochTargetsForRun(stateDir, runId);
  const improvements = improvementRowsFromWorkerStates(workerStates);
  const improvedFiles = fileImprovementRows(improvements);
  const timeline = runTimeline({ workerStates, events, sessions, directorCycles, targetClaims });
  const exactMatches = improvements.reduce((sum, improvement) => sum + numberValue(improvement.exactMatches), 0);

  return {
    project: project ? projectSummary(project) : null,
    stateDir,
    runId,
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      workerStates: workerStates.length,
      workerStateOutcomeCounts: workerStateOutcomeCounts(workerStates),
      positiveAttempts: improvements.reduce((sum, improvement) => sum + numberValue(improvement.attempts), 0),
      exactMatches,
      improvedFiles: improvedFiles.length,
      improvedSymbols: improvements.length,
      totalPositiveDelta: improvements.reduce((sum, improvement) => sum + numberValue(improvement.totalDelta), 0),
      events: events.length,
      piSessions: sessions.length,
      directorCycles: directorCycles.length,
      targetClaims: targetClaims.length,
      epochTargets: epochTargets.length,
      targets: new Set(epochTargets.map((row) => stringValue(row.targetId)).filter(Boolean)).size,
    },
    workerStateOutcomes: workerStateOutcomeCounts(workerStates),
    lifecycleStatuses: countBy(workerStates, "lifecycleStatus"),
    eventTypes: countBy(events, "eventType"),
    sessionRoles: countBy(sessions, "role"),
    sessionStatuses: countBy(sessions, "status"),
    targetClaimStatuses: countBy(targetClaims, "status"),
    epochTargetStatuses: countBy(epochTargets, "epochTargetStatus"),
    timeline,
    workerStates,
    events,
    sessions,
    modelBenchmark: benchmark,
    reportSnapshots,
    directorCycles,
    targetClaims,
    epochTargets,
    improvements,
    improvedFiles,
    knowledgeIntake: knowledgeIntakeSummary(stateDir, project?.graphDbPath ?? ""),
  };
}

function readInlineJson(textValue: string): JsonObject {
  try {
    return asObject(JSON.parse(textValue));
  } catch {
    return {};
  }
}

function zeroTrustedCounts(): JsonObject {
  return {
    newMatches: 0,
    brokenMatches: 0,
    improvements: 0,
    fuzzyRegressions: 0,
    metricRegressions: 0,
    metricProgressions: 0,
  };
}

function staleTrustedReport(report: JsonObject, reason: string): JsonObject {
  return {
    ...report,
    status: "stale",
    staleReason: reason,
    counts: zeroTrustedCounts(),
    newMatches: [],
    brokenMatches: [],
    improvements: [],
    fuzzyRegressions: [],
    metricRegressions: [],
    metricProgressions: [],
  };
}

function emptyTrustedReport(source = "database"): JsonObject {
  return {
    status: "missing",
    path: "",
    source,
    generatedAt: null,
    counts: zeroTrustedCounts(),
    measures: null,
    promotion: null,
    newMatches: [],
    brokenMatches: [],
    improvements: [],
    fuzzyRegressions: [],
    metricRegressions: [],
    metricProgressions: [],
  };
}

function trustedReportFromDatabase(stateDir: string, runId: string): JsonObject {
  if (!runId) return emptyTrustedReport("database");
  const report = dashboardArtifactPayload(stateDir, {
    runId,
    artifactType: "trusted_report",
    artifactKey: "current",
  });
  return Object.keys(report).length > 0 ? report : emptyTrustedReport("database");
}

function runScopedTrustedReport(report: JsonObject, runCreatedAt: string, reportName = "saved report"): JsonObject {
  if (stringValue(report.status) !== "ready") return report;
  const reportMs = timeMs(report.generatedAt);
  const runMs = timeMs(runCreatedAt);
  if (reportMs > 0 && runMs > 0 && reportMs < runMs) {
    return staleTrustedReport(report, `${reportName} was generated before the current run`);
  }
  return report;
}

async function runDashboard(paths: DashboardProjectContext): Promise<JsonObject> {
  const { stateDir } = paths;
  let repoRoot = paths.repoRoot;
  const store = openState(stateDir);
  let status: JsonObject;
  let runId = "";
  let runCreatedAt = "";
  let runDesiredWorkers = 0;
  let projectSession: JsonObject | null = null;
  try {
    status = statusSnapshot(store);
    const run = asObject(status.run);
    runId = stringValue(run.id);
    runCreatedAt = stringValue(run.createdAt);
    runDesiredWorkers = numberValue(run.desiredWorkers, 0);
    if (paths.project) projectSession = activeProjectSessionProjection(store.db, paths.project.projectId) as unknown as JsonObject | null;
    projectSession = enrichProjectSessionBaseline(projectSession);
    if (!paths.usePathOverrides) repoRoot = activeSessionRepoRoot(projectSession, runId) || stringValue(asObject(run.project).repoRoot, repoRoot);
  } finally {
    store.db.close();
  }

  const initialSnapshot = runId ? latestInitialSnapshot(stateDir, runId) : {};
  let initialMeasures = compactMeasures(measuresFromSnapshot(initialSnapshot));
  const campaign = dashboardDeps().campaignStatus(repoRoot, stateDir, paths.project?.baseRef ?? "origin/master");
  const sessionBaseline = sessionBaselineBoard(projectSession, runId);
  let currentBoard = loadCurrentBoard(stateDir, runId, campaign);
  if (!summaryHasValue(asObject(currentBoard.measures)) && sessionBaseline) {
    currentBoard = {
      ...currentBoard,
      ...sessionBaseline,
      error: currentBoard.error,
      source: "session_baseline",
    } as typeof currentBoard;
  }
  // With no run baseline, "start" is the campaign anchor: the last save point.
  // A future run measures forward from here, and until then the metric table
  // shows drift since the anchor instead of n/a.
  let initialSource: string | null = runId ? "run" : null;
  let initialGeneratedAt: unknown = initialSnapshot.generatedAt ?? null;
  if (sessionBaseline) {
    initialMeasures = asObject(sessionBaseline.measures);
    initialSource = "session_baseline";
    initialGeneratedAt = sessionBaseline.generatedAt ?? null;
  }
  if (!Object.values(initialMeasures).some((value) => Number.isFinite(Number(value)))) {
    const savePoint = asObject(campaign.savePoint);
    const savePointMeasures = asObject(asObject(savePoint.payload).measures);
    if (Object.keys(savePointMeasures).length > 0) {
      initialMeasures = compactMeasures(savePointMeasures);
      initialSource = "save_point";
      initialGeneratedAt = savePoint.createdAt ?? null;
    }
  }
  const workerStates = runId ? workerStatesForRun(stateDir, runId, 100) : [];
  const allWorkerStates = runId ? workerStatesForRun(stateDir, runId, 0) : [];
  const progressWorkerStates = workerStates.filter((workerState) => {
    const outcome = workerStateOutcome(workerState);
    return outcome === "exact" || outcome === "improved";
  });
  const improvements = improvementRowsFromWorkerStates(allWorkerStates);
  const improvedFiles = fileImprovementRows(improvements);
  const epochTargets = runId ? epochTargetsForRun(stateDir, runId) : [];
  const trustedReport = runScopedTrustedReport(trustedReportFromDatabase(stateDir, runId), runCreatedAt);
  const checkpoint = runId ? checkpointForRun(stateDir, runId) : null;
  const handoff = runId ? handoffForRun(stateDir, runId, checkpoint) : { checkpoint: null, qa: null, splitPlan: null };
  const epochs = runningEpochHistory(stateDir);
  return {
    project: paths.project ? projectSummary(paths.project) : null,
    projectSession,
    projectWarnings: paths.project?.warnings ?? [],
    repoRoot,
    configuredRepoRoot: paths.repoRoot,
    stateDir,
    graphDbPath: paths.graphDbPath,
    usePathOverrides: paths.usePathOverrides,
    status,
    initial: {
      generatedAt: initialGeneratedAt,
      measures: initialMeasures,
      source: initialSource,
    },
    current: currentBoard,
    trustedReport,
    checkpoint,
    handoff,
    runSummary: runSummary(status, allWorkerStates, initialMeasures, currentBoard.measures, improvements, trustedReport as unknown as JsonObject),
    improvements,
    improvedFiles,
    activeFiles: runId ? activeFilesForRun(stateDir, runId) : [],
    epochTargets,
    workerStates,
    progressWorkerStates,
    // Telemetry (Track B): per-model leaderboard, token/cost sessions, and the
    // dense match-over-time series feeding the Model Benchmark panel.
    modelBenchmark: runId ? modelBenchmark(stateDir, runId) : { leaderboard: [] },
    piSessions: runId ? piSessionsForRun(stateDir, runId) : [],
    reportSnapshots: runId ? reportSnapshotsForRun(stateDir, runId) : [],
    // Observability panels: fuzzy-match distribution (from the build report),
    // per-function token/cost, and the permuter-farm status.
    fuzzyBands: fuzzyBandsFromReport(repoRoot),
    functionTokens: runId ? functionTokenUsage(stateDir, runId) : [],
    permuterFarms: permuterFarms(stateDir),
    functionCost: permuterFunctionCost(stateDir),
    touchedFiles: touchedFilesFromWorkerStates(allWorkerStates),
    events: runId ? eventsForRun(stateDir, runId, 40) : [],
    process: dashboardDeps().processStatus(stateDir, paths.project),
    campaign,
    epochs,
    checkpointProgress: runId
      ? runningEpochCheckpointProgress({
          stateDir,
          runId,
          epochs,
          workerStates: allWorkerStates,
          runCreatedAt,
          desiredWorkers: runDesiredWorkers,
        })
      : null,
    prs: dashboardDeps().buildPrRecordsView(stateDir, runId),
  };
}
