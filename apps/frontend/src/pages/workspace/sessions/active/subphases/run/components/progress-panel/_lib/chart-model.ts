import { asArray, asObject, clock, delta, numberValue, pct, text, type Dashboard } from "@/lib/format";
import { strictNumber, timeMs } from "./numbers";
import type { ChartDetailRow, ChartMark, ChartMode, ChartModel, ChartRange } from "./types";

// Chart geometry in viewBox units (0-100). Headroom above TOP keeps the
// marker labels inside the box when the line touches the top of the scale.
const CHART_TOP = 24;
const CHART_BASE = 86;
const X_START = 6;
const X_END = 99.4;

const RANGE_MS: Record<Exclude<ChartRange, "run" | "all">, number> = {
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

interface ChartOptions {
  mode?: ChartMode;
  range?: ChartRange;
}

interface SeriesPoint {
  atMs: number;
  kind: ChartMark["kind"];
  segmentId: string;
  heading: string;
  value: number;
  measures: Record<string, unknown>;
  regressed?: number;
  requeued?: number;
  detailRows?: ChartDetailRow[];
}

function percentagePoint(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) < 0.0005) return "+0.000 pp";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)} pp`;
}

function rangeStartMs(range: ChartRange, runStartMs: number, nowMs: number, points: SeriesPoint[]): number {
  if (range === "run") return runStartMs || nowMs;
  if (range === "all") {
    const firstPointMs = points.reduce((oldest, point) => Math.min(oldest, point.atMs), Number.POSITIVE_INFINITY);
    return Number.isFinite(firstPointMs) ? firstPointMs : runStartMs || nowMs;
  }
  return nowMs - RANGE_MS[range];
}

function makeScale(values: number[]) {
  const finite = values.filter(Number.isFinite);
  const rawLow = finite.length ? Math.min(...finite) : 0;
  const rawHigh = finite.length ? Math.max(...finite) : 1;
  const pad = Math.max((rawHigh - rawLow) * 0.3, 0.01);
  const low = rawLow - pad;
  const high = rawHigh + pad;
  return (value: number) => CHART_BASE - ((value - low) / (high - low)) * (CHART_BASE - CHART_TOP);
}

function confirmedCodePoints(dashboard: Dashboard | null, runId: string, range: ChartRange, nowMs: number): SeriesPoint[] {
  const run = asObject(dashboard?.status?.run);
  const initialMeasures = asObject(asObject(dashboard?.initial).measures);
  const currentMeasures = asObject(asObject(dashboard?.current).measures);
  const initialMatched = strictNumber(initialMeasures.matched_code_percent);
  const currentMatched = strictNumber(currentMeasures.matched_code_percent);
  const runStartMs = timeMs(run.createdAt) || nowMs;
  const includeAllRuns = range !== "run";
  const points: SeriesPoint[] = [];

  if (Number.isFinite(initialMatched)) {
    points.push({
      atMs: runStartMs,
      kind: "start",
      segmentId: runId || "active-run",
      heading: "baseline",
      value: initialMatched,
      measures: initialMeasures,
    });
  }

  for (const rawEpoch of asArray(dashboard?.epochs).map(asObject)) {
    if (!includeAllRuns && text(rawEpoch.runId) !== runId) continue;
    const atMs = timeMs(rawEpoch.createdAt);
    const matched = strictNumber(rawEpoch.matchedCodePercent);
    if (atMs <= 0 || !Number.isFinite(matched)) continue;
    points.push({
      atMs,
      kind: "epoch",
      segmentId: text(rawEpoch.runId, "historical"),
      heading: text(rawEpoch.label, "epoch checkpoint"),
      value: matched,
      measures: asObject(rawEpoch.measures),
      regressed: numberValue(asObject(rawEpoch.regressions).regressedFunctions, 0),
      requeued: numberValue(asObject(rawEpoch.repair).requeued, 0),
    });
  }

  if (Number.isFinite(currentMatched)) {
    points.push({
      atMs: nowMs,
      kind: "now",
      segmentId: runId || "active-run",
      heading: "now",
      value: currentMatched,
      measures: currentMeasures,
    });
  }

  return points;
}

function workerGainPoints(dashboard: Dashboard | null, nowMs: number): SeriesPoint[] {
  const run = asObject(dashboard?.status?.run);
  const runStartMs = timeMs(run.createdAt) || nowMs;
  const improvements = asArray(dashboard?.improvements)
    .map(asObject)
    .map((improvement) => ({
      atMs: timeMs(improvement.createdAt),
      delta: numberValue(improvement.totalDelta, numberValue(improvement.bestDelta, 0)),
      sourcePath: text(improvement.sourcePath),
      symbol: text(improvement.symbol),
      exactMatches: numberValue(improvement.exactMatches, 0),
      integrationStatus: text(improvement.integrationStatus),
      integrationDisposition: text(improvement.integrationDisposition),
    }))
    .filter((improvement) => improvement.atMs > 0 && Number.isFinite(improvement.delta) && improvement.delta > 0)
    .sort((left, right) => left.atMs - right.atMs);

  const points: SeriesPoint[] = [
    {
      atMs: runStartMs,
      kind: "start",
      segmentId: text(run.id, "active-run"),
      heading: "baseline",
      value: 0,
      measures: {},
      detailRows: [{ label: "Accepted gain", value: "+0.000 pp", tone: "dim" }],
    },
  ];
  let cumulative = 0;
  for (const improvement of improvements) {
    cumulative += improvement.delta;
    points.push({
      atMs: improvement.atMs,
      kind: "worker",
      segmentId: text(run.id, "active-run"),
      heading: improvement.symbol || "worker result",
      value: cumulative,
      measures: {},
      detailRows: [
        { label: "Change", value: percentagePoint(improvement.delta), tone: "up" },
        { label: "Source", value: improvement.sourcePath || "n/a", tone: "dim" },
        { label: "Integration", value: [improvement.integrationStatus, improvement.integrationDisposition].filter(Boolean).join(" / ") || "n/a", tone: "dim" },
        ...(improvement.exactMatches > 0 ? [{ label: "Exact", value: String(improvement.exactMatches), tone: "up" as const }] : []),
      ],
    });
  }
  points.push({
    atMs: nowMs,
    kind: "now",
    segmentId: text(run.id, "active-run"),
    heading: "now",
    value: cumulative,
    measures: {},
    detailRows: [
      { label: "Accepted gain", value: percentagePoint(cumulative), tone: cumulative > 0 ? "up" : "dim" },
      { label: "Symbols", value: String(improvements.length), tone: improvements.length > 0 ? "up" : "dim" },
    ],
  });
  return points;
}

function visiblePoints(points: SeriesPoint[], range: ChartRange, startMs: number, nowMs: number): SeriesPoint[] {
  const visible = points.filter((point) => point.atMs >= startMs && point.atMs <= nowMs).sort((left, right) => left.atMs - right.atMs);
  if (visible.length > 0) return visible;
  const latestBeforeStart = points
    .filter((point) => point.atMs < startMs)
    .sort((left, right) => right.atMs - left.atMs)[0];
  if (latestBeforeStart) return [{ ...latestBeforeStart, atMs: startMs, heading: range === "run" ? latestBeforeStart.heading : "window start" }];
  return [];
}

function chartSegments(marks: ChartMark[]): ChartMark[][] {
  const segments: ChartMark[][] = [];
  for (const mark of marks) {
    const current = segments[segments.length - 1];
    if (!current || current[0]?.segmentId !== mark.segmentId) segments.push([mark]);
    else current.push(mark);
  }
  return segments.filter((segment) => segment.length >= 2);
}

function linePointsForSegment(segment: ChartMark[]): string {
  return segment.map((mark) => `${mark.x},${mark.y}`).join(" ");
}

function areaPointsForSegment(segment: ChartMark[], linePoints: string): string {
  const first = segment[0];
  const last = segment[segment.length - 1];
  return `${linePoints} ${last.x},${CHART_BASE} ${first.x},${CHART_BASE}`;
}

/**
 * The run's progress on a clock that runs left to right. Confirmed-code mode
 * plots full-board rebuild measurements. Worker-gain mode plots cumulative
 * accepted worker score movement so tentative progress is visible before the
 * next checkpoint rebuild.
 */
export function chartModel(dashboard: Dashboard | null, options: ChartOptions = {}): ChartModel {
  const mode = options.mode ?? "confirmed-code";
  const range = options.range ?? "run";
  const run = asObject(dashboard?.status?.run);
  const runId = text(run.id);
  const hasRun = Boolean(runId);
  const nowMs = Date.now();
  const runStartMs = timeMs(run.createdAt) || nowMs;
  const sourcePoints = mode === "worker-gain" ? workerGainPoints(dashboard, nowMs) : confirmedCodePoints(dashboard, runId, range, nowMs);
  const startMs = rangeStartMs(range, runStartMs, nowMs, sourcePoints);
  const endMs = Math.max(nowMs, startMs + 60_000);
  const span = endMs - startMs;
  const x = (ms: number) => Math.min(X_END, Math.max(X_START, X_START + ((ms - startMs) / span) * (X_END - X_START)));
  const y = makeScale(sourcePoints.map((point) => point.value));
  const points = visiblePoints(sourcePoints, range, startMs, nowMs);
  const metricLabel = mode === "worker-gain" ? "worker gain" : "matched code";

  let previousValue = points[0]?.value ?? NaN;
  const marks: ChartMark[] = points.map((point, index) => {
    const diff = index === 0 || !Number.isFinite(previousValue) ? NaN : point.value - previousValue;
    previousValue = point.value;
    return {
      x: x(point.atMs),
      y: y(point.value),
      kind: point.kind,
      segmentId: point.segmentId,
      heading: point.heading,
      when: clock(new Date(point.atMs).toISOString()),
      matched: point.value,
      diff,
      valueLabel: mode === "worker-gain" ? percentagePoint(point.value) : pct(point.value),
      diffLabel: mode === "worker-gain" ? percentagePoint(diff) : delta(diff),
      metricLabel,
      measures: point.measures,
      regressed: point.regressed ?? 0,
      requeued: point.requeued ?? 0,
      detailRows: point.detailRows ?? [],
    };
  });

  const segments = chartSegments(marks);
  const hasLine = segments.length > 0;
  const lineSegments = segments.map((segment) => linePointsForSegment(segment));
  const areaSegments = segments.map((segment, index) => areaPointsForSegment(segment, lineSegments[index]));
  const linePoints = lineSegments.join(" ");
  const areaPoints = areaSegments.join(" ");
  const timeLabels = [0, 0.5, 1].map((fraction) => clock(new Date(startMs + span * fraction).toISOString()));

  return {
    hasRun,
    hasLine,
    mode,
    range,
    epochCount: points.filter((point) => point.kind === "epoch").length,
    workerPointCount: points.filter((point) => point.kind === "worker").length,
    lineSegments,
    areaSegments,
    linePoints,
    areaPoints,
    marks,
    timeLabels,
  };
}
