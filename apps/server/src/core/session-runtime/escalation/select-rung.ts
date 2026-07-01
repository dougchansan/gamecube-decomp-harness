import { immediateTransaction, now, type StateStore } from "@server/core/orchestrator-state";
import type { LadderConfig, LadderRung } from "./ladder.js";

/**
 * Track A — rung selection (A1). Pure functions plus the DB reads/writes the escalation
 * hooks need. The escalation level (rung index) is the monotonic
 * epoch_targets.model_ladder_level (see currentLadderLevel); pickRung maps it to a rung.
 */

export function pickRung(ladder: LadderConfig, escalationLevel: number): { index: number; rung: LadderRung } {
  const lastIndex = Math.max(0, ladder.rungs.length - 1);
  const index = Math.min(Math.max(escalationLevel, 0), lastIndex);
  const rung = ladder.rungs[index];
  if (!rung) throw new Error(`Ladder ${ladder.id} has no rung at index ${index}`);
  return { index, rung };
}

/** At/over the last rung -> stop escalating after this run. */
export function ladderExhausted(ladder: LadderConfig, escalationLevel: number): boolean {
  return escalationLevel >= ladder.rungs.length - 1;
}

/**
 * A2 source of truth (rung-counter fix): the target's current ladder level, read from
 * the monotonic epoch_targets.model_ladder_level column. A fresh target has NULL -> 0
 * (rung 0). A3 increments it by exactly one on each escalation re-admit, so the level
 * survives claimNextEpochTarget's worker_state row-reuse and climbs deterministically.
 */
export function currentLadderLevel(store: StateStore, epochTargetId: string): number {
  const row = store.db
    .query("SELECT model_ladder_level AS level FROM epoch_targets WHERE id = ?")
    .get(epochTargetId) as { level?: number | null } | undefined;
  const level = row?.level;
  return typeof level === "number" && Number.isFinite(level) ? level : 0;
}

/**
 * A1 primitive (retained; no longer the escalation counter — see currentLadderLevel):
 * number of non-exact worker_state rows recorded for a target in a run. Kept for
 * telemetry/diagnostics.
 */
export function countNonExactWorkerStates(store: StateStore, runId: string, targetKey: string): number {
  const row = store.db
    .query("SELECT COUNT(*) AS count FROM worker_state WHERE session_id = ? AND target_key = ? AND exact = 0")
    .get(runId, targetKey) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

/**
 * A5 / B4: denormalize "who cracked it" onto epoch_targets when a target goes exact.
 *  - cracked_by_provider/model = the winning rung
 *  - cracked_at_escalation      = the winning rung index
 *  - tokens_to_crack            = SUM(input+output tokens) across every pi_session for
 *                                 every claim on this target_key this run
 *  - time_to_crack_ms           = first worker_state.started_at -> now (the crack moment)
 */
export function recordCrackTelemetry(
  store: StateStore,
  input: {
    runId: string;
    epochTargetId: string;
    targetKey: string;
    provider: string;
    model: string;
    escalationLevel: number;
  },
): void {
  immediateTransaction(store.db, () => {
    const tokenRow = store.db
      .query(
        `
          SELECT COALESCE(SUM(COALESCE(ps.input_tokens, 0) + COALESCE(ps.output_tokens, 0)), 0) AS tokens
          FROM pi_sessions ps
          JOIN worker_state ws ON ws.target_claim_id = ps.target_claim_id
          WHERE ws.session_id = ? AND ws.target_key = ?
        `,
      )
      .get(input.runId, input.targetKey) as { tokens?: number } | undefined;
    const tokensToCrack = Number(tokenRow?.tokens ?? 0);

    const startRow = store.db
      .query("SELECT MIN(started_at) AS started FROM worker_state WHERE session_id = ? AND target_key = ?")
      .get(input.runId, input.targetKey) as { started?: string } | undefined;

    const crackedAt = now();
    let timeToCrackMs: number | null = null;
    if (startRow?.started) {
      const startMs = Date.parse(String(startRow.started));
      const endMs = Date.parse(crackedAt);
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) timeToCrackMs = Math.max(0, endMs - startMs);
    }

    store.db
      .query(
        `
          UPDATE epoch_targets
          SET cracked_by_provider = ?,
              cracked_by_model = ?,
              cracked_at_escalation = ?,
              tokens_to_crack = ?,
              time_to_crack_ms = ?,
              model_ladder_level = ?
          WHERE id = ?
        `,
      )
      .run(input.provider, input.model, input.escalationLevel, tokensToCrack, timeToCrackMs, input.escalationLevel, input.epochTargetId);
  });
}
