import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkerReportType } from "../types/index.js";
import { immediateTransaction, now, withBusyRetry, type StateStore } from "../state/db.js";

export type CheckpointDisposition =
  | "pr_candidate"
  | "improvement_candidate"
  | "deferred_patch"
  | "needs_fact"
  | "stalled"
  | "needs_rework"
  | "tool_error"
  | "review_required";

export interface ImprovementPromotionPolicy {
  minGainPoints: number;
  minMatchedBytes: number;
}

export const defaultImprovementPromotion: ImprovementPromotionPolicy = {
  minGainPoints: 2,
  minMatchedBytes: 64,
};

// Only exact matches ship. Improvement candidates are the notable local
// improvements (above the promotion floors) — tracked so the operator can see
// what is close, but they stay on the local branch until they become matches.
export function shipsInPr(disposition: CheckpointDisposition | string): boolean {
  return disposition === "pr_candidate";
}

export interface RunCheckpointItem {
  id: string;
  checkpointId: string;
  runId: string;
  reportId: string;
  leaseId: string;
  targetKey: string;
  unit: string;
  symbol: string;
  sourcePath: string;
  reportType: string;
  disposition: CheckpointDisposition;
  itemStatus: "pending";
  exactMatch: boolean;
  prCandidate: boolean;
  patchPath: string;
  summaryPath: string;
  reportSummary: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface RunCheckpointResult {
  checkpoint: {
    id: string;
    runId: string;
    checkpointType: string;
    status: string;
    artifactDir: string;
    summaryPath: string;
    prCandidatesPath: string;
    carryForwardPath: string;
    createdAt: string;
  };
  counts: Record<string, number>;
  items: RunCheckpointItem[];
}

interface WorkerReportRow {
  report_id?: unknown;
  lease_id?: unknown;
  report_type?: unknown;
  summary_path?: unknown;
  facts_path?: unknown;
  blocker_path?: unknown;
  patch_path?: unknown;
  created_at?: unknown;
  worker_id?: unknown;
  lease_status?: unknown;
  queue_status?: unknown;
  unit?: unknown;
  symbol?: unknown;
  source_path?: unknown;
}

interface CreateRunCheckpointOptions {
  allowActiveLeases?: boolean;
  artifactDir?: string;
  checkpointType?: string;
  improvementPromotion?: Partial<ImprovementPromotionPolicy>;
  now?: string;
  /**
   * Symbols that broke or regressed against the freshly rebuilt production
   * baseline. Items for these symbols are pulled out of the shipping lanes and
   * recorded as needs_rework instead.
   */
  reworkSymbols?: string[];
  title?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function artifactTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!path || !existsSync(path)) return {};
  try {
    return asObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

function percentLike(value: unknown): boolean {
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
}

function attemptOldScore(attempt: Record<string, unknown>): unknown {
  return "oldScore" in attempt ? attempt.oldScore : attempt.old_score;
}

function attemptNewScore(attempt: Record<string, unknown>): unknown {
  return "newScore" in attempt ? attempt.newScore : attempt.new_score;
}

function attemptHasPercentScores(attempt: Record<string, unknown>): boolean {
  const oldScore = attemptOldScore(attempt);
  const newScore = attemptNewScore(attempt);
  if (!percentLike(oldScore) || !percentLike(newScore)) return false;
  const oldValue = numberValue(oldScore, NaN);
  const newValue = numberValue(newScore, NaN);
  const delta = numberValue("delta" in attempt ? attempt.delta : null, NaN);
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) return true;
  const scoreMovement = newValue - oldValue;
  return Math.abs(scoreMovement) < 0.0005 || Math.sign(delta) === Math.sign(scoreMovement);
}

function exactMatchAttempts(summary: Record<string, unknown>): Record<string, unknown>[] {
  const agentReport = asObject(summary.agent_report);
  return asArray(agentReport.attempts)
    .map(asObject)
    .filter((attempt) => {
      if (!attemptHasPercentScores(attempt)) return false;
      return numberValue(attemptOldScore(attempt), NaN) < 99.99999 && numberValue(attemptNewScore(attempt), NaN) >= 99.99999;
    });
}

function runnerValidatedExact(summary: Record<string, unknown>): boolean {
  const runnerValidation = asObject(summary.runner_validation);
  if (stringValue(runnerValidation.status) !== "passed") return false;
  return asObject(runnerValidation.target).exact === true;
}

function reportCleanEnoughForPr(summary: Record<string, unknown>, reportType: string): boolean {
  if (reportType !== "progress" && reportType !== "score_candidate") return false;
  const acceptanceGate = asObject(summary.acceptance_gate);
  const runnerValidation = asObject(summary.runner_validation);
  const repairAttempts = asObject(summary.repair_attempts);
  return acceptanceGate.accepted !== false && stringValue(runnerValidation.status) === "passed" && repairAttempts.exhausted !== true;
}

export interface ImprovementPromotionEvaluation {
  promoted: boolean;
  gain_points: number | null;
  target_before: number | null;
  target_after: number | null;
  function_size_bytes: number | null;
  estimated_matched_bytes: number | null;
  min_gain_points: number;
  min_matched_bytes: number;
  reasons: string[];
}

function baselineFunctionSize(runnerValidation: Record<string, unknown>, symbol: string): number | null {
  const snapshot = readJsonObject(stringValue(runnerValidation.baselinePath));
  for (const row of asArray(snapshot.functions).map(asObject)) {
    if (stringValue(row.name) !== symbol) continue;
    const size = numberValue(row.size, NaN);
    return Number.isFinite(size) && size > 0 ? size : null;
  }
  return null;
}

// Improvements only ship when the runner-measured gain clears both floors:
// the gain floor keeps near-99% noise local (a >=2pt gain cannot exist above
// 98%, where pseudo-positive score wiggle is most common), and the byte floor
// keeps one-instruction wins on tiny functions local. Missing measurements
// never promote; the reasons make every hold auditable in the evidence.
function evaluateImprovementPromotion(summary: Record<string, unknown>, symbol: string, policy: ImprovementPromotionPolicy): ImprovementPromotionEvaluation {
  const runnerValidation = asObject(summary.runner_validation);
  const target = asObject(runnerValidation.target);
  const before = numberValue(target.before, NaN);
  const after = numberValue(target.after, NaN);
  const reasons: string[] = [];
  const evaluation: ImprovementPromotionEvaluation = {
    promoted: false,
    gain_points: null,
    target_before: Number.isFinite(before) ? before : null,
    target_after: Number.isFinite(after) ? after : null,
    function_size_bytes: null,
    estimated_matched_bytes: null,
    min_gain_points: policy.minGainPoints,
    min_matched_bytes: policy.minMatchedBytes,
    reasons,
  };
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    reasons.push("runner validation target scores are unavailable");
    return evaluation;
  }
  const gain = Number((after - before).toFixed(6));
  evaluation.gain_points = gain;
  if (gain < policy.minGainPoints) {
    reasons.push(`gain ${gain >= 0 ? "+" : ""}${gain} is below the ${policy.minGainPoints}pt promotion floor`);
  }
  const size = baselineFunctionSize(runnerValidation, symbol);
  evaluation.function_size_bytes = size;
  if (size === null) {
    reasons.push("target function size is unavailable in the baseline snapshot; promotion requires a measurable byte delta");
  } else {
    const estimatedBytes = Math.round((size * gain) / 100);
    evaluation.estimated_matched_bytes = estimatedBytes;
    if (estimatedBytes < policy.minMatchedBytes) {
      reasons.push(`estimated matched-byte delta ${estimatedBytes} is below the ${policy.minMatchedBytes}-byte promotion floor`);
    }
  }
  evaluation.promoted = reasons.length === 0;
  if (evaluation.promoted) {
    reasons.push(`gain +${gain}pts and ~${evaluation.estimated_matched_bytes} matched bytes clear the promotion floors`);
  }
  return evaluation;
}

function dispositionForReport(params: {
  exactMatch: boolean;
  improvement: ImprovementPromotionEvaluation | null;
  regressedAgainstBaseline: boolean;
  reportType: string;
  summary: Record<string, unknown>;
}): CheckpointDisposition {
  if (params.reportType === "needs_fact") return "needs_fact";
  if (params.reportType === "needs_rework") return "needs_rework";
  if (params.reportType === "tool_error") return "tool_error";
  if (params.reportType === "stalled_no_useful_guess") return "stalled";
  if (!reportCleanEnoughForPr(params.summary, params.reportType)) return "review_required";
  if (params.regressedAgainstBaseline) return "needs_rework";
  if (params.exactMatch) return "pr_candidate";
  return params.improvement?.promoted ? "improvement_candidate" : "deferred_patch";
}

function checkpointCounts(items: RunCheckpointItem[]): Record<string, number> {
  const counts: Record<string, number> = {
    total: items.length,
    pr_candidate: 0,
    improvement_candidate: 0,
    deferred_patch: 0,
    needs_fact: 0,
    stalled: 0,
    needs_rework: 0,
    tool_error: 0,
    review_required: 0,
    exact_match: 0,
    carry_forward: 0,
  };
  for (const item of items) {
    counts[item.disposition] = numberValue(counts[item.disposition]) + 1;
    if (item.exactMatch) counts.exact_match += 1;
    if (!shipsInPr(item.disposition)) counts.carry_forward += 1;
  }
  return counts;
}

function targetKey(unit: string, symbol: string): string {
  return `${unit || "unknown"}::${symbol || "unknown"}`;
}

function itemFromRow(row: WorkerReportRow, checkpointId: string, runId: string, createdAt: string, policy: ImprovementPromotionPolicy, reworkSymbols: Set<string>): RunCheckpointItem {
  const summaryPath = stringValue(row.summary_path);
  const summary = readJsonObject(summaryPath);
  const agentReport = asObject(summary.agent_report);
  const target = { ...asObject(summary.target), ...asObject(agentReport.target) };
  const unit = stringValue(target.unit, stringValue(row.unit));
  const symbol = stringValue(target.symbol, stringValue(row.symbol));
  const sourcePath = stringValue(target.source_path, stringValue(row.source_path));
  const reportType = stringValue(row.report_type);
  const exactEvidence = exactMatchAttempts(summary);
  const exactMatch = exactEvidence.length > 0 && runnerValidatedExact(summary);
  const improvement = exactMatch ? null : evaluateImprovementPromotion(summary, symbol, policy);
  const regressedAgainstBaseline = Boolean(symbol) && reworkSymbols.has(symbol);
  const disposition = dispositionForReport({ exactMatch, improvement, regressedAgainstBaseline, reportType, summary });
  const patchPath = stringValue(row.patch_path, stringValue(agentReport.patch_path));
  const reportSummary = stringValue(summary.summary, "Worker report was persisted without a summary.");
  const evidence = {
    worker_id: stringValue(row.worker_id),
    lease_status: stringValue(row.lease_status),
    queue_status: stringValue(row.queue_status),
    report_created_at: stringValue(row.created_at),
    facts_path: stringValue(row.facts_path),
    blocker_path: stringValue(row.blocker_path),
    acceptance_gate: asObject(summary.acceptance_gate),
    runner_validation: asObject(summary.runner_validation),
    repair_attempts: asObject(summary.repair_attempts),
    exact_match_attempts: exactEvidence.map((attempt) => ({
      description: stringValue(attempt.description),
      old_score: numberValue(attemptOldScore(attempt), NaN),
      new_score: numberValue(attemptNewScore(attempt), NaN),
      delta: numberValue(attempt.delta, NaN),
      artifact_path: stringValue(attempt.artifact_path),
    })),
    ...(improvement ? { improvement_promotion: improvement } : {}),
    ...(regressedAgainstBaseline
      ? { baseline_regression: { reason: "symbol broke or regressed against the rebuilt production baseline; pulled from shipping lanes for rework" } }
      : {}),
  };
  return {
    id: randomUUID(),
    checkpointId,
    runId,
    reportId: stringValue(row.report_id),
    leaseId: stringValue(row.lease_id),
    targetKey: targetKey(unit, symbol),
    unit,
    symbol,
    sourcePath,
    reportType,
    disposition,
    itemStatus: "pending",
    exactMatch,
    prCandidate: disposition === "pr_candidate",
    patchPath,
    summaryPath,
    reportSummary,
    evidence,
    createdAt,
  };
}

function activeLeaseCount(store: StateStore, runId: string): number {
  const row = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT COUNT(*) AS count
            FROM leases
            JOIN queue ON queue.id = leases.queue_id
            WHERE queue.run_id = ?
              AND leases.status = 'active'
          `,
        )
        .get(runId) as Record<string, unknown>,
  );
  return numberValue(row.count);
}

function workerReportRows(store: StateStore, runId: string): WorkerReportRow[] {
  return withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT
              worker_reports.id AS report_id,
              worker_reports.lease_id,
              worker_reports.report_type,
              worker_reports.summary_path,
              worker_reports.facts_path,
              worker_reports.blocker_path,
              worker_reports.patch_path,
              worker_reports.created_at,
              leases.worker_id,
              leases.status AS lease_status,
              queue.status AS queue_status,
              targets.unit,
              targets.symbol,
              targets.source_path
            FROM worker_reports
            LEFT JOIN leases ON leases.id = worker_reports.lease_id
            LEFT JOIN queue ON queue.id = leases.queue_id
            LEFT JOIN targets ON targets.id = queue.target_id
            WHERE queue.run_id = ?
            ORDER BY worker_reports.created_at DESC
          `,
        )
        .all(runId) as WorkerReportRow[],
  );
}

function markdownTable(items: RunCheckpointItem[]): string[] {
  if (items.length === 0) return ["No items."];
  const lines = ["| Disposition | Symbol | Source | Report | Patch | Evidence |", "| - | - | - | - | - | - |"];
  for (const item of items) {
    const promotion = asObject(item.evidence.improvement_promotion);
    const evidence = item.exactMatch
      ? "exact percent attempt"
      : item.disposition === "improvement_candidate"
        ? `${numberValue(promotion.target_before, NaN)} -> ${numberValue(promotion.target_after, NaN)} (+${numberValue(promotion.gain_points, NaN)}pts, ~${numberValue(promotion.estimated_matched_bytes, NaN)} bytes)`
        : item.disposition.replace(/_/g, " ");
    lines.push(
      `| ${item.disposition} | \`${item.symbol || "-"}\` | \`${item.sourcePath || "-"}\` | ${item.reportId || "-"} | ${
        item.patchPath ? `\`${item.patchPath}\`` : "-"
      } | ${evidence} |`,
    );
  }
  return lines;
}

function writeArtifacts(params: {
  artifactDir: string;
  carryForwardPath: string;
  checkpoint: RunCheckpointResult["checkpoint"];
  counts: Record<string, number>;
  items: RunCheckpointItem[];
  prCandidatesPath: string;
  summaryPath: string;
  title: string;
}): void {
  mkdirSync(params.artifactDir, { recursive: true });
  const prCandidates = params.items.filter((item) => item.disposition === "pr_candidate");
  const improvementCandidates = params.items.filter((item) => item.disposition === "improvement_candidate");
  const carryForward = params.items.filter((item) => !shipsInPr(item.disposition));
  const payload = {
    checkpoint: params.checkpoint,
    counts: params.counts,
    pr_candidates: prCandidates,
    improvement_candidates: improvementCandidates,
    carry_forward: carryForward,
    items: params.items,
  };
  writeFileSync(params.summaryPath, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(
    params.prCandidatesPath,
    [
      `# ${params.title}: PR Candidates`,
      "",
      `Run: \`${params.checkpoint.runId}\``,
      `Checkpoint: \`${params.checkpoint.id}\``,
      "",
      `${prCandidates.length} exact-match candidate(s) ship. Only matches that survive the full build and regression gate go into PRs; everything else stays on the local branch.`,
      "",
      ...markdownTable(prCandidates),
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    params.carryForwardPath,
    [
      `# ${params.title}: Carry Forward`,
      "",
      `Run: \`${params.checkpoint.runId}\``,
      `Checkpoint: \`${params.checkpoint.id}\``,
      "",
      `${carryForward.length} item(s) stay local: notable improvements, deferred patches, fact requests, rework, tool errors, and stalls.`,
      "",
      "## Notable improvements (closest to matching)",
      "",
      `${improvementCandidates.length} validated improvement(s) cleared the promotion floors. They do not ship; they are the best next targets.`,
      "",
      ...markdownTable(improvementCandidates),
      "",
      "## Everything else",
      "",
      ...markdownTable(carryForward.filter((item) => item.disposition !== "improvement_candidate")),
      "",
    ].join("\n"),
    "utf8",
  );
}

function persistCheckpoint(store: StateStore, result: RunCheckpointResult): void {
  const insertCheckpoint = store.db.query(
    `
      INSERT INTO run_checkpoints
      (id, run_id, checkpoint_type, status, artifact_dir, summary_path, pr_candidates_path, carry_forward_path, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertItem = store.db.query(
    `
      INSERT INTO checkpoint_items
      (id, checkpoint_id, run_id, report_id, lease_id, target_key, unit, symbol, source_path, report_type, disposition, item_status, exact_match, pr_candidate, patch_path, summary_path, report_summary, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  immediateTransaction(store.db, () => {
    insertCheckpoint.run(
      result.checkpoint.id,
      result.checkpoint.runId,
      result.checkpoint.checkpointType,
      result.checkpoint.status,
      result.checkpoint.artifactDir,
      result.checkpoint.summaryPath,
      result.checkpoint.prCandidatesPath,
      result.checkpoint.carryForwardPath,
      result.checkpoint.createdAt,
      JSON.stringify({ counts: result.counts }),
    );
    for (const item of result.items) {
      insertItem.run(
        item.id,
        item.checkpointId,
        item.runId,
        item.reportId || null,
        item.leaseId || null,
        item.targetKey,
        item.unit || null,
        item.symbol || null,
        item.sourcePath || null,
        item.reportType,
        item.disposition,
        item.itemStatus,
        boolValue(item.exactMatch) ? 1 : 0,
        boolValue(item.prCandidate) ? 1 : 0,
        item.patchPath || null,
        item.summaryPath || null,
        item.reportSummary,
        JSON.stringify(item.evidence),
        item.createdAt,
      );
    }
  });
}

export function createRunCheckpoint(store: StateStore, runId: string, options: CreateRunCheckpointOptions = {}): RunCheckpointResult {
  const activeLeases = activeLeaseCount(store, runId);
  if (activeLeases > 0 && !options.allowActiveLeases) {
    throw new Error(`Run ${runId} still has ${activeLeases} active lease(s); drain or recover them before checkpointing.`);
  }

  const createdAt = options.now ?? now();
  const checkpointId = randomUUID();
  const artifactDir = resolve(options.artifactDir ?? resolve(store.stateDir, "runs", runId, "checkpoints", artifactTimestamp(createdAt)));
  const summaryPath = resolve(artifactDir, "checkpoint.json");
  const prCandidatesPath = resolve(artifactDir, "pr_candidates.md");
  const carryForwardPath = resolve(artifactDir, "carry_forward.md");
  const checkpoint = {
    id: checkpointId,
    runId,
    checkpointType: options.checkpointType ?? "pr_handoff",
    status: "open",
    artifactDir,
    summaryPath,
    prCandidatesPath,
    carryForwardPath,
    createdAt,
  };
  const policy: ImprovementPromotionPolicy = {
    minGainPoints: options.improvementPromotion?.minGainPoints ?? defaultImprovementPromotion.minGainPoints,
    minMatchedBytes: options.improvementPromotion?.minMatchedBytes ?? defaultImprovementPromotion.minMatchedBytes,
  };
  const reworkSymbols = new Set((options.reworkSymbols ?? []).filter(Boolean));
  const items = workerReportRows(store, runId).map((row) => itemFromRow(row, checkpointId, runId, createdAt, policy, reworkSymbols));
  const counts = checkpointCounts(items);
  const result = { checkpoint, counts, items };
  writeArtifacts({
    artifactDir,
    carryForwardPath,
    checkpoint,
    counts,
    items,
    prCandidatesPath,
    summaryPath,
    title: options.title ?? "Run checkpoint",
  });
  persistCheckpoint(store, result);
  return result;
}

export function latestCheckpointSummary(store: StateStore, runId: string): Record<string, unknown> | null {
  const checkpoint = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT id, run_id, checkpoint_type, status, artifact_dir, summary_path, pr_candidates_path, carry_forward_path, created_at, payload_json
            FROM run_checkpoints
            WHERE run_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(runId) as Record<string, unknown> | undefined,
  );
  if (!checkpoint) return null;
  const countsRows = withBusyRetry(
    () =>
      store.db
        .query(
          `
            SELECT disposition, COUNT(*) AS count
            FROM checkpoint_items
            WHERE checkpoint_id = ?
            GROUP BY disposition
          `,
        )
        .all(String(checkpoint.id)) as Record<string, unknown>[],
  );
  return {
    id: checkpoint.id,
    runId: checkpoint.run_id,
    checkpointType: checkpoint.checkpoint_type,
    status: checkpoint.status,
    artifactDir: checkpoint.artifact_dir,
    summaryPath: checkpoint.summary_path,
    prCandidatesPath: checkpoint.pr_candidates_path,
    carryForwardPath: checkpoint.carry_forward_path,
    createdAt: checkpoint.created_at,
    counts: Object.fromEntries(countsRows.map((row) => [String(row.disposition), numberValue(row.count)])),
  };
}
