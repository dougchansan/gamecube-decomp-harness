/**
 * Backfill the runner-owned attempts ledger and tool_error target statuses for
 * an existing run from on-disk runner_validation artifacts.
 *
 * Usage:
 *   bun scripts/backfill-runner-attempts.ts --state-dir projects/melee/state [--run-id <id>] [--apply]
 *
 * Without --apply the script prints what it would write and changes nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getLatestRun, openState, recordRunnerAttempt } from "@decomp-orchestrator/core/state";

function argValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] ?? "" : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Mirrors runnerValidationCompiled in apps/cli/src/cli/commands/worker.ts: the
// object build succeeded unless the validation died before/at the build step.
function validationCompiled(validation: Record<string, unknown>): boolean {
  const status = String(validation.status ?? "");
  if (status === "build_failed") return false;
  if (status === "passed" || status === "failed") return isRecord(validation.target) || validation.exitCode === 0;
  if (status === "no_official_score_change" || status === "target_regressed" || status === "same_unit_regression") return true;
  return typeof validation.command === "string" && validation.command.includes("objdiff");
}

const stateDir = resolve(argValue("--state-dir") || "projects/melee/state");
const apply = process.argv.includes("--apply");

if (!existsSync(resolve(stateDir, "orchestrator.sqlite"))) {
  console.error(`No orchestrator.sqlite under ${stateDir}`);
  process.exit(1);
}

const store = openState(stateDir);
try {
  const runId = argValue("--run-id") || getLatestRun(store)?.id || "";
  if (!runId) {
    console.error("No run found");
    process.exit(1);
  }
  console.log(`run: ${runId}`);
  console.log(`mode: ${apply ? "APPLY" : "dry-run (pass --apply to write)"}`);

  const reports = store.db
    .query(
      `
        SELECT
          worker_reports.id AS report_id,
          worker_reports.lease_id,
          worker_reports.report_type,
          queue.id AS queue_id,
          queue.status AS queue_status,
          targets.id AS target_id,
          targets.status AS target_status,
          targets.symbol
        FROM worker_reports
        JOIN leases ON leases.id = worker_reports.lease_id
        JOIN queue ON queue.id = leases.queue_id
        JOIN targets ON targets.id = queue.target_id
        WHERE queue.run_id = ?
        ORDER BY worker_reports.created_at ASC
      `,
    )
    .all(runId) as Array<Record<string, unknown>>;

  let attemptRows = 0;
  let statusUpdates = 0;

  for (const report of reports) {
    const leaseId = String(report.lease_id ?? "");
    const targetId = String(report.target_id ?? "");
    const symbol = String(report.symbol ?? "");
    const validationDir = resolve(stateDir, "runs", runId, "worker_logs", leaseId, "runner_validation");
    if (existsSync(validationDir)) {
      const summaryFiles = readdirSync(validationDir)
        .map((file) => {
          const match = /^attempt-(\d+)\.runner_validation\.summary\.json$/.exec(file);
          return match ? { index: Number(match[1]), path: resolve(validationDir, file) } : null;
        })
        .filter((entry): entry is { index: number; path: string } => entry !== null)
        .sort((left, right) => left.index - right.index);

      for (const entry of summaryFiles) {
        let validation: Record<string, unknown>;
        try {
          const parsed = JSON.parse(readFileSync(entry.path, "utf8")) as unknown;
          if (!isRecord(parsed)) continue;
          validation = parsed;
        } catch {
          continue;
        }
        const target = isRecord(validation.target) ? validation.target : {};
        const record = {
          leaseId,
          targetId,
          attemptIndex: entry.index,
          artifactPath: entry.path,
          compiled: validationCompiled(validation),
          oldScore: finiteOrNull(target.before),
          newScore: finiteOrNull(target.after),
          status: String(validation.status ?? "unknown"),
        };
        attemptRows += 1;
        console.log(
          `attempt ${symbol} [${leaseId.slice(0, 8)}:${entry.index}] status=${record.status} compiled=${record.compiled} ` +
            `score=${record.oldScore ?? "-"} -> ${record.newScore ?? "-"}`,
        );
        if (apply) recordRunnerAttempt(store, record);
      }
    }

    if (String(report.report_type) === "tool_error") {
      const queueStatus = String(report.queue_status ?? "");
      const targetStatus = String(report.target_status ?? "");
      if (queueStatus === "reported" || targetStatus === "reported") {
        statusUpdates += 1;
        console.log(`status ${symbol} [${leaseId.slice(0, 8)}] queue ${queueStatus} -> error, target ${targetStatus} -> error`);
        if (apply) {
          store.db.query("UPDATE queue SET status = 'error' WHERE id = ? AND status = 'reported'").run(String(report.queue_id));
          store.db.query("UPDATE targets SET status = 'error' WHERE id = ? AND status = 'reported'").run(targetId);
        }
      }
    }
  }

  console.log(`\n${apply ? "wrote" : "would write"} ${attemptRows} attempt row(s), ${statusUpdates} tool_error status update(s)`);
} finally {
  store.db.close();
}
