import { useState } from "react";
import type { ReactNode } from "react";
import { asObject, delta, numberValue, pct } from "@/lib/format";
import type { Dashboard } from "@/lib/format";
import { TimelineChart } from "./_components/timeline-chart";
import type { ChartMode, ChartRange } from "./_lib/types";

function pp(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) < 0.0005) return "+0.000 pp";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)} pp`;
}

function recommendedMode(dashboard: Dashboard | null): ChartMode {
  const summary = asObject(dashboard?.runSummary);
  const confirmedDelta = numberValue(summary.matchedCodeDelta, 0);
  const workerGain = numberValue(summary.totalPositiveDelta, 0);
  return Math.abs(confirmedDelta) < 0.0005 && workerGain > 0 ? "worker-gain" : "confirmed-code";
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`min-h-7 border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${active ? "border-line2 bg-raised text-fg" : "border-line bg-card text-dim hover:border-line2 hover:text-soft"}`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone = "soft" }: { label: string; value: string; tone?: "soft" | "up" | "dim" }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-[10px]">
      <span className="shrink-0 font-semibold uppercase tracking-[0.08em] text-dim">{label}</span>
      <span className={`truncate ${tone === "up" ? "text-up" : tone === "dim" ? "text-dim" : "text-soft"}`}>{value}</span>
    </div>
  );
}

export function ProgressPanel({
  dashboard,
}: {
  dashboard: Dashboard | null;
}) {
  const [selectedMode, setSelectedMode] = useState<ChartMode | null>(null);
  const [range, setRange] = useState<ChartRange>("run");
  const mode = selectedMode ?? recommendedMode(dashboard);
  const currentMeasures = asObject(asObject(dashboard?.current).measures);
  const summary = asObject(dashboard?.runSummary);
  const checkpoint = asObject(dashboard?.checkpointProgress);
  const checkpointRemaining = numberValue(checkpoint.remaining, NaN);
  const checkpointInterval = numberValue(checkpoint.interval, NaN);
  const checkpointValue = Number.isFinite(checkpointRemaining) && Number.isFinite(checkpointInterval) ? `${checkpointRemaining}/${checkpointInterval}` : "n/a";
  const confirmedDelta = numberValue(summary.matchedCodeDelta, 0);
  const workerGain = numberValue(summary.totalPositiveDelta, 0);
  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist">
          <SegmentButton active={mode === "worker-gain"} onClick={() => setSelectedMode("worker-gain")}>
            Worker gain
          </SegmentButton>
          <SegmentButton active={mode === "confirmed-code"} onClick={() => setSelectedMode("confirmed-code")}>
            Confirmed code
          </SegmentButton>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="tablist">
          {(["run", "6h", "24h", "all"] as ChartRange[]).map((nextRange) => (
            <SegmentButton active={range === nextRange} key={nextRange} onClick={() => setRange(nextRange)}>
              {nextRange}
            </SegmentButton>
          ))}
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-1 border-b border-line px-3 py-1.5 sm:grid-cols-4">
        <Stat label="Code" value={`${pct(currentMeasures.matched_code_percent)} ${delta(confirmedDelta)}`} tone={Math.abs(confirmedDelta) > 0.0005 ? "up" : "soft"} />
        <Stat label="Worker" value={pp(workerGain)} tone={workerGain > 0 ? "up" : "soft"} />
        <Stat label="Symbols" value={String(numberValue(summary.improvedSymbols, 0))} tone={numberValue(summary.improvedSymbols, 0) > 0 ? "up" : "soft"} />
        <Stat label="Checkpoint" value={checkpointValue} tone="dim" />
      </div>
      <TimelineChart dashboard={dashboard} mode={mode} range={range} />
    </div>
  );
}
