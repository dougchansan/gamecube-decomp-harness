import { Fragment, useState } from "react";
import type { Dashboard } from "@/lib/format";
import { MarkTooltip } from "./mark-tooltip";
import { chartModel } from "../_lib/chart-model";
import type { ChartMark, ChartMode, ChartRange } from "../_lib/types";

function markLabelTransform(mark: ChartMark): string {
  if (mark.x < 8) return "translateX(0)";
  if (mark.x > 92) return "translateX(-100%)";
  return "translateX(-50%)";
}

export function TimelineChart({ dashboard, mode, range }: { dashboard: Dashboard | null; mode: ChartMode; range: ChartRange }) {
  const model = chartModel(dashboard, { mode, range });
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="px-2.5 py-2.5">
      <div className="relative h-[230px] border border-line bg-card">
        {[25, 50, 75].map((grid) => (
          <span className="absolute top-0 bottom-0 w-px bg-line" key={grid} style={{ left: `${grid}%` }} />
        ))}
        {model.hasLine ? (
          <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            {model.areaSegments.map((points, index) => (
              <polygon fill="var(--color-up)" fillOpacity="0.08" key={`area-${index}`} points={points} />
            ))}
            {model.lineSegments.map((points, index) => (
              <polyline fill="none" key={`line-${index}`} points={points} stroke="var(--color-up)" strokeOpacity="0.9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        ) : null}
        {model.marks.map((mark, index) => (
          <Fragment key={`${mark.kind}-${index}`}>
            {mark.kind === "epoch" ? (
              <span className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-faint" style={{ left: `${mark.x}%` }} />
            ) : null}
            <span
              className="group absolute z-[2] -translate-x-1/2 -translate-y-1/2 cursor-default p-2"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
            >
              <span
                className={`block h-2.5 w-2.5 rounded-full transition-transform group-hover:scale-150 ${
                  mark.kind === "now" ? "border-2 border-up bg-card" : "border border-ink bg-up"
                }`}
              />
            </span>
            <span
              className={`pointer-events-none absolute whitespace-nowrap text-[10px] ${hovered === index ? "text-fg" : "text-soft"}`}
              style={{ left: `${mark.x}%`, top: `calc(${mark.y}% - 22px)`, transform: markLabelTransform(mark) }}
            >
              {mark.valueLabel}
            </span>
          </Fragment>
        ))}
        {hovered !== null && model.marks[hovered] ? <MarkTooltip mark={model.marks[hovered]} /> : null}
        {!model.hasRun ? <span className="absolute inset-0 flex items-center justify-center text-xs text-dim">No run yet.</span> : null}
      </div>
      <div className="mt-1 grid grid-cols-3 text-[10px] text-dim">
        <span>{model.timeLabels[0]} (start)</span>
        <span className="text-center">{model.timeLabels[1]}</span>
        <span className="text-right">{model.timeLabels[2]} (now)</span>
      </div>
    </div>
  );
}
