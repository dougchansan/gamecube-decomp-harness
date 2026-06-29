import { activityAttemptLabel, activityScoreText, latestActivity } from "@/components/work-tables/_lib/activity";
import { asObject, text, type JsonObject } from "@/lib/format";

export function ActiveActivityRow({ alt, file }: { alt: string; file: JsonObject }) {
  const { activity, lastEvent } = latestActivity(file);
  if (!text(lastEvent.eventType)) {
    // Keep the 44px+20px entry rhythm even before the first runner event lands.
    return (
      <tr className={`row-rhythm-sub ${alt}`}>
        <td className="text-[11px] text-faint" colSpan={3}>waiting for runner activity</td>
      </tr>
    );
  }
  const attemptLabel = activityAttemptLabel(activity, lastEvent);
  const scoreText = activityScoreText(asObject(activity.lastScore));
  return (
    <tr className={`row-rhythm-sub ${alt}`}>
      <td className="text-[11px]" colSpan={3} title={text(lastEvent.summary)}>
        <span className="mr-1.5 font-semibold uppercase tracking-[0.06em] text-dim">{attemptLabel}</span>
        {scoreText ? <span className="text-soft">{scoreText}</span> : null}
      </td>
    </tr>
  );
}
