import { asObject, pct, type JsonObject } from "@/lib/format";

export function activityScoreText(score: JsonObject): string {
  const before = Number(score.before);
  const after = Number(score.after);
  if (!Number.isFinite(before) && !Number.isFinite(after)) return "";
  return `${pct(score.before)} -> ${pct(score.after)}${score.exact === true ? " (exact)" : ""}`;
}

// Compact live status for an active claim: operators mainly need the attempt
// number plus the latest deterministic score check. Detailed state and tool
// traces stay in the hover title and the report's Trace section.
export function activityAttemptLabel(activity: JsonObject, lastEvent: JsonObject): string {
  const activityAttempt = Number(activity.attemptIndex);
  const eventAttempt = Number(lastEvent.attemptIndex);
  const attemptIndex = Number.isFinite(activityAttempt) ? activityAttempt : eventAttempt;
  return `attempt ${Number.isFinite(attemptIndex) ? attemptIndex + 1 : 1}`;
}

export function latestActivity(file: JsonObject): { activity: JsonObject; lastEvent: JsonObject } {
  const activity = asObject(file.activity);
  return {
    activity,
    lastEvent: asObject(activity.lastEvent),
  };
}
