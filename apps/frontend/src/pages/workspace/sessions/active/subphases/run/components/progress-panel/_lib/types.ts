import type { JsonObject } from "@/lib/format";

export type ChartMode = "confirmed-code" | "worker-gain" | "data" | "functions";
export type ChartRange = "run" | "6h" | "24h" | "all";

export interface ChartDetailRow {
  label: string;
  value: string;
  tone?: "up" | "down" | "dim";
}

export interface ChartMark {
  x: number;
  y: number;
  kind: "start" | "epoch" | "worker" | "now";
  segmentId: string;
  heading: string;
  when: string;
  matched: number;
  diff: number;
  valueLabel: string;
  diffLabel: string;
  metricLabel: string;
  measures: JsonObject;
  regressed: number;
  requeued: number;
  detailRows: ChartDetailRow[];
}

export interface ChartModel {
  hasRun: boolean;
  hasLine: boolean;
  mode: ChartMode;
  range: ChartRange;
  epochCount: number;
  workerPointCount: number;
  lineSegments: string[];
  areaSegments: string[];
  linePoints: string;
  areaPoints: string;
  marks: ChartMark[];
  timeLabels: string[];
}
