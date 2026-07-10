import { asObject, numberValue, whole } from "@/lib/format";
import type { Dashboard } from "@/lib/format";

// Fuzzy-match bands in worst-to-best presentation order for the legend, keyed to
// the count buckets the read-model emits from build/GC6E01/report.json.
const BANDS: Array<{ key: string; label: string; color: string }> = [
  { key: "matched", label: "100 (matched)", color: "var(--color-up)" },
  { key: "band90", label: "90–99", color: "var(--color-cyan)" },
  { key: "band80", label: "80–89", color: "var(--color-accent)" },
  { key: "band70", label: "70–79", color: "var(--color-purple)" },
  { key: "band50", label: "50–69", color: "var(--color-warn)" },
  { key: "attempted", label: "1–49 (attempted)", color: "var(--color-down)" },
  { key: "unattacked", label: "0 (unattacked)", color: "var(--color-faint)" },
];

// r chosen so the circumference is 100 → dash values are read directly as percent.
const RADIUS = 15.915_494_31;

function pctOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

export function FuzzyBandPanel({ dashboard }: { dashboard: Dashboard | null }) {
  const bands = asObject(dashboard?.fuzzyBands);
  const available = bands.available === true;
  const total = numberValue(bands.total, 0);
  const counts = asObject(bands.counts);
  const slices = BANDS.map((band) => {
    const count = numberValue(counts[band.key], 0);
    return { ...band, count, pct: pctOf(count, total) };
  });

  let cumulative = 0;

  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Fuzzy-match distribution</span>
        <span className="text-[10px] text-dim">{available ? `${whole(total)} functions` : "no function data"}</span>
      </div>
      {!available ? (
        <div className="px-3 py-4 text-[11px] text-dim">
          The build report has no per-function fuzzy data. Regenerate <span className="text-soft">build/GC6E01/report.json</span> with function-level output.
        </div>
      ) : (
        <div className="grid items-center gap-4 p-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <div className="relative mx-auto h-40 w-40">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 42 42">
              <circle cx="21" cy="21" fill="transparent" r={RADIUS} stroke="var(--color-card)" strokeWidth="5" />
              {slices.map((slice) => {
                if (slice.pct <= 0) return null;
                const dashoffset = ((100 - cumulative) % 100) + 0.0001;
                cumulative += slice.pct;
                return (
                  <circle
                    cx="21"
                    cy="21"
                    fill="transparent"
                    key={slice.key}
                    r={RADIUS}
                    stroke={slice.color}
                    strokeDasharray={`${slice.pct} ${100 - slice.pct}`}
                    strokeDashoffset={dashoffset}
                    strokeWidth="5"
                  />
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex rotate-0 flex-col items-center justify-center">
              <span className="text-lg font-semibold tabular-nums text-up">{pctOf(numberValue(counts.matched, 0), total).toFixed(1)}%</span>
              <span className="text-[9px] uppercase tracking-[0.1em] text-dim">matched</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Band</th>
                <th className="w-20 text-right">Count</th>
                <th className="w-20 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((slice) => (
                <tr key={slice.key}>
                  <td className="max-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: slice.color }} />
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg">{slice.label}</span>
                    </span>
                  </td>
                  <td className="w-20 text-right tabular-nums text-soft">{whole(slice.count)}</td>
                  <td className="w-20 text-right tabular-nums text-dim">{slice.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
