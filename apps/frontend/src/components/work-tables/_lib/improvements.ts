import {
  asArray,
  asObject,
  delta,
  num,
  pct,
  scoreOrPercent,
  scorePairLooksPercent,
  signedWhole,
  text,
  type Dashboard,
  type JsonObject,
} from "@/lib/format";
import type { ImprovedMode } from "@/components/work-tables/_lib/types";

function trustedReport(dashboard: Dashboard | null): JsonObject {
  return asObject(dashboard?.trustedReport);
}

function trustedReady(dashboard: Dashboard | null): boolean {
  return trustedReport(dashboard).status === "ready";
}

function improvementSourceReport(dashboard: Dashboard | null): { report: JsonObject; ready: boolean } {
  return { report: trustedReport(dashboard), ready: trustedReady(dashboard) };
}

function workerImprovementRows(dashboard: Dashboard | null): JsonObject[] {
  return (dashboard?.improvements || []).map(asObject);
}

function workerScore(row: JsonObject, key: "oldScore" | "newScore"): string {
  return scoreOrPercent(row[key], scorePairLooksPercent(row.oldScore, row.newScore, row.totalDelta));
}

function isWorkerMatch(row: JsonObject): boolean {
  return Number(row.exactMatches || 0) > 0;
}

function workerRowDisplay(row: JsonObject): JsonObject {
  return {
    ...row,
    unitName: text(row.sourcePath) || text(row.unit),
    itemName: text(row.symbol, "-"),
    scoreLabel: workerScore(row, "newScore"),
    deltaLabel: `${delta(row.totalDelta)} pp`,
    deltaTitle: `${workerScore(row, "oldScore")} -> ${workerScore(row, "newScore")} (${delta(row.totalDelta)} percentage points)`,
    source: "worker_report",
  };
}

function trustedGeneratedMs(dashboard: Dashboard | null): number {
  return trustedReady(dashboard) ? Date.parse(text(trustedReport(dashboard).generatedAt)) : NaN;
}

// Confirmed = the active session report's byte-level truth. Production-baseline
// reports can outlive a run; they must not make old rows look current.
export function confirmedRows(dashboard: Dashboard | null): JsonObject[] {
  const source = improvementSourceReport(dashboard);
  return source.ready ? asArray(source.report.newMatches).map(asObject) : [];
}

// Tentative = worker-claimed matches the next report build has not confirmed
// yet; claims older than the current report did not survive it, so they clear
// out automatically every time the report rebuilds (epoch boundary or QA).
export function tentativeRows(dashboard: Dashboard | null): JsonObject[] {
  // Without a fresh report there is nothing to compare claims against, and
  // stale claims from before the report (e.g. across a New Session boundary)
  // would all resurface as "tentative" — show none until the report lands.
  if (!trustedReady(dashboard) && !improvementSourceReport(dashboard).ready) return [];
  const confirmed = new Set(confirmedRows(dashboard).map((row) => text(row.itemName)).filter(Boolean));
  const reportMs = trustedGeneratedMs(dashboard);
  return workerImprovementRows(dashboard)
    .filter(isWorkerMatch)
    .filter((row) => !confirmed.has(text(row.symbol)))
    .filter((row) => !Number.isFinite(reportMs) || Date.parse(text(row.createdAt)) > reportMs)
    .map(workerRowDisplay);
}

export function improvementRows(dashboard: Dashboard | null): JsonObject[] {
  const source = improvementSourceReport(dashboard);
  const report = source.ready ? asArray(source.report.improvements).map(asObject) : [];
  const reportSymbols = new Set(report.map((row) => text(row.itemName)).filter(Boolean));
  const reportMs = source.ready ? Date.parse(text(source.report.generatedAt)) : NaN;
  const fresh = workerImprovementRows(dashboard)
    .filter((row) => !isWorkerMatch(row))
    .filter((row) => !reportSymbols.has(text(row.symbol)))
    .filter((row) => !Number.isFinite(reportMs) || Date.parse(text(row.createdAt)) > reportMs)
    .map(workerRowDisplay);
  return [...fresh, ...report];
}

export function reportRows(dashboard: Dashboard | null, mode: ImprovedMode): JsonObject[] {
  if (mode === "confirmed") return confirmedRows(dashboard);
  if (mode === "tentative") return tentativeRows(dashboard);
  return improvementRows(dashboard);
}

export function deltaColumnLabel(mode: ImprovedMode): string {
  if (mode === "confirmed") return "Bytes +/-";
  if (mode === "tentative") return "Score +/-";
  return "Δ";
}

export function deltaColumnTitle(mode: ImprovedMode): string {
  if (mode === "confirmed") return "Byte movement from the saved report";
  if (mode === "tentative") return "Worker score movement in percentage points; confirmed by the next report build";
  return "Bytes from the report, percentage points for fresh worker gains";
}

export function improvedEmptyText(dashboard: Dashboard | null, mode: ImprovedMode): string {
  const report = trustedReport(dashboard);
  if (mode === "confirmed") {
    if (report.status === "stale") return text(report.staleReason, "Report is stale — confirmed matches appear after the next report build");
    if (report.status === "parse_error") return text(report.error, "Could not parse the saved report");
    if (!trustedReady(dashboard)) return "No fresh report yet — confirmed matches appear after the next report build (epoch or QA)";
    return "No confirmed matches vs the baseline yet";
  }
  if (mode === "tentative") {
    return trustedReady(dashboard)
      ? "No unconfirmed worker matches since the last report — new claims appear here until the next build confirms or clears them"
      : "Report is rebuilding — worker claims reappear here once it lands";
  }
  return trustedReady(dashboard) ? "No improvements yet" : "No fresh report yet — improvements appear after the next report build";
}

export function rowPath(entry: JsonObject): string {
  return text(entry.unitName) || text(entry.sourcePath) || text(entry.unit, "-");
}

export function rowItem(entry: JsonObject): string {
  const exactMatches = Number(entry.exactMatches || 0);
  const suffix = text(entry.source) === "worker_report" && exactMatches > 1 ? ` (${num(exactMatches)} exact)` : "";
  return `${text(entry.itemName) || text(entry.symbol, "-")}${suffix}`;
}

export function rowScore(entry: JsonObject): string {
  return text(entry.scoreLabel) || pct(entry.toPercent);
}

export function rowDelta(entry: JsonObject): string {
  return text(entry.deltaLabel) || `${signedWhole(entry.bytesDelta)}b`;
}

export function rowDeltaTitle(entry: JsonObject): string {
  return text(entry.deltaTitle) || `${pct(entry.fromPercent)} -> ${pct(entry.toPercent)}`;
}

export function rowDeltaClass(entry: JsonObject): string {
  const raw = Number(entry.totalDelta ?? entry.bytesDelta);
  if (!Number.isFinite(raw) || raw === 0) return "text-dim";
  return raw > 0 ? "text-up" : "text-down";
}
