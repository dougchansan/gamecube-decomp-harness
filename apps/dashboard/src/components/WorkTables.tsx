import { Fragment, useState } from "react";
import {
  asArray,
  asObject,
  delta,
  duration,
  durationBetween,
  num,
  pct,
  scoreOrPercent,
  scorePairLooksPercent,
  signedWhole,
  text,
  until,
  type Dashboard,
  type JsonObject,
} from "@decomp-orchestrator/ui-contract";
import { Button, StackCell } from "./primitives";

// 24 single-height match rows == 12 double-height work entries, so the two
// sections keep equal, constant heights while rows page in and out.
const improvedPageSize = 24;
const workPageSize = 12;

function PlaceholderRows({ columns, count, rhythm, startIndex = 0 }: { columns: number; count: number; rhythm: "match" | "active" | "queue"; startIndex?: number }) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        const alt = (startIndex + index) % 2 === 1 ? "entry-alt" : "";
        return rhythm === "active" ? (
          <Fragment key={`placeholder-${index}`}>
            <tr aria-hidden className={`placeholder-row row-rhythm-main ${alt}`}>
              <td colSpan={columns} />
            </tr>
            <tr aria-hidden className={`placeholder-row row-rhythm-sub ${alt}`}>
              <td colSpan={columns} />
            </tr>
          </Fragment>
        ) : (
          <tr aria-hidden className={`placeholder-row ${rhythm === "queue" ? "row-rhythm-2" : "row-rhythm-1"}`} key={`placeholder-${index}`}>
            <td colSpan={columns} />
          </tr>
        );
      })}
    </>
  );
}

function trustedReport(dashboard: Dashboard | null): JsonObject {
  return asObject(dashboard?.trustedReport);
}

function trustedReady(dashboard: Dashboard | null): boolean {
  return trustedReport(dashboard).status === "ready";
}

// Improvements compare against the production (upstream) baseline, which
// survives New Session; the session report's baseline is reset to the current
// tree at session boundaries, so carried local gains would read as zero there.
function productionReport(dashboard: Dashboard | null): JsonObject {
  return asObject(dashboard?.productionReport);
}

function productionReady(dashboard: Dashboard | null): boolean {
  return productionReport(dashboard).status === "ready";
}

function improvementSourceReport(dashboard: Dashboard | null): { report: JsonObject; ready: boolean } {
  if (productionReady(dashboard)) return { report: productionReport(dashboard), ready: true };
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

// Confirmed = the report's byte-level truth, measured against the production
// (shipped) baseline so it accumulates everything not yet landed in a PR.
// The session report's baseline resets at every epoch checkpoint, which would
// shrink the list to "since the last checkpoint" — wrong for PR planning.
function confirmedRows(dashboard: Dashboard | null): JsonObject[] {
  const source = improvementSourceReport(dashboard);
  return source.ready ? asArray(source.report.newMatches).map(asObject) : [];
}

// Tentative = worker-claimed matches the next report build has not confirmed
// yet; claims older than the current report did not survive it, so they clear
// out automatically every time the report rebuilds (epoch boundary or QA).
function tentativeRows(dashboard: Dashboard | null): JsonObject[] {
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

function improvementRows(dashboard: Dashboard | null): JsonObject[] {
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

function reportRows(dashboard: Dashboard | null, mode: ImprovedMode): JsonObject[] {
  if (mode === "confirmed") return confirmedRows(dashboard);
  if (mode === "tentative") return tentativeRows(dashboard);
  return improvementRows(dashboard);
}

function deltaColumnLabel(mode: ImprovedMode): string {
  if (mode === "confirmed") return "Bytes +/-";
  if (mode === "tentative") return "Score +/-";
  return "Δ";
}

function deltaColumnTitle(mode: ImprovedMode): string {
  if (mode === "confirmed") return "Byte movement from report_changes.json";
  if (mode === "tentative") return "Worker score movement in percentage points; confirmed by the next report build";
  return "Bytes from the report, percentage points for fresh worker gains";
}

function improvedEmptyText(dashboard: Dashboard | null, mode: ImprovedMode): string {
  const report = trustedReport(dashboard);
  if (mode === "confirmed") {
    if (report.status === "stale") return text(report.staleReason, "Report is stale — confirmed matches appear after the next report build");
    if (report.status === "parse_error") return text(report.error, "Could not parse report_changes.json");
    if (!trustedReady(dashboard)) return "No fresh report yet — confirmed matches appear after the next report build (epoch or QA)";
    return "No confirmed matches vs the baseline yet";
  }
  if (mode === "tentative") {
    return trustedReady(dashboard)
      ? "No unconfirmed worker matches since the last report — new claims appear here until the next build confirms or clears them"
      : "Report is rebuilding — worker claims reappear here once it lands";
  }
  if (productionReady(dashboard)) return "No improvements above the production baseline yet";
  return trustedReady(dashboard) ? "No improvements yet" : "No fresh report yet — improvements appear after the next report build";
}

function elapsedSince(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return duration(Date.now() - date.getTime());
}

function activeRuntime(startValue: unknown, ttlValue: unknown) {
  const elapsed = elapsedSince(startValue);
  const remaining = until(ttlValue);
  const max = durationBetween(startValue, ttlValue);
  let secondary = "timeout unknown";
  if (remaining !== "expired" && remaining !== "-") secondary = `${remaining} left`;
  else if (remaining === "expired") secondary = "expired";
  else if (max !== "-") secondary = "timeout set";
  return {
    primary: elapsed,
    secondary,
    title: `Elapsed: ${elapsed}; Remaining: ${secondary}; Timeout: ${max}`,
  };
}

export type ImprovedMode = "confirmed" | "tentative" | "improvements";
export type WorkMode = "active" | "queue";

interface WorkTablesProps {
  dashboard: Dashboard | null;
  improvedMode: ImprovedMode;
  improvedPage: number;
  setImprovedMode: (mode: ImprovedMode) => void;
  setImprovedPage: (page: number | ((page: number) => number)) => void;
  setWorkMode: (mode: WorkMode) => void;
  workMode: WorkMode;
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      aria-selected={active}
      className={`min-h-7 border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${active ? "border-line2 bg-raised text-fg" : "border-line bg-card text-dim hover:border-line2 hover:text-soft"}`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

function rowPath(entry: JsonObject): string {
  return text(entry.unitName) || text(entry.sourcePath) || text(entry.unit, "-");
}

function rowItem(entry: JsonObject): string {
  const exactMatches = Number(entry.exactMatches || 0);
  const suffix = text(entry.source) === "worker_report" && exactMatches > 1 ? ` (${num(exactMatches)} exact)` : "";
  return `${text(entry.itemName) || text(entry.symbol, "-")}${suffix}`;
}

function rowScore(entry: JsonObject): string {
  return text(entry.scoreLabel) || pct(entry.toPercent);
}

function rowDelta(entry: JsonObject): string {
  return text(entry.deltaLabel) || `${signedWhole(entry.bytesDelta)}b`;
}

function rowDeltaTitle(entry: JsonObject): string {
  return text(entry.deltaTitle) || `${pct(entry.fromPercent)} -> ${pct(entry.toPercent)}`;
}

function rowDeltaClass(entry: JsonObject): string {
  const raw = Number(entry.totalDelta ?? entry.bytesDelta);
  if (!Number.isFinite(raw) || raw === 0) return "text-dim";
  return raw > 0 ? "text-up" : "text-down";
}

function ImprovedTable({ dashboard, mode, page, setMode, setPage }: Pick<WorkTablesProps, "dashboard" | "improvedMode" | "improvedPage" | "setImprovedMode" | "setImprovedPage"> & { mode: ImprovedMode; page: number; setMode: (mode: ImprovedMode) => void; setPage: WorkTablesProps["setImprovedPage"] }) {
  const rows = reportRows(dashboard, mode);
  const pages = Math.max(1, Math.ceil(rows.length / improvedPageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * improvedPageSize, safePage * improvedPageSize + improvedPageSize);
  const placeholderCount = improvedPageSize - visible.length - (visible.length === 0 ? 1 : 0);

  return (
    <section className="h-full border-b border-line p-3 min-[1180px]:border-r min-[1180px]:border-b-0">
      <div className="mb-2 flex h-7 items-center justify-between gap-3 overflow-visible">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Confirmed matches, tentative matches, and improvements">
          <TabButton active={mode === "confirmed"} onClick={() => { setMode("confirmed"); setPage(0); }}>
            Confirmed ({num(confirmedRows(dashboard).length)})
          </TabButton>
          <TabButton active={mode === "tentative"} onClick={() => { setMode("tentative"); setPage(0); }}>
            Tentative ({num(tentativeRows(dashboard).length)})
          </TabButton>
          <TabButton active={mode === "improvements"} onClick={() => { setMode("improvements"); setPage(0); }}>
            Improvements ({num(improvementRows(dashboard).length)})
          </TabButton>
        </div>
        <div className="flex min-h-7 items-center gap-2">
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">
            Prev
          </Button>
          <span className="min-w-12 text-center leading-7 text-dim">{safePage + 1}/{pages}</span>
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage >= pages - 1 || rows.length === 0} onClick={() => setPage((current) => current + 1)} type="button">
            Next
          </Button>
        </div>
      </div>
      <div className="overflow-auto rounded-none border border-line">
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th className="w-[210px] text-left">Item</th>
              <th className="w-24 text-right">Score</th>
              <th className="w-24 text-right" title={deltaColumnTitle(mode)}>{deltaColumnLabel(mode)}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry, index) => (
              <tr className="row-rhythm-1" key={`${rowPath(entry)}-${rowItem(entry)}-${index}`}>
                <td className="text-path" title={rowPath(entry)}>{rowPath(entry)}</td>
                <td title={rowItem(entry)}>{rowItem(entry)}</td>
                <td className="text-right">{rowScore(entry)}</td>
                <td className={`text-right ${rowDeltaClass(entry)}`} title={rowDeltaTitle(entry)}>{rowDelta(entry)}</td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr className="row-rhythm-1">
                <td className="text-dim" colSpan={4}>{improvedEmptyText(dashboard, mode)}</td>
              </tr>
            ) : null}
            <PlaceholderRows columns={4} count={placeholderCount} rhythm="match" />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function activityScoreText(score: JsonObject): string {
  const before = Number(score.before);
  const after = Number(score.after);
  if (!Number.isFinite(before) && !Number.isFinite(after)) return "";
  return `${pct(score.before)} -> ${pct(score.after)}${score.exact === true ? " (exact)" : ""}`;
}

// Compact live status for an active lease: one word for where the worker is,
// plus the latest deterministic score check and tool call. The full event
// sentence stays in the hover title and the report's Trace section.
function activityStatus(activity: JsonObject, lastEvent: JsonObject): { label: string; tone: string } {
  const eventType = text(lastEvent.eventType);
  const phase = text(activity.phase);
  if (eventType === "report_recorded") return { label: "reported", tone: "text-up" };
  if (eventType === "runner_validation_passed") return { label: "validated", tone: "text-up" };
  if (eventType === "runner_validation_rejected") return { label: "rejected", tone: "text-warn" };
  if (eventType === "repair_requested" || phase.startsWith("repair")) return { label: "repairing", tone: "text-warn" };
  if (eventType === "acceptance_gate" || eventType === "runner_validation_skipped") return { label: "checking", tone: "text-dim" };
  if (eventType === "pi_session_finished") return { label: "evaluating", tone: "text-dim" };
  return { label: "working", tone: "text-dim" };
}

function ActiveActivityRow({ alt, file }: { alt: string; file: JsonObject }) {
  const activity = asObject(file.activity);
  const lastEvent = asObject(activity.lastEvent);
  if (!text(lastEvent.eventType)) {
    // Keep the 44px+20px entry rhythm even before the first runner event lands.
    return (
      <tr className={`row-rhythm-sub ${alt}`}>
        <td className="text-[11px] text-faint" colSpan={3}>waiting for runner activity</td>
      </tr>
    );
  }
  const status = activityStatus(activity, lastEvent);
  const lastTool = asObject(activity.lastTool);
  const scoreText = activityScoreText(asObject(activity.lastScore));
  const toolText = text(lastTool.tool) ? `${text(lastTool.tool)} ${text(lastTool.status)}`.trim() : "";
  return (
    <tr className={`row-rhythm-sub ${alt}`}>
      <td className="text-[11px]" colSpan={3} title={text(lastEvent.summary)}>
        <span className={`mr-1.5 font-semibold uppercase tracking-[0.06em] ${status.tone}`}>{status.label}</span>
        {scoreText ? <span className="text-soft">{scoreText}</span> : null}
        {toolText ? <span className="ml-1.5 text-faint">{toolText}</span> : null}
      </td>
    </tr>
  );
}

function ActiveRows({ rows }: { rows: JsonObject[] }) {
  return (
    <>
      {rows.map((file, index) => {
        const timing = activeRuntime(file.leasedAt || file.heartbeatAt, file.ttl);
        const alt = index % 2 === 1 ? "entry-alt" : "";
        return (
          <Fragment key={`${text(file.leaseId)}-${text(file.symbol)}`}>
            <tr className={`row-rhythm-main ${alt}`}>
              <td title={text(file.sourcePath) || text(file.unit) || text(file.symbol)}>
                <StackCell primary={text(file.symbol, "-")} secondary={text(file.sourcePath) || text(file.unit)} />
              </td>
              <td className="w-[92px] text-right">{pct(file.fuzzy)}</td>
              <td className="w-32 text-right" title={timing.title}>
                <StackCell primary={timing.primary} secondary={timing.secondary} />
              </td>
            </tr>
            <ActiveActivityRow alt={alt} file={file} />
          </Fragment>
        );
      })}
    </>
  );
}

function QueueRows({ rows }: { rows: JsonObject[] }) {
  return (
    <>
      {rows.map((file) => (
        <tr className="row-rhythm-2" key={`${text(file.queueId)}-${text(file.symbol)}`}>
          <td title={text(file.sourcePath) || text(file.unit) || text(file.symbol)}>
            <StackCell primary={text(file.symbol, "-")} secondary={text(file.sourcePath) || text(file.unit)} />
          </td>
          <td className="w-[92px] text-right">{pct(file.fuzzy)}</td>
          <td className="w-32 text-right" title={text(file.reason) || text(file.targetStatus) || text(file.queueStatus)}>
            <StackCell primary={text(file.targetStatus) || text(file.queueStatus, "-")} secondary={`priority ${num(file.priority)}`} />
          </td>
        </tr>
      ))}
    </>
  );
}

function WorkStatusTable({ dashboard, mode, setMode }: { dashboard: Dashboard | null; mode: WorkMode; setMode: (mode: WorkMode) => void }) {
  const [page, setPage] = useState(0);
  const activeFiles = dashboard?.activeFiles || [];
  const queueFiles = (dashboard?.queueTargets || []).filter((target) => target.queueStatus === "queued");
  const allRows = mode === "queue" ? queueFiles : activeFiles;
  const pages = Math.max(1, Math.ceil(allRows.length / workPageSize));
  const safePage = Math.min(page, pages - 1);
  const rows = allRows.slice(safePage * workPageSize, safePage * workPageSize + workPageSize);
  const emptyText = mode === "queue" ? "No queued files right now" : "No active leases right now";
  // Every work entry occupies a 64px unit (active: 44+20, queue/errors: 64), so
  // padding to 12 units keeps this table the height of 24 match rows.
  const placeholderCount = workPageSize - rows.length - (rows.length === 0 ? 1 : 0);

  function selectMode(nextMode: WorkMode) {
    setMode(nextMode);
    setPage(0);
  }

  return (
    <section className="h-full p-3">
      <div className="mb-2 flex h-7 items-center justify-between gap-3 overflow-visible">
        <div className="flex items-center gap-1.5 whitespace-nowrap" role="tablist" aria-label="Work status">
          <TabButton active={mode === "active"} onClick={() => selectMode("active")}>
            Active ({num(activeFiles.length)})
          </TabButton>
          <TabButton active={mode === "queue"} onClick={() => selectMode("queue")}>
            Queue ({num(queueFiles.length)})
          </TabButton>
        </div>
        <div className="flex min-h-7 items-center gap-2">
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))} type="button">
            Prev
          </Button>
          <span className="min-w-12 text-center leading-7 text-dim">{safePage + 1}/{pages}</span>
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage >= pages - 1 || allRows.length === 0} onClick={() => setPage(safePage + 1)} type="button">
            Next
          </Button>
        </div>
      </div>
      <div className="overflow-auto rounded-none border border-line">
        <table className={mode === "active" ? "active-table" : ""}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="w-[92px] text-right">Fuzzy</th>
              <th
                className="w-32 text-right"
                title={
                  mode === "queue"
                    ? "Queue target status. The second line shows queue priority."
                    : "Elapsed worker lease time. The second line shows time left before timeout."
                }
              >
                {mode === "active" ? "Elapsed" : "Status"}
              </th>
            </tr>
          </thead>
          <tbody>
            {mode === "active" ? <ActiveRows rows={rows} /> : <QueueRows rows={rows} />}
            {rows.length === 0 ? (
              <tr className={mode === "active" ? "row-rhythm-main" : "row-rhythm-2"}>
                <td className="text-dim" colSpan={3}>{emptyText}</td>
              </tr>
            ) : null}
            {rows.length === 0 && mode === "active" ? (
              <tr className="row-rhythm-sub">
                <td colSpan={3} />
              </tr>
            ) : null}
            <PlaceholderRows columns={3} count={placeholderCount} rhythm={mode === "active" ? "active" : "queue"} startIndex={rows.length || 1} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WorkTables(props: WorkTablesProps) {
  return (
    <div className="grid items-start border-b border-line min-[1180px]:grid-cols-[3fr_2fr]">
      <ImprovedTable
        dashboard={props.dashboard}
        improvedMode={props.improvedMode}
        improvedPage={props.improvedPage}
        mode={props.improvedMode}
        page={props.improvedPage}
        setImprovedMode={props.setImprovedMode}
        setImprovedPage={props.setImprovedPage}
        setMode={props.setImprovedMode}
        setPage={props.setImprovedPage}
      />
      <WorkStatusTable dashboard={props.dashboard} mode={props.workMode} setMode={props.setWorkMode} />
    </div>
  );
}
