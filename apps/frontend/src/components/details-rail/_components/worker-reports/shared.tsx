import type { ReactNode } from "react";

import { asArray, asObject, clock, text, type JsonObject } from "@/lib/format";

import { traceEventLabel, traceEventTone, traceScoreText } from "../../_lib/worker-reports";

export function MetaItem({ label, value, valueClassName = "" }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <span className="mr-1 text-faint">{label}</span>
      <span className={`break-words text-soft ${valueClassName}`}>{value}</span>
    </div>
  );
}

export function TraceSection({
  activity,
  emptyText,
  showEmpty = true,
}: {
  activity: JsonObject;
  emptyText: string;
  showEmpty?: boolean;
}) {
  const events = asArray(activity.recentEvents).map(asObject);
  if (events.length === 0) {
    if (!showEmpty) return null;
    return <div className="mt-2 border-t border-line pt-2 text-[11px] text-faint">{emptyText}</div>;
  }
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase text-dim" title="Runner-owned claim timeline from activity.jsonl: attempts, gate decisions, validation results, repairs.">
          Trace
        </span>
        <span className="text-[10px] text-faint">{text(activity.source) === "return_gates" ? "from return gates" : `${events.length} events`}</span>
      </div>
      <div className="grid gap-1 border-l-2 border-line pl-2.5">
        {events.map((event, index) => {
          const scoreText = traceScoreText(event);
          return (
            <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 text-xs leading-5" key={`${text(event.createdAt)}-${index}`}>
              <span className="whitespace-nowrap pt-px text-[10px] text-faint" title={text(event.createdAt)}>{clock(event.createdAt)}</span>
              <span className="min-w-0">
                <span className={`mr-1.5 font-semibold ${traceEventTone(text(event.eventType))}`}>{traceEventLabel(event)}</span>
                <span className="[overflow-wrap:anywhere] text-soft">{text(event.summary)}</span>
                {scoreText ? <span className="ml-1.5 whitespace-nowrap text-dim">{scoreText}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
