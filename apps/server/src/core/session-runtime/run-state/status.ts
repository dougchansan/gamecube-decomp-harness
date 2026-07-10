import { withBusyRetry, type StateStore } from "@server/core/orchestrator-state";
import { activeSchedulerEpoch, schedulerEpochProgress } from "./epochs.js";
import { activeWorkerCount } from "./worker-state.js";
import { blockedAdmittedTargetCount, schedulableTargetCount } from "./target-pressure.js";
import { getLatestRun, getRun } from "./runs.js";

/**
 * Snapshot of one run's scheduler/worker/event counters. Defaults to the most
 * recently created run (today's single-run behavior); pass `explicitRunId` to
 * scope the snapshot to a specific run instead (e.g. the dashboard's lane
 * switcher), falling back to the latest run when that id doesn't resolve.
 */
export function statusSnapshot(store: StateStore, explicitRunId?: string): Record<string, unknown> {
  const run = (explicitRunId ? getRun(store, explicitRunId) : null) ?? getLatestRun(store);
  if (!run) return { runs: 0 };
  const activeEpoch = activeSchedulerEpoch(store, run.id);
  const schedulerEpoch = activeEpoch ? schedulerEpochProgress(store, activeEpoch.id) : null;
  const scalar = (sql: string, runId: string) => {
    const row = withBusyRetry(() => store.db.query(sql).get(runId) as Record<string, unknown>);
    return Number(row.count ?? 0);
  };
  return {
    run,
    epochTargets: scalar("SELECT COUNT(*) AS count FROM epoch_targets WHERE session_id = ?", run.id),
    admittedTargets: scalar("SELECT COUNT(*) AS count FROM epoch_targets WHERE session_id = ? AND status = 'admitted'", run.id),
    schedulableTargets: schedulableTargetCount(store, run.id),
    blockedAdmittedTargets: blockedAdmittedTargetCount(store, run.id),
    unhandledEvents: scalar("SELECT COUNT(*) AS count FROM events WHERE run_id = ? AND handled_at IS NULL", run.id),
    schedulerEpoch,
    epochs: scalar("SELECT COUNT(*) AS count FROM epochs WHERE session_id = ?", run.id),
    piSessions: scalar("SELECT COUNT(*) AS count FROM pi_sessions WHERE run_id = ?", run.id),
    directorCycles: scalar("SELECT COUNT(*) AS count FROM director_cycles WHERE run_id = ?", run.id),
    targetClaims: scalar("SELECT COUNT(*) AS count FROM target_claims WHERE session_id = ?", run.id),
    activeClaims: activeWorkerCount(store, run.id),
    workerStates: scalar("SELECT COUNT(*) AS count FROM worker_state WHERE session_id = ?", run.id),
    workerCheckpoints: scalar("SELECT COUNT(*) AS count FROM worker_checkpoints WHERE session_id = ?", run.id),
    workerOutputIntegrations: scalar("SELECT COUNT(*) AS count FROM worker_output_integrations WHERE session_id = ?", run.id),
    workerOutputIntegrationConflicts: scalar("SELECT COUNT(*) AS count FROM worker_output_integrations WHERE session_id = ? AND status IN ('conflict', 'needs_rework', 'blocked', 'resolver_failed')", run.id),
  };
}
