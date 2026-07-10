import { asArray, asObject, clock, numberValue, pct } from "@/lib/format";
import type { Dashboard } from "@/lib/format";

// Chart geometry in viewBox units (0-100), matching the timeline chart's frame.
const CHART_TOP = 12;
const CHART_BASE = 90;
const X_START = 4;
const X_END = 99;

interface Point {
  atMs: number;
  value: number;
}

function seriesPoints(dashboard: Dashboard | null): Point[] {
  return asArray(dashboard?.reportSnapshots)
    .map(asObject)
    .map((snapshot) => ({
      atMs: Date.parse(String(snapshot.at ?? "")),
      value: numberValue(snapshot.matchedFunctionsPercent, NaN),
    }))
    .filter((point) => Number.isFinite(point.atMs) && Number.isFinite(point.value))
    .sort((left, right) => left.atMs - right.atMs);
}

/**
 * Matched-functions percentage over time, drawn from the dense report_snapshots
 * series for the active run (a real full-board rebuild measurement, distinct
 * from the epoch-anchored line in the Progress panel above).
 */
export function ProgressOverTimePanel({ dashboard }: { dashboard: Dashboard | null }) {
  const points = seriesPoints(dashboard);
  const values = points.map((point) => point.value);
  const rawLow = values.length ? Math.min(...values) : 0;
  const rawHigh = values.length ? Math.max(...values) : 1;
  const pad = Math.max((rawHigh - rawLow) * 0.3, 0.05);
  const low = rawLow - pad;
  const high = rawHigh + pad;
  const startMs = points.length ? points[0].atMs : 0;
  const endMs = points.length ? Math.max(points[points.length - 1].atMs, startMs + 60_000) : 1;
  const span = endMs - startMs || 1;
  const x = (ms: number) => X_START + ((ms - startMs) / span) * (X_END - X_START);
  const y = (value: number) => CHART_BASE - ((value - low) / (high - low || 1)) * (CHART_BASE - CHART_TOP);
  const linePoints = points.map((point) => `${x(point.atMs)},${y(point.value)}`).join(" ");
  const areaPoints = points.length >= 2 ? `${linePoints} ${x(endMs)},${CHART_BASE} ${x(startMs)},${CHART_BASE}` : "";
  const latest = points.length ? points[points.length - 1].value : NaN;
  const firstValue = points.length ? points[0].value : NaN;
  const gain = Number.isFinite(latest) && Number.isFinite(firstValue) ? latest - firstValue : NaN;

  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Matched functions over time</span>
        <span className="text-[10px] text-dim">
          {points.length} snapshots · {pct(latest)}
          {Number.isFinite(gain) && Math.abs(gain) >= 0.0005 ? <span className={gain >= 0 ? "text-up" : "text-down"}> ({gain >= 0 ? "+" : ""}{gain.toFixed(3)} pp)</span> : null}
        </span>
      </div>
      <div className="px-2.5 py-2.5">
        <div className="relative h-[200px] border border-line bg-card">
          {[25, 50, 75].map((grid) => (
            <span className="absolute top-0 bottom-0 w-px bg-line" key={grid} style={{ left: `${grid}%` }} />
          ))}
          {points.length >= 2 ? (
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              <polygon fill="var(--color-up)" fillOpacity="0.08" points={areaPoints} />
              <polyline fill="none" points={linePoints} stroke="var(--color-up)" strokeOpacity="0.9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : null}
          {points.map((point, index) => (
            <span
              className="absolute z-[2] block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-up"
              key={index}
              style={{ left: `${x(point.atMs)}%`, top: `${y(point.value)}%` }}
              title={`${clock(new Date(point.atMs).toISOString())} · ${pct(point.value)}`}
            />
          ))}
          {points.length < 2 ? <span className="absolute inset-0 flex items-center justify-center text-xs text-dim">Not enough snapshots yet.</span> : null}
        </div>
        {points.length >= 2 ? (
          <div className="mt-1 grid grid-cols-2 text-[10px] text-dim">
            <span>{clock(new Date(startMs).toISOString())} (start)</span>
            <span className="text-right">{clock(new Date(endMs).toISOString())} (now)</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
