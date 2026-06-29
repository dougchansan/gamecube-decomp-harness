import { completePhase, type CompletePhaseState, type ProjectSessionPatch, type ProjectSessionRecord } from "@server/core/project-session";

export function completeSession(
  record: ProjectSessionRecord,
  now: string,
  options: {
    completedBy?: string;
    completedReason?: string;
    finalSavePoint?: Record<string, unknown>;
    settledPrCounts?: Record<string, unknown>;
  } = {},
): ProjectSessionPatch {
  if (record.phase !== "pr") throw new Error(`Cannot mark session complete from ${record.phase}`);
  if (record.pr_state_json.status !== "complete") throw new Error("Cannot mark session complete until PR phase is complete");
  const completeState: CompletePhaseState = {
    ...completePhase(record.complete_state_json, now),
    subphase: "settled",
    started_at: record.complete_state_json.started_at ?? now,
    completed_reason: options.completedReason,
    completed_by: options.completedBy,
    final_save_point: options.finalSavePoint,
    settled_pr_counts: options.settledPrCounts,
  };
  return {
    status: "complete",
    phase: "complete",
    complete_state_json: completeState,
    completed_at: now,
  };
}
