import { ArrowRight } from "@/icons";
import { asObject, text, type JsonObject, type LadderRung } from "@/lib/format";
import { activeRuntime, activityScoreCompact, latestActivity } from "@/lib/workerActivity";
import { LadderTrace } from "./ladder-trace";

function attemptNumber(activity: JsonObject, lastEvent: JsonObject): string {
  const activityAttempt = Number(activity.attemptIndex);
  const eventAttempt = Number(lastEvent.attemptIndex);
  const attemptIndex = Number.isFinite(activityAttempt) ? activityAttempt : eventAttempt;
  return Number.isFinite(attemptIndex) ? String(attemptIndex + 1) : "1";
}

function currentRungOf(file: JsonObject): number | null {
  return typeof file.currentRung === "number" && Number.isFinite(file.currentRung) ? file.currentRung : null;
}

export function ActiveRows({ ladderRungs, rows }: { ladderRungs: LadderRung[]; rows: JsonObject[] }) {
  return (
    <>
      {rows.map((file, index) => {
        const timing = activeRuntime(file.claimedAt || file.heartbeatAt, file.ttl);
        const alt = index % 2 === 1 ? "entry-alt" : "";
        const { activity, lastEvent } = latestActivity(file);
        const score = activityScoreCompact(asObject(activity.lastScore));
        const fileTitle = text(file.sourcePath) || text(file.unit) || text(file.symbol);
        const eventSummary = text(lastEvent.summary, "Waiting for runner activity");
        return (
          <tr className={`row-rhythm-1 ${alt}`} key={`${text(file.claimId)}-${text(file.symbol)}`}>
            <td className="max-w-0" title={fileTitle}>
              <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg">{text(file.symbol, "-")}</span>
            </td>
            <td className="w-20 text-right text-dim" title={eventSummary}>{attemptNumber(activity, lastEvent)}</td>
            <td className={`w-[150px] text-right ${score.improved ? "text-up" : "text-soft"}`} title={score.text ? `${eventSummary} - ${score.text}` : eventSummary}>
              {score.text ? (
                <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
                  <span>{score.before}</span>
                  <ArrowRight className="text-dim" size={12} />
                  <span>{score.after}</span>
                </span>
              ) : (
                "waiting"
              )}
            </td>
            <td className="w-24 text-right text-dim" title={timing.secondary}>{timing.primary}</td>
            <td className="w-[210px]">
              <LadderTrace
                currentRung={currentRungOf(file)}
                latestModel={typeof file.latestModel === "string" ? file.latestModel : null}
                latestProvider={typeof file.latestProvider === "string" ? file.latestProvider : null}
                latestThinking={typeof file.latestThinking === "string" ? file.latestThinking : null}
                rungs={ladderRungs}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}
