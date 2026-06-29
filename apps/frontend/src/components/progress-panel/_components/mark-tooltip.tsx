import { delta, pct, whole } from "@/lib/format";
import { strictNumber, tapeClass } from "@/components/progress-panel/_lib/numbers";
import type { ChartMark } from "@/components/progress-panel/_lib/types";

const measureRowSpecs = [
  { key: "complete_code_percent", label: "Complete code" },
  { key: "matched_functions_percent", label: "Matched funcs" },
  { key: "fuzzy_match_percent", label: "Fuzzy match" },
];

export function MarkTooltip({ mark }: { mark: ChartMark }) {
  const horizontal = mark.x < 15 ? "0" : mark.x > 85 ? "-100%" : "-50%";
  const above = mark.y >= 48;
  const units = strictNumber(mark.measures.complete_units);
  return (
    <div
      className="pointer-events-none absolute z-10 w-[210px] border border-line2 bg-raised px-2.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
      style={{
        left: `${mark.x}%`,
        top: `${mark.y}%`,
        transform: `translate(${horizontal}, ${above ? "calc(-100% - 14px)" : "14px"})`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.1em] text-dim">{mark.heading}</span>
        <span className="text-[10px] text-dim">{mark.when}</span>
      </div>
      <div className="mt-0.5 text-sm">
        <strong className="text-fg">{pct(mark.matched)}</strong>
        {Number.isFinite(mark.diff) ? <span className={`ml-1.5 text-xs ${tapeClass(mark.diff, 0.00001)}`}>{delta(mark.diff)}</span> : null}
        <span className="ml-1.5 text-[10px] text-dim">matched code</span>
      </div>
      <div className="mt-1.5 grid gap-0.5 border-t border-line pt-1.5 text-[11px]">
        {measureRowSpecs.map((spec) => {
          const value = strictNumber(mark.measures[spec.key]);
          if (!Number.isFinite(value)) return null;
          return (
            <div className="flex items-baseline justify-between gap-2" key={spec.key}>
              <span className="text-dim">{spec.label}</span>
              <span className="text-soft">{pct(value)}</span>
            </div>
          );
        })}
        {Number.isFinite(units) ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-dim">Complete units</span>
            <span className="text-soft">
              {whole(mark.measures.complete_units)} / {whole(mark.measures.total_units)}
            </span>
          </div>
        ) : null}
        {mark.regressed > 0 ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-dim">Regressions</span>
            <span className="text-down">
              {mark.regressed} fn · {mark.requeued} readmitted
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
