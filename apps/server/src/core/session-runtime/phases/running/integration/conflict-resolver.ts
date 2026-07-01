import { resolve } from "node:path";
import { withBusyRetry, type StateStore } from "@server/core/orchestrator-state";

/**
 * Auto integration-conflict resolution (opt-in via --auto-resolve-conflicts). These helpers
 * let the run-loop launch one bounded `integration-resolve` subprocess per queued conflict so
 * the campaign worker (codex) is not burned on merge plumbing — the resolver runs on a cheap
 * model (glm) instead.
 */

/**
 * Item ids of integrations currently in the 'conflict' state (awaiting a resolver). Only
 * 'conflict' rows are returned: once a resolver runs it updates the row to its outcome or
 * 'resolver_failed', so a resolved/failed item is never re-selected here.
 */
export function pendingConflictIntegrationIds(store: StateStore, runId: string): string[] {
  const rows = withBusyRetry(
    () =>
      store.db
        .query("SELECT id FROM worker_output_integrations WHERE session_id = ? AND status = 'conflict' ORDER BY created_at ASC")
        .all(runId) as Array<Record<string, unknown>>,
  );
  return rows.map((row) => String(row.id));
}

/**
 * Pure selection: which conflict items to launch a resolver for this tick. Bounds:
 *  - never launch an item whose resolver is already running (runningItemIds),
 *  - never launch an item that already exhausted its in-lifetime retry budget (exhaustedItemIds),
 *  - cap total concurrent resolvers at `cap` (accounting for the ones already running).
 */
export function selectConflictItemsToLaunch(params: {
  pendingItemIds: string[];
  runningItemIds: Set<string>;
  cap: number;
  exhaustedItemIds?: Set<string>;
}): string[] {
  const capacity = Math.max(0, params.cap - params.runningItemIds.size);
  if (capacity <= 0) return [];
  const exhausted = params.exhaustedItemIds ?? new Set<string>();
  const launchable: string[] = [];
  for (const id of params.pendingItemIds) {
    if (params.runningItemIds.has(id)) continue;
    if (exhausted.has(id)) continue;
    launchable.push(id);
    if (launchable.length >= capacity) break;
  }
  return launchable;
}

/**
 * Deterministic artifact paths written by processWorkerOutputIntegrationQueue for a conflict
 * item (mirrors integrationArtifacts in worker-output-queue.ts), so the resolver launcher can
 * point --item-file / --queue-summary-file at them without persisting the paths separately.
 */
export function conflictItemArtifactPaths(stateDir: string, runId: string, itemId: string): { itemPath: string; queueSummaryPath: string } {
  const artifactDir = resolve(stateDir, "runs", runId, "worker_integrations", itemId);
  return {
    itemPath: resolve(artifactDir, "integration_conflict_item.json"),
    queueSummaryPath: resolve(artifactDir, "integration_queue_summary.json"),
  };
}
