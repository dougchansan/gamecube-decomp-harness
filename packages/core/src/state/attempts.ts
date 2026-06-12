import { immediateTransaction, now, withBusyRetry, type StateStore } from "./db.js";

/**
 * Deterministic, runner-owned attempt ledger.
 *
 * One row per worker validation attempt, keyed by (lease_id, attempt_index) so
 * repair loops upsert instead of duplicating. Scores come from runner-owned
 * validation artifacts, never from model-authored report text.
 */
export interface RunnerAttemptRecord {
  leaseId: string;
  targetId: string;
  attemptIndex: number;
  artifactPath: string | null;
  compiled: boolean;
  oldScore: number | null;
  newScore: number | null;
  status: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function runnerAttemptId(leaseId: string, attemptIndex: number): string {
  return `${leaseId}:${attemptIndex}`;
}

export function recordRunnerAttempt(store: StateStore, attempt: RunnerAttemptRecord): string {
  const id = runnerAttemptId(attempt.leaseId, attempt.attemptIndex);
  const oldScore = finiteOrNull(attempt.oldScore);
  const newScore = finiteOrNull(attempt.newScore);
  const delta = oldScore !== null && newScore !== null ? newScore - oldScore : null;
  immediateTransaction(store.db, () => {
    store.db
      .query(
        `
          INSERT OR REPLACE INTO attempts (id, lease_id, target_id, artifact_path, compiled, old_score, new_score, delta, status, attempt_index, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        attempt.leaseId,
        attempt.targetId,
        attempt.artifactPath,
        attempt.compiled ? 1 : 0,
        oldScore,
        newScore,
        delta,
        attempt.status,
        attempt.attemptIndex,
        now(),
      );
  });
  return id;
}

export function runnerAttemptsForLease(store: StateStore, leaseId: string): Record<string, unknown>[] {
  return withBusyRetry(
    () =>
      store.db
        .query("SELECT * FROM attempts WHERE lease_id = ? ORDER BY attempt_index ASC, created_at ASC")
        .all(leaseId) as Record<string, unknown>[],
  );
}
