import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCommand } from "@server/infrastructure/shell";
import {
  addEvent,
  claimNextWorkerOutputIntegration,
  updateWorkerOutputIntegration,
  workerOutputIntegrationQueueSummary,
  type StateStore,
  type WorkerOutputIntegrationRecord,
  type WorkerOutputIntegrationStatus,
} from "@server/core/session-runtime/run-state";

export interface WorkerOutputIntegrationApplyResult {
  id: string;
  status: WorkerOutputIntegrationStatus;
  disposition: string | null;
  patchPath: string | null;
  itemPath: string | null;
  summaryPath: string | null;
  failureReasons: string[];
  conflictPaths: string[];
}

export interface WorkerOutputIntegrationQueueResult {
  processed: WorkerOutputIntegrationApplyResult[];
  queueSummary: Record<string, unknown>;
}

interface ApplyArtifacts {
  artifactDir: string;
  summaryPath: string;
  itemPath: string;
  queueSummaryPath: string;
  checkStdoutPath: string;
  checkStderrPath: string;
  applyStdoutPath: string;
  applyStderrPath: string;
}

function outputTail(text: string, maxChars = 2000): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractConflictPaths(text: string, writeSet: string[]): string[] {
  const paths: string[] = [];
  const patterns = [
    /(?:patch failed|error):\s+([^:\n]+):/g,
    /error:\s+([^\n]+): patch does not apply/g,
    /Checking patch\s+(.+?)\.\.\./g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) paths.push(match[1]);
    }
  }
  return uniqueStrings(paths.length > 0 ? paths : writeSet);
}

function integrationArtifacts(stateDir: string, runId: string, id: string): ApplyArtifacts {
  const artifactDir = resolve(stateDir, "runs", runId, "worker_integrations", id);
  return {
    artifactDir,
    summaryPath: resolve(artifactDir, "summary.json"),
    itemPath: resolve(artifactDir, "integration_conflict_item.json"),
    queueSummaryPath: resolve(artifactDir, "integration_queue_summary.json"),
    checkStdoutPath: resolve(artifactDir, "git_apply_check.stdout.txt"),
    checkStderrPath: resolve(artifactDir, "git_apply_check.stderr.txt"),
    applyStdoutPath: resolve(artifactDir, "git_apply.stdout.txt"),
    applyStderrPath: resolve(artifactDir, "git_apply.stderr.txt"),
  };
}

function targetSnapshot(store: StateStore, record: WorkerOutputIntegrationRecord): Record<string, unknown> {
  const row = store.db
    .query(
      `
        SELECT unit, symbol, source_path, size, baseline_score, target_key
        FROM epoch_targets
        WHERE id = ?
      `,
    )
    .get(record.epochTargetId) as Record<string, unknown> | undefined;
  return {
    epoch_target_id: record.epochTargetId,
    target_key: record.targetKey ?? row?.target_key ?? null,
    unit: row?.unit ?? null,
    symbol: row?.symbol ?? null,
    source_path: row?.source_path ?? null,
    size: row?.size ?? null,
    baseline_score: row?.baseline_score ?? null,
  };
}

function checkpointSnapshot(store: StateStore, record: WorkerOutputIntegrationRecord): Record<string, unknown> {
  if (!record.workerCheckpointId) return {};
  const row = store.db.query("SELECT * FROM worker_checkpoints WHERE id = ?").get(record.workerCheckpointId) as Record<string, unknown> | undefined;
  if (!row) return {};
  return {
    id: String(row.id),
    attempt_index: row.attempt_index,
    validation_time: row.validation_time,
    old_score: row.old_score,
    new_score: row.new_score,
    delta: row.delta,
    exact_match: Number(row.exact_match) === 1,
    hard_gates_passed: Number(row.hard_gates_passed) === 1,
    selectable: Number(row.selectable) === 1,
    selected: Number(row.selected) === 1,
    validation_status: row.validation_status,
    artifact_path: row.artifact_path,
    patch_path: row.patch_path,
    diff_path: row.diff_path,
  };
}

function conflictItem(params: {
  record: WorkerOutputIntegrationRecord;
  target: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutPath: string;
  stderrPath: string;
  conflictPaths: string[];
  failureReasons: string[];
}): Record<string, unknown> {
  return {
    schema_version: "integration_conflict_item_v1",
    id: params.record.id,
    queue_item_id: params.record.id,
    run_id: params.record.sessionId,
    epoch_id: params.record.epochId,
    epoch_target_id: params.record.epochTargetId,
    target_claim_id: params.record.targetClaimId,
    conflict_group_id: `worker-output:${params.record.id}`,
    target: params.target,
    failed_apply: {
      command: params.command.join(" "),
      exit_code: params.exitCode,
      stdout_path: params.stdoutPath,
      stderr_path: params.stderrPath,
      stdout_tail: outputTail(params.stdout, 1000),
      stderr_tail: outputTail(params.stderr, 1000),
    },
    conflict_paths: params.conflictPaths,
    failure_reasons: params.failureReasons,
    worker_outputs: [
      {
        worker_state_id: params.record.workerStateId,
        checkpoint_id: params.record.workerCheckpointId,
        target_claim_id: params.record.targetClaimId,
        epoch_target_id: params.record.epochTargetId,
        patch_path: params.record.patchPath,
        diff_path: params.record.diffPath,
        write_set: params.record.writeSet,
        checkpoint: params.checkpoint,
      },
    ],
    created_at: new Date().toISOString(),
  };
}

async function writeSummary(path: string, result: WorkerOutputIntegrationApplyResult, extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(path, `${JSON.stringify({ ...result, ...extra }, null, 2)}\n`);
}

async function updateAndSummarize(
  store: StateStore,
  record: WorkerOutputIntegrationRecord,
  update: {
    status: WorkerOutputIntegrationStatus;
    disposition: string | null;
    artifacts: ApplyArtifacts;
    failureReasons?: string[];
    conflictPaths?: string[];
    checkStdoutPath?: string | null;
    checkStderrPath?: string | null;
    applyStdoutPath?: string | null;
    applyStderrPath?: string | null;
    itemPath?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<WorkerOutputIntegrationApplyResult> {
  const updated = updateWorkerOutputIntegration(store, record.id, {
    status: update.status,
    disposition: update.disposition,
    summaryPath: update.artifacts.summaryPath,
    itemPath: update.itemPath ?? null,
    checkStdoutPath: update.checkStdoutPath ?? null,
    checkStderrPath: update.checkStderrPath ?? null,
    applyStdoutPath: update.applyStdoutPath ?? null,
    applyStderrPath: update.applyStderrPath ?? null,
    failureReasons: update.failureReasons ?? [],
    conflictPaths: update.conflictPaths ?? [],
    metadata: update.metadata,
  });
  const result: WorkerOutputIntegrationApplyResult = {
    id: updated.id,
    status: updated.status,
    disposition: updated.disposition,
    patchPath: updated.patchPath,
    itemPath: updated.itemPath,
    summaryPath: updated.summaryPath,
    failureReasons: updated.failureReasons,
    conflictPaths: updated.conflictPaths,
  };
  await writeSummary(update.artifacts.summaryPath, result, {
    queue_record: {
      worker_state_id: updated.workerStateId,
      worker_checkpoint_id: updated.workerCheckpointId,
      target_claim_id: updated.targetClaimId,
      epoch_target_id: updated.epochTargetId,
      write_set: updated.writeSet,
    },
  });
  return result;
}

async function applyClaimedWorkerOutput(params: {
  dryRun: boolean;
  repoRoot: string;
  stateDir: string;
  store: StateStore;
  record: WorkerOutputIntegrationRecord;
}): Promise<WorkerOutputIntegrationApplyResult> {
  const artifacts = integrationArtifacts(params.stateDir, params.record.sessionId, params.record.id);
  await mkdir(artifacts.artifactDir, { recursive: true });

  if (params.dryRun) {
    const result = await updateAndSummarize(params.store, params.record, {
      status: "skipped",
      disposition: "dry_run",
      artifacts,
      failureReasons: ["dry-run agents do not apply worker output patches"],
    });
    addEvent(params.store, params.record.sessionId, "worker_integration_skipped", "worker-output-integration", result);
    return result;
  }

  if (!params.record.patchPath || !existsSync(params.record.patchPath)) {
    const result = await updateAndSummarize(params.store, params.record, {
      status: "failed",
      disposition: "missing_patch",
      artifacts,
      failureReasons: [`selected checkpoint patch is missing: ${params.record.patchPath ?? "(none)"}`],
    });
    addEvent(params.store, params.record.sessionId, "worker_integration_conflict", "worker-output-integration", result);
    return result;
  }

  const patchText = await readFile(params.record.patchPath, "utf8");
  if (!patchText.trim()) {
    const result = await updateAndSummarize(params.store, params.record, {
      status: "skipped",
      disposition: "empty_patch",
      artifacts,
      failureReasons: ["selected checkpoint patch was empty"],
    });
    addEvent(params.store, params.record.sessionId, "worker_integration_skipped", "worker-output-integration", result);
    return result;
  }

  const checkCommand = ["git", "apply", "--check", params.record.patchPath];
  const check = await runCommand(params.repoRoot, checkCommand);
  await writeFile(artifacts.checkStdoutPath, check.stdout);
  await writeFile(artifacts.checkStderrPath, check.stderr);
  if (check.exitCode !== 0) {
    const conflictPaths = extractConflictPaths(`${check.stdout}\n${check.stderr}`, params.record.writeSet);
    const failureReasons = [`git apply --check exited ${check.exitCode}: ${outputTail(check.stderr || check.stdout, 1000)}`];
    const item = conflictItem({
      record: params.record,
      target: targetSnapshot(params.store, params.record),
      checkpoint: checkpointSnapshot(params.store, params.record),
      command: checkCommand,
      exitCode: check.exitCode,
      stdout: check.stdout,
      stderr: check.stderr,
      stdoutPath: artifacts.checkStdoutPath,
      stderrPath: artifacts.checkStderrPath,
      conflictPaths,
      failureReasons,
    });
    await writeFile(artifacts.itemPath, `${JSON.stringify(item, null, 2)}\n`);
    const result = await updateAndSummarize(params.store, params.record, {
      status: "conflict",
      disposition: "apply_check_failed",
      artifacts,
      itemPath: artifacts.itemPath,
      checkStdoutPath: artifacts.checkStdoutPath,
      checkStderrPath: artifacts.checkStderrPath,
      failureReasons,
      conflictPaths,
      metadata: { queue_summary_path: artifacts.queueSummaryPath },
    });
    await writeFile(artifacts.queueSummaryPath, `${JSON.stringify(workerOutputIntegrationQueueSummary(params.store, params.record.sessionId), null, 2)}\n`);
    addEvent(params.store, params.record.sessionId, "worker_integration_conflict", "worker-output-integration", result);
    return result;
  }

  const applyCommand = ["git", "apply", params.record.patchPath];
  const apply = await runCommand(params.repoRoot, applyCommand);
  await writeFile(artifacts.applyStdoutPath, apply.stdout);
  await writeFile(artifacts.applyStderrPath, apply.stderr);
  if (apply.exitCode !== 0) {
    const conflictPaths = extractConflictPaths(`${apply.stdout}\n${apply.stderr}`, params.record.writeSet);
    const failureReasons = [`git apply exited ${apply.exitCode}: ${outputTail(apply.stderr || apply.stdout, 1000)}`];
    const item = conflictItem({
      record: params.record,
      target: targetSnapshot(params.store, params.record),
      checkpoint: checkpointSnapshot(params.store, params.record),
      command: applyCommand,
      exitCode: apply.exitCode,
      stdout: apply.stdout,
      stderr: apply.stderr,
      stdoutPath: artifacts.applyStdoutPath,
      stderrPath: artifacts.applyStderrPath,
      conflictPaths,
      failureReasons,
    });
    await writeFile(artifacts.itemPath, `${JSON.stringify(item, null, 2)}\n`);
    const result = await updateAndSummarize(params.store, params.record, {
      status: "conflict",
      disposition: "apply_failed",
      artifacts,
      itemPath: artifacts.itemPath,
      checkStdoutPath: artifacts.checkStdoutPath,
      checkStderrPath: artifacts.checkStderrPath,
      applyStdoutPath: artifacts.applyStdoutPath,
      applyStderrPath: artifacts.applyStderrPath,
      failureReasons,
      conflictPaths,
      metadata: { queue_summary_path: artifacts.queueSummaryPath },
    });
    await writeFile(artifacts.queueSummaryPath, `${JSON.stringify(workerOutputIntegrationQueueSummary(params.store, params.record.sessionId), null, 2)}\n`);
    addEvent(params.store, params.record.sessionId, "worker_integration_conflict", "worker-output-integration", result);
    return result;
  }

  const result = await updateAndSummarize(params.store, params.record, {
    status: "applied",
    disposition: "clean_apply",
    artifacts,
    checkStdoutPath: artifacts.checkStdoutPath,
    checkStderrPath: artifacts.checkStderrPath,
    applyStdoutPath: artifacts.applyStdoutPath,
    applyStderrPath: artifacts.applyStderrPath,
  });
  addEvent(params.store, params.record.sessionId, "worker_integration_applied", "worker-output-integration", result);
  return result;
}

export async function processWorkerOutputIntegrationQueue(params: {
  dryRun: boolean;
  limit?: number;
  repoRoot: string;
  sessionId: string;
  stateDir: string;
  store: StateStore;
}): Promise<WorkerOutputIntegrationQueueResult> {
  const processed: WorkerOutputIntegrationApplyResult[] = [];
  const limit = Math.max(1, Math.trunc(params.limit ?? 16));

  for (let index = 0; index < limit; index += 1) {
    const record = claimNextWorkerOutputIntegration(params.store, params.sessionId);
    if (!record) break;
    try {
      processed.push(
        await applyClaimedWorkerOutput({
          dryRun: params.dryRun,
          repoRoot: params.repoRoot,
          stateDir: params.stateDir,
          store: params.store,
          record,
        }),
      );
    } catch (error) {
      const artifacts = integrationArtifacts(params.stateDir, record.sessionId, record.id);
      await mkdir(artifacts.artifactDir, { recursive: true });
      const result = await updateAndSummarize(params.store, record, {
        status: "failed",
        disposition: "processor_error",
        artifacts,
        failureReasons: [error instanceof Error ? error.message : String(error)],
      });
      addEvent(params.store, record.sessionId, "worker_integration_conflict", "worker-output-integration", result);
      processed.push(result);
    }
  }

  return {
    processed,
    queueSummary: workerOutputIntegrationQueueSummary(params.store, params.sessionId),
  };
}
