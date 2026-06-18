import { Database } from "bun:sqlite";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { artifactTimestamp } from "@decomp-orchestrator/agents/runtime";
import { planRegressionRepair } from "@decomp-orchestrator/core/epoch";
import { createRunCheckpoint, latestCheckpointSummary, shipsInPr } from "@decomp-orchestrator/core/handoff";
import { readRegressionReport, type RegressionReport } from "@decomp-orchestrator/core/objdiff/report";
import { prioritizeQueuedTargets } from "@decomp-orchestrator/core/state";
import { listProjects, projectToSummary, resolveProject, type ProjectSummary, type ResolvedProject } from "@decomp-orchestrator/core";
import { globalStandardsContext, globalStandardsPromptXml, sourceDataRoot } from "@decomp-orchestrator/knowledge";
import { forceReportRun, type ReportRunResult } from "@decomp-orchestrator/core/report";
import { getLatestRun, getRun, latestSavePoint, listSavePoints, openState, setRunDesiredWorkers, statusSnapshot, updateRunStatus } from "@decomp-orchestrator/core/state";
import { loadTrustedReport, loadTrustedReportFile } from "./trusted-report.js";

type JsonObject = Record<string, unknown>;
type ReportOutcome = "exact" | "improved_stalled" | "improved_needs_fact" | "no_progress_stalled" | "no_progress_needs_fact" | "needs_rework" | "tool_error" | "provider_error";
type ReportResult = "exact" | "improved" | "no_progress";
type StopReason = "target_complete" | "needs_fact" | "stalled";

interface ManagedProcess {
  child: ChildProcess;
  command: string[];
  endedAt?: string;
  exitCode?: number | null;
  graphDbPath?: string;
  name: string;
  pid: number;
  pidFilePath: string;
  project?: ProjectSummary | null;
  repoRoot?: string;
  signal?: NodeJS.Signals | null;
  startedAt: string;
  state: "draining" | "running" | "stopping" | "exited";
  stateDir?: string;
}

interface ProcessLogLine {
  at: string;
  stream: "stdout" | "stderr" | "ui";
  text: string;
}

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface FreshRunStep extends CliResult {
  command: string[];
  cwd: string;
  name: string;
}

const packageRoot = resolve(import.meta.dir, "../../..");
const defaultRepoRoot = packageRoot;
const defaultStateDir = resolve(packageRoot, ".decomp-orchestrator-state");
const binPath = resolve(packageRoot, "apps/cli/src/bin/decomp-orchestrator.ts");
const builtStaticRoot = resolve(packageRoot, "apps/dashboard/dist");
const staticRoot = builtStaticRoot;
const port = Number(Bun.env.ORCH_UI_PORT ?? 8787);
const hotReloadEnabled = /^(1|true|yes)$/i.test(Bun.env.ORCH_UI_HOT_RELOAD ?? "");
const dashboardStreamIntervalMs = Math.max(500, Math.trunc(Number(Bun.env.ORCH_UI_DASHBOARD_INTERVAL_MS ?? 2500)) || 2500);

let managed: ManagedProcess | null = null;
let freshRunActive = false;
let projectSyncActive = false;

// One long-running dashboard action at a time (sync, prepare handoff, QA,
// fresh run). The record rides the dashboard payload so the UI can show which
// step is running instead of a bare busy spinner; the last result sticks
// around until the next operation starts so "did it work" stays answerable.
interface OperationStepRecord {
  name: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  detail?: string;
}

interface OperationRecord {
  name: string;
  label: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
  error?: string;
  next?: string;
  steps: OperationStepRecord[];
}

let operation: OperationRecord | null = null;

function beginOperation(name: string, label: string, stepNames: string[]): void {
  operation = {
    name,
    label,
    status: "running",
    startedAt: new Date().toISOString(),
    steps: stepNames.map((stepName) => ({ name: stepName, status: "pending" as const })),
  };
}

function operationStep(stepName: string, detail?: string): void {
  if (!operation || operation.status !== "running") return;
  const now = new Date().toISOString();
  for (const step of operation.steps) {
    if (step.status === "running") {
      step.status = "done";
      step.endedAt = now;
    }
  }
  let step = operation.steps.find((candidate) => candidate.name === stepName);
  if (!step) {
    step = { name: stepName, status: "pending" };
    operation.steps.push(step);
  }
  step.status = "running";
  step.startedAt = now;
  if (detail) step.detail = detail;
}

function operationStepDetail(stepName: string, detail: string): void {
  if (!operation) return;
  const step = operation.steps.find((candidate) => candidate.name === stepName);
  if (step) step.detail = detail;
}

// What the operator should do after a failure; rendered under the activity
// card so the next move never has to be inferred from the error text.
function operationNextHint(next: string): void {
  if (operation) operation.next = next;
}

// Attribute an upcoming failure to the named step (e.g. the QA gate verdict
// aborts the pipeline after later steps already ran); running steps close as
// done so the failed glyph lands on the step that actually caused the abort.
function failOperationStep(stepName: string): void {
  if (!operation || operation.status !== "running") return;
  const now = new Date().toISOString();
  for (const step of operation.steps) {
    if (step.status === "running") {
      step.status = "done";
      step.endedAt = now;
    }
  }
  const step = operation.steps.find((candidate) => candidate.name === stepName);
  if (step) {
    step.status = "failed";
    step.endedAt = now;
  }
}

function endOperation(error?: unknown): void {
  if (!operation || operation.status !== "running") return;
  const now = new Date().toISOString();
  for (const step of operation.steps) {
    if (step.status === "running") {
      step.status = error ? "failed" : "done";
      step.endedAt = now;
    } else if (step.status === "pending") {
      step.status = "skipped";
    }
  }
  operation.status = error ? "failed" : "done";
  operation.endedAt = now;
  if (error) operation.error = error instanceof Error ? error.message : String(error);
}

async function withOperation<T>(name: string, label: string, stepNames: string[], fn: () => Promise<T>): Promise<T> {
  const owns = !operation || operation.status !== "running";
  if (owns) beginOperation(name, label, stepNames);
  try {
    const result = await fn();
    if (owns) endOperation();
    return result;
  } catch (error) {
    if (owns) endOperation(error);
    throw error;
  }
}
const processLogs: ProcessLogLine[] = [];
const hotReloadClients = new Map<ReadableStreamDefaultController<Uint8Array>, ReturnType<typeof setInterval>>();
const hotReloadEncoder = new TextEncoder();
const hotReloadFilePattern = /\.(css|html|js|json|svg|png|jpe?g|webp)$/i;
let hotReloadVersion = 0;
let hotReloadTimer: ReturnType<typeof setTimeout> | null = null;
let hotReloadWatcher: FSWatcher | null = null;

function appendLog(stream: ProcessLogLine["stream"], text: string): void {
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    processLogs.push({ at: new Date().toISOString(), stream, text: raw });
  }
  if (processLogs.length > 500) processLogs.splice(0, processLogs.length - 500);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function percentLike(value: unknown): boolean {
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
}

function attemptHasPercentScores(attempt: JsonObject): boolean {
  const oldScore = "oldScore" in attempt ? attempt.oldScore : attempt.old_score;
  const newScore = "newScore" in attempt ? attempt.newScore : attempt.new_score;
  if (!percentLike(oldScore) || !percentLike(newScore)) return false;
  const oldValue = numberValue(oldScore, NaN);
  const newValue = numberValue(newScore, NaN);
  const delta = numberValue("delta" in attempt ? attempt.delta : null, NaN);
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) return true;
  const scoreMovement = newValue - oldValue;
  return Math.abs(scoreMovement) < 0.0005 || Math.sign(delta) === Math.sign(scoreMovement);
}

function timeMs(value: unknown): number {
  const text = stringValue(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true";
}

function intValue(value: unknown, fallback: number, min = 0): number {
  const parsed = Math.trunc(numberValue(value, fallback));
  return Math.max(min, parsed);
}

function powerOfTwoInt(value: unknown, fallback: number, min = 1): number {
  const parsed = intValue(value, fallback, min);
  return 2 ** Math.ceil(Math.log2(Math.max(min, parsed)));
}

function processName(value: unknown): string {
  const raw = stringValue(value, "melee-live").trim() || "melee-live";
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "melee-live";
}

function pidFilePath(stateDir: string, name: string): string {
  return resolve(stateDir, "ui-processes", `${name}.json`);
}

function writeProcessFile(proc: ManagedProcess): void {
  mkdirSync(dirname(proc.pidFilePath), { recursive: true });
  writeFileSync(
    proc.pidFilePath,
    JSON.stringify(
      {
        name: proc.name,
        pid: proc.pid,
        processGroup: proc.pid ? -proc.pid : null,
        killCommand: proc.pid ? `kill -TERM -${proc.pid}` : null,
        state: proc.state,
        startedAt: proc.startedAt,
        endedAt: proc.endedAt ?? null,
        exitCode: proc.exitCode ?? null,
        signal: proc.signal ?? null,
        command: proc.command,
        project: proc.project ?? null,
        projectId: proc.project?.id ?? null,
        repoRoot: proc.repoRoot ?? null,
        stateDir: proc.stateDir ?? null,
        graphDbPath: proc.graphDbPath ?? null,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function updateSavedProcessFile(stateDir: string, name: string, updates: JsonObject): string {
  const path = pidFilePath(stateDir, name);
  const current = readJsonObject(path);
  const pid = intValue(updates.pid ?? current.pid, 0, 0);
  const record = {
    ...current,
    ...updates,
    name,
    pid,
    processGroup: pid ? -pid : null,
    killCommand: pid ? `kill -TERM -${pid}` : null,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
  return path;
}

function readJsonObject(path: string): JsonObject {
  try {
    if (!path || !existsSync(path)) return {};
    return asObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

function processGroupAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return asObject(error).code === "EPERM";
  }
}

function directChildPids(pid: number): number[] {
  if (!pid) return [];
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (result.error || !result.stdout) return [];
  return result.stdout
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pid)) return true;
    await Bun.sleep(250);
  }
  return !processGroupAlive(pid);
}

function savedProcessRecords(stateDir: string): JsonObject[] {
  const dir = resolve(stateDir, "ui-processes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const path = resolve(dir, file);
      const record = readJsonObject(path);
      const pid = intValue(record.pid, 0, 0);
      const name = processName(record.name ?? file.replace(/\.json$/, ""));
      return {
        name,
        pid,
        processGroup: pid ? -pid : null,
        killCommand: pid ? `kill -TERM -${pid}` : null,
        state: stringValue(record.state, "unknown"),
        startedAt: stringValue(record.startedAt),
        endedAt: stringValue(record.endedAt),
        exitCode: record.exitCode ?? null,
        signal: record.signal ?? null,
        command: asArray(record.command).map((item) => stringValue(item)).filter(Boolean),
        project: asObject(record.project),
        projectId: stringValue(record.projectId, stringValue(asObject(record.project).id)),
        repoRoot: stringValue(record.repoRoot),
        stateDir: stringValue(record.stateDir),
        graphDbPath: stringValue(record.graphDbPath),
        pidFilePath: path,
        alive: processGroupAlive(pid),
      };
    })
    .sort((left, right) => stringValue(right.startedAt).localeCompare(stringValue(left.startedAt)));
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function text(data: string, init: ResponseInit = {}): Response {
  return new Response(data, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function staticFile(path: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "cache-control": "no-store, max-age=0",
      expires: "0",
      pragma: "no-cache",
    },
  });
}

function sendHotReloadEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: JsonObject = {}): void {
  controller.enqueue(hotReloadEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function closeHotReloadClient(controller: ReadableStreamDefaultController<Uint8Array>): void {
  const ping = hotReloadClients.get(controller);
  if (ping) clearInterval(ping);
  hotReloadClients.delete(controller);
}

function broadcastHotReload(path: string): void {
  hotReloadVersion += 1;
  const data = { version: hotReloadVersion, path, at: new Date().toISOString() };
  for (const controller of hotReloadClients.keys()) {
    try {
      sendHotReloadEvent(controller, "reload", data);
    } catch {
      closeHotReloadClient(controller);
    }
  }
}

function scheduleHotReload(filename: string | Buffer | null): void {
  const path = typeof filename === "string" ? filename : filename?.toString() ?? "static";
  if (path !== "static" && !hotReloadFilePattern.test(path)) return;
  if (hotReloadTimer) clearTimeout(hotReloadTimer);
  hotReloadTimer = setTimeout(() => {
    hotReloadTimer = null;
    broadcastHotReload(path || "static");
  }, 900);
}

function ensureHotReloadWatcher(): void {
  if (!hotReloadEnabled || hotReloadWatcher) return;
  try {
    const watchRoot = existsSync(builtStaticRoot) ? builtStaticRoot : staticRoot;
    hotReloadWatcher = watch(watchRoot, { persistent: false }, (_eventType, filename) => scheduleHotReload(filename));
  } catch (error) {
    appendLog("stderr", `hot reload watcher failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function hotReloadEvents(): Response {
  if (!hotReloadEnabled) return json({ error: "hot reload disabled" }, { status: 404 });
  ensureHotReloadWatcher();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const ping = setInterval(() => {
        try {
          controller.enqueue(hotReloadEncoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closeHotReloadClient(controller);
        }
      }, 15_000);
      hotReloadClients.set(controller, ping);
      controller.enqueue(hotReloadEncoder.encode("retry: 1000\n"));
      sendHotReloadEvent(controller, "ready", { version: hotReloadVersion });
    },
    cancel() {
      if (controllerRef) closeHotReloadClient(controllerRef);
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}

function dashboardStableSignature(dashboard: JsonObject): string {
  return JSON.stringify(dashboard, (key, value) => (key === "elapsedMs" || key === "lastReportAgeMs" ? 0 : value));
}

function dashboardTick(dashboard: JsonObject): JsonObject {
  const summary = asObject(dashboard.runSummary);
  return {
    elapsedMs: numberValue(summary.elapsedMs),
    lastReportAgeMs: summary.lastReportAgeMs ?? null,
    at: new Date().toISOString(),
  };
}

interface DashboardProjectContext {
  project: ResolvedProject | null;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
  usePathOverrides: boolean;
}

function projectDefaults(project: ResolvedProject | null): JsonObject | null {
  if (!project) return null;
  return {
    processName: project.processName,
    baseRef: project.baseRef,
    graphDbPath: project.graphDbPath,
    validation: project.validation,
    dashboard: project.dashboard,
    pr: project.pr,
    knowledge: project.knowledge,
  };
}

// Global decomp standards live in a single shared source, not per-project, but
// the Knowledge Base reads/writes them through the resolved project context so
// inventory + warnings stay project-scoped. The records are shared across all
// projects today; editing them is an operator action on durable knowledge.
const standardsSourcePath = resolve(sourceDataRoot("decomp_standards"), "standards.jsonl");
const standardsExamplesPath = resolve(sourceDataRoot("decomp_standards"), "examples.jsonl");

interface StandardsFileRecord {
  schema_version: string;
  id: string;
  kind: string;
  status: string;
  title: string;
  summary: string[] | string;
  do: string[];
  do_not: string[];
  evidence_refs: string[];
  family?: string;
  disposition?: string;
  severity?: string;
  qa_enforcement?: string;
  worker_facing?: boolean;
  retired_into?: string;
  qa_rule_ids?: string[];
  example_policy?: string;
  preferred_repairs?: string[];
  superseded_by?: string[];
  curator_update_policy?: JsonObject;
  [key: string]: unknown;
}

interface StandardExampleFileRecord {
  schema_version: string;
  id: string;
  standard_id: string;
  qa_rule_id?: string | null;
  severity: string;
  bad_pattern: string;
  preferred_shape: string;
  description?: string[];
  why?: string;
  evidence_ref?: string;
  [key: string]: unknown;
}

function readStandardsFile(): StandardsFileRecord[] {
  if (!existsSync(standardsSourcePath)) return [];
  return readFileSync(standardsSourcePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StandardsFileRecord);
}

function readStandardExamplesFile(): StandardExampleFileRecord[] {
  if (!existsSync(standardsExamplesPath)) return [];
  return readFileSync(standardsExamplesPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StandardExampleFileRecord);
}

function writeStandardsFile(records: StandardsFileRecord[]): void {
  const body = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  mkdirSync(dirname(standardsSourcePath), { recursive: true });
  writeFileSync(standardsSourcePath, body);
}

function standardsInventory(project: ResolvedProject | null): {
  globalSources: string[];
  projectSources: string[];
  validation: JsonObject;
  pr: JsonObject;
} {
  const knowledge = asObject(asObject(projectDefaults(project)).knowledge);
  return {
    globalSources: asArray(knowledge.globalSources).map((item) => stringValue(item)).filter(Boolean),
    projectSources: asArray(knowledge.projectSources).map((item) => stringValue(item)).filter(Boolean),
    validation: asObject(asObject(projectDefaults(project)).validation),
    pr: asObject(asObject(projectDefaults(project)).pr),
  };
}

function loadStandardsPayload(project: ResolvedProject | null): JsonObject {
  const records = readStandardsFile();
  const examples = readStandardExamplesFile();
  const warnings: string[] = [];
  if (records.length === 0) warnings.push(`No standards found at ${standardsSourcePath}.`);
  if (examples.length === 0) warnings.push(`No standard examples found at ${standardsExamplesPath}.`);
  return {
    project: project ? projectToSummary(project) : null,
    sourcePath: standardsSourcePath,
    examplesPath: standardsExamplesPath,
    records: records.map((record) => ({
      id: record.id,
      title: record.title,
      summary: asStringArray(record.summary),
      status: record.status,
      family: typeof record.family === "string" ? record.family : undefined,
      disposition: typeof record.disposition === "string" ? record.disposition : undefined,
      severity: typeof record.severity === "string" ? record.severity : undefined,
      qaEnforcement: typeof record.qa_enforcement === "string" ? record.qa_enforcement : undefined,
      workerFacing: typeof record.worker_facing === "boolean" ? record.worker_facing : undefined,
      retiredInto: typeof record.retired_into === "string" ? record.retired_into : undefined,
      qaRuleIds: Array.isArray(record.qa_rule_ids) ? record.qa_rule_ids.map((item) => String(item)) : undefined,
      examplePolicy: typeof record.example_policy === "string" ? record.example_policy : undefined,
      preferredRepairs: Array.isArray(record.preferred_repairs) ? record.preferred_repairs.map((item) => String(item)) : undefined,
      do: record.do ?? [],
      doNot: record.do_not ?? [],
      evidenceRefs: record.evidence_refs ?? [],
    })),
    examples: examples.map((example) => ({
      id: example.id,
      standardId: example.standard_id,
      qaRuleId: typeof example.qa_rule_id === "string" ? example.qa_rule_id : null,
      severity: example.severity,
      badPattern: example.bad_pattern,
      preferredShape: example.preferred_shape,
      description: standardExampleDescription(example),
      evidenceRef: typeof example.evidence_ref === "string" ? example.evidence_ref : undefined,
    })),
    effectiveXml: safeStandardsXml(warnings),
    context: safeStandardsContext(warnings),
    inventory: standardsInventory(project),
    warnings,
  };
}

function safeStandardsXml(warnings: string[]): string {
  try {
    return globalStandardsPromptXml();
  } catch (error) {
    warnings.push(`Unable to render effective standards XML: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function safeStandardsContext(warnings: string[]): JsonObject {
  try {
    return globalStandardsContext() as JsonObject;
  } catch (error) {
    warnings.push(`Unable to load standards context: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

interface StandardEdit {
  id: string;
  title?: unknown;
  summary?: unknown;
  status?: unknown;
  family?: unknown;
  disposition?: unknown;
  severity?: unknown;
  qaEnforcement?: unknown;
  workerFacing?: unknown;
  retiredInto?: unknown;
  qaRuleIds?: unknown;
  examplePolicy?: unknown;
  preferredRepairs?: unknown;
  do?: unknown;
  doNot?: unknown;
  evidenceRefs?: unknown;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter((item) => item);
  const text = stringValue(value).trim();
  return text ? [text] : [];
}

function standardExampleDescription(example: StandardExampleFileRecord): string[] {
  const description = asStringArray(example.description);
  if (description.length > 0) return description;
  const legacyWhy = stringValue(example.why).trim();
  return legacyWhy ? [legacyWhy] : [];
}

function validateStandardEdit(edit: StandardEdit): string[] {
  const errors: string[] = [];
  if (!/^global_standard:[a-z0-9-]+$/.test(stringValue(edit.id))) errors.push("id must match global_standard:<slug>.");
  if (!stringValue(edit.title).trim()) errors.push("title is required.");
  if (asStringArray(edit.summary).length === 0) errors.push("summary is required.");
  if (!["accepted", "proposed", "superseded", "merged", "workflow_only"].includes(stringValue(edit.status, "accepted"))) {
    errors.push("status must be accepted, proposed, superseded, merged, or workflow_only.");
  }
  return errors;
}

function optionalStringValue(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text ? text : undefined;
}

// Structured-record save/apply step: the Knowledge Base edits a record's
// fields and writes the whole JSONL back atomically. Status stays under operator
// control per the curator proposal-only-until-validated policy.
function applyStandardEdit(edit: StandardEdit): JsonObject {
  const errors = validateStandardEdit(edit);
  if (errors.length > 0) return { ok: false, errors };
  const records = readStandardsFile();
  const index = records.findIndex((record) => record.id === edit.id);
  const existing = index >= 0 ? records[index] : null;
  const merged: StandardsFileRecord = existing
    ? {
        ...existing,
        title: stringValue(edit.title, existing.title),
        summary: "summary" in edit ? asStringArray(edit.summary) : asStringArray(existing.summary),
        status: stringValue(edit.status, existing.status || "accepted"),
        family: "family" in edit ? optionalStringValue(edit.family) : existing.family,
        disposition: "disposition" in edit ? optionalStringValue(edit.disposition) : existing.disposition,
        severity: "severity" in edit ? optionalStringValue(edit.severity) : existing.severity,
        qa_enforcement: "qaEnforcement" in edit ? optionalStringValue(edit.qaEnforcement) : existing.qa_enforcement,
        worker_facing: "workerFacing" in edit ? boolValue(edit.workerFacing) : existing.worker_facing,
        retired_into: "retiredInto" in edit ? optionalStringValue(edit.retiredInto) : existing.retired_into,
        qa_rule_ids: "qaRuleIds" in edit ? asStringArray(edit.qaRuleIds) : existing.qa_rule_ids,
        example_policy: "examplePolicy" in edit ? optionalStringValue(edit.examplePolicy) : existing.example_policy,
        preferred_repairs: "preferredRepairs" in edit ? asStringArray(edit.preferredRepairs) : existing.preferred_repairs,
        do: "do" in edit ? asStringArray(edit.do) : existing.do,
        do_not: "doNot" in edit ? asStringArray(edit.doNot) : existing.do_not,
        evidence_refs: "evidenceRefs" in edit ? asStringArray(edit.evidenceRefs) : existing.evidence_refs,
      }
    : {
        schema_version: "global_standard_v1",
        id: edit.id,
        kind: "global_standard",
        status: stringValue(edit.status, "accepted"),
        title: stringValue(edit.title),
        summary: asStringArray(edit.summary),
        family: optionalStringValue(edit.family),
        disposition: optionalStringValue(edit.disposition),
        severity: optionalStringValue(edit.severity),
        qa_enforcement: optionalStringValue(edit.qaEnforcement),
        worker_facing: "workerFacing" in edit ? boolValue(edit.workerFacing) : true,
        retired_into: optionalStringValue(edit.retiredInto),
        qa_rule_ids: asStringArray(edit.qaRuleIds),
        example_policy: optionalStringValue(edit.examplePolicy),
        preferred_repairs: asStringArray(edit.preferredRepairs),
        do: asStringArray(edit.do),
        do_not: asStringArray(edit.doNot),
        evidence_refs: asStringArray(edit.evidenceRefs),
        superseded_by: ["current source", "headers", "symbols", "splits", "assembly", "objdiff", "regression output"],
        curator_update_policy: {
          target_source_id: "decomp_standards",
          update_kind: "global_standard",
          mutation_policy: "proposal_only_until_validated",
        },
      };
  if (index >= 0) records[index] = merged;
  else records.push(merged);
  records.sort((a, b) => a.id.localeCompare(b.id));
  writeStandardsFile(records);
  appendLog("ui", `standards ${edit.id} ${existing ? "updated" : "created"} via Knowledge Base`);
  return { ok: true, savedId: edit.id, sourcePath: standardsSourcePath };
}

function availableProjects(): ProjectSummary[] {
  try {
    return listProjects({ orchestratorRoot: packageRoot });
  } catch (error) {
    appendLog("stderr", `project list failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function defaultProject(): ResolvedProject | null {
  try {
    return resolveProject({ orchestratorRoot: packageRoot, useDefaultProject: true });
  } catch {
    return null;
  }
}

function resolveDashboardProject(input: JsonObject, options: { useDefaultProject?: boolean } = {}): DashboardProjectContext {
  const projectId = stringValue(input.projectId).trim();
  const usePathOverrides = boolValue(input.usePathOverrides);
  if (projectId || options.useDefaultProject) {
    try {
      const project = resolveProject({
        orchestratorRoot: packageRoot,
        projectId: projectId || undefined,
        useDefaultProject: !projectId && options.useDefaultProject === true,
        explicitOverrides: usePathOverrides
          ? {
              repoRoot: stringValue(input.repoRoot) || undefined,
              stateDir: stringValue(input.stateDir) || undefined,
              graphDb: stringValue(input.graphDbPath, stringValue(input.graphDb)) || undefined,
            }
          : undefined,
      });
      return {
        project,
        repoRoot: project.repoRoot,
        stateDir: project.stateDir,
        graphDbPath: project.graphDbPath,
        usePathOverrides,
      };
    } catch (error) {
      if (projectId) throw error;
    }
  }

  return {
    project: null,
    repoRoot: resolve(stringValue(input.repoRoot, defaultRepoRoot)),
    stateDir: resolve(stringValue(input.stateDir, defaultStateDir)),
    graphDbPath: resolve(stringValue(input.graphDbPath, stringValue(input.graphDb, "")) || resolve(defaultStateDir, "knowledge-graph.sqlite")),
    usePathOverrides: true,
  };
}

function requestPaths(url: URL, options: { useDefaultProject?: boolean } = {}): DashboardProjectContext {
  return resolveDashboardProject(
    {
      projectId: url.searchParams.get("projectId") ?? "",
      repoRoot: url.searchParams.get("repoRoot") ?? "",
      stateDir: url.searchParams.get("stateDir") ?? "",
      graphDbPath: url.searchParams.get("graphDbPath") ?? url.searchParams.get("graphDb") ?? "",
      usePathOverrides: url.searchParams.get("usePathOverrides") ?? "",
    },
    options,
  );
}

function dashboardEvents(url: URL): Response {
  const paths = requestPaths(url, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let lastSignature = "";
  let closed = false;
  let inFlight = false;

  const send = (event: string, data: JsonObject): void => {
    if (!controllerRef || closed) return;
    controllerRef.enqueue(hotReloadEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  const pushDashboard = async (force = false): Promise<void> => {
    if (!controllerRef || closed || inFlight) return;
    inFlight = true;
    try {
      const dashboard = await runDashboard(paths);
      const signature = dashboardStableSignature(dashboard);
      const payload = JSON.stringify(dashboard);
      if (force || signature !== lastSignature) {
        lastSignature = signature;
        controllerRef.enqueue(hotReloadEncoder.encode(`event: dashboard\ndata: ${payload}\n\n`));
      } else {
        send("dashboard-tick", dashboardTick(dashboard));
      }
    } catch (error) {
      send("dashboard-error", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      inFlight = false;
    }
  };

  const close = (): void => {
    closed = true;
    if (interval) clearInterval(interval);
    interval = null;
    controllerRef = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(hotReloadEncoder.encode("retry: 1000\n"));
      send("ready", { intervalMs: dashboardStreamIntervalMs });
      void pushDashboard(true);
      interval = setInterval(() => {
        void pushDashboard(false);
      }, dashboardStreamIntervalMs);
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}

function latestInitialSnapshot(stateDir: string, runId: string): JsonObject {
  return readJsonObject(resolve(stateDir, "runs", runId, "snapshots", "initial_board.json"));
}

function measuresFromSnapshot(snapshot: JsonObject): JsonObject {
  return asObject(snapshot.measures);
}

function compactMeasures(measures: JsonObject): JsonObject {
  return {
    fuzzy_match_percent: numberValue(measures.fuzzy_match_percent, NaN),
    matched_code_percent: numberValue(measures.matched_code_percent, NaN),
    complete_code_percent: numberValue(measures.complete_code_percent, NaN),
    matched_functions_percent: numberValue(measures.matched_functions_percent, NaN),
    complete_units: numberValue(measures.complete_units, NaN),
    total_units: numberValue(measures.total_units, NaN),
  };
}

function measureDelta(initial: JsonObject, current: JsonObject, key: string): number {
  const start = numberValue(initial[key], NaN);
  const now = numberValue(current[key], NaN);
  return Number.isFinite(start) && Number.isFinite(now) ? now - start : 0;
}

function loadCurrentBoard(
  repoRoot: string,
  campaign?: JsonObject,
): { error?: string; generatedAt?: string; measures: JsonObject; candidates: unknown[]; reportPath?: string; source?: string; savePointSha?: string | null } {
  const reportPath = resolve(repoRoot, "build/GALE01/report.json");
  try {
    if (!existsSync(reportPath)) {
      // Fall back through the canonical position chain: the last save point's
      // anchored measures, then the saved baseline, so opening the dashboard
      // never shows an empty board just because report.json was not rebuilt.
      const savePoint = asObject(campaign?.savePoint);
      const savePointMeasures = asObject(asObject(savePoint.payload).measures);
      if (Object.keys(savePointMeasures).length > 0) {
        return {
          generatedAt: stringValue(savePoint.createdAt) || undefined,
          measures: compactMeasures(savePointMeasures),
          candidates: [],
          reportPath: stringValue(savePoint.reportPath) || reportPath,
          source: "save_point",
          savePointSha: stringValue(savePoint.commitSha) || null,
        };
      }
      const baselinePath = resolve(repoRoot, "build/GALE01/baseline.json");
      if (existsSync(baselinePath)) {
        const baseline = readJsonObject(baselinePath);
        return {
          generatedAt: statSync(baselinePath).mtime.toISOString(),
          measures: compactMeasures(asObject(baseline.measures)),
          candidates: [],
          reportPath: baselinePath,
          source: "baseline",
        };
      }
      return {
        error: `Missing ${reportPath}`,
        measures: {},
        candidates: [],
        reportPath,
      };
    }
    const report = readJsonObject(reportPath);
    return {
      generatedAt: statSync(reportPath).mtime.toISOString(),
      measures: compactMeasures(asObject(report.measures)),
      candidates: [],
      reportPath,
      source: "report",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      measures: {},
      candidates: [],
      reportPath,
    };
  }
}

function sqlLimit(limit: number): string {
  const safeLimit = Math.max(0, Math.floor(limit));
  return safeLimit > 0 ? `LIMIT ${safeLimit}` : "";
}

// Runner-owned score outcome: when runner validation passed, its target block is
// the canonical evidence for result/delta/exact, regardless of what the
// model-authored attempts[] narrative contains.
function runnerValidationTarget(runnerValidation: JsonObject): JsonObject | null {
  if (stringValue(runnerValidation.status) !== "passed") return null;
  const target = asObject(runnerValidation.target);
  return Object.keys(target).length > 0 ? target : null;
}

function runnerValidationDelta(runnerValidation: JsonObject): number | null {
  const target = runnerValidationTarget(runnerValidation);
  if (!target) return null;
  const before = numberValue(target.before, NaN);
  const after = numberValue(target.after, NaN);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return after - before;
}

function runnerAttemptsByLease(stateDir: string, runId: string): Map<string, JsonObject[]> {
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT attempts.*
          FROM attempts
          JOIN leases ON leases.id = attempts.lease_id
          JOIN queue ON queue.id = leases.queue_id
          WHERE queue.run_id = ?
          ORDER BY attempts.attempt_index ASC, attempts.created_at ASC
        `,
      )
      .all(runId) as JsonObject[];
    const byLease = new Map<string, JsonObject[]>();
    for (const row of rows) {
      const leaseId = stringValue(row.lease_id);
      const list = byLease.get(leaseId) ?? [];
      list.push({
        attemptIndex: numberValue(row.attempt_index, NaN),
        compiled: numberValue(row.compiled) === 1,
        oldScore: numberValue(row.old_score, NaN),
        newScore: numberValue(row.new_score, NaN),
        delta: numberValue(row.delta, NaN),
        status: stringValue(row.status),
        artifactPath: stringValue(row.artifact_path),
        source: "runner",
      });
      byLease.set(leaseId, list);
    }
    return byLease;
  } finally {
    store.db.close();
  }
}

// Older runs have no attempts-table rows; synthesize the final runner attempt
// from the runner_validation block embedded in the report summary.
function syntheticRunnerAttempts(runnerValidation: JsonObject): JsonObject[] {
  const status = stringValue(runnerValidation.status);
  if (!status || status === "skipped") return [];
  const target = asObject(runnerValidation.target);
  const before = numberValue(target.before, NaN);
  const after = numberValue(target.after, NaN);
  return [
    {
      attemptIndex: NaN,
      compiled: status !== "build_failed" && (Object.keys(target).length > 0 || numberValue(runnerValidation.exitCode, NaN) === 0),
      oldScore: before,
      newScore: after,
      delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : NaN,
      status,
      artifactPath: stringValue(runnerValidation.summaryPath),
      source: "runner",
    },
  ];
}

function workerReports(stateDir: string, runId: string, limit = 100): JsonObject[] {
  const runnerAttempts = runnerAttemptsByLease(stateDir, runId);
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT
            worker_reports.id AS report_id,
            worker_reports.lease_id,
            worker_reports.report_type,
            worker_reports.summary_path,
            worker_reports.facts_path,
            worker_reports.blocker_path,
            worker_reports.patch_path,
            worker_reports.created_at,
            leases.worker_id,
            leases.status AS lease_status,
            queue.status AS queue_status,
            targets.unit,
            targets.symbol,
            targets.source_path,
            targets.size,
            targets.fuzzy
          FROM worker_reports
          LEFT JOIN leases ON leases.id = worker_reports.lease_id
          LEFT JOIN queue ON queue.id = leases.queue_id
          LEFT JOIN targets ON targets.id = queue.target_id
          WHERE queue.run_id = ?
          ORDER BY worker_reports.created_at DESC
          ${sqlLimit(limit)}
        `,
      )
      .all(runId) as JsonObject[];

    return rows.map((row) => {
      const report = readJsonObject(stringValue(row.summary_path));
      const agentReport = asObject(report.agent_report);
      const target = { ...row, ...asObject(report.target), ...asObject(agentReport.target) };
      const lease = asObject(agentReport.lease);
      const attempts = asArray(agentReport.attempts).map(asObject);
      const writeSet = [
        ...asArray(report.write_set).map((item) => stringValue(item)).filter(Boolean),
        ...asArray(lease.edited_paths).map((item) => stringValue(item)).filter(Boolean),
      ];
      if (writeSet.length === 0 && stringValue(target.source_path)) writeSet.push(stringValue(target.source_path));
      const runnerValidation = asObject(report.runner_validation);
      const runnerDelta = runnerValidationDelta(runnerValidation);
      const attemptScoreDelta = attempts
        .filter(attemptHasPercentScores)
        .reduce((sum, attempt) => sum + Math.max(0, numberValue(attempt.delta)), 0);
      const scoreDelta = runnerDelta !== null ? Math.max(0, runnerDelta) : attemptScoreDelta;
      const leaseRunnerAttempts = runnerAttempts.get(stringValue(row.lease_id)) ?? syntheticRunnerAttempts(runnerValidation);
      // Per-lease trace files are only read on the explicit full-details load,
      // not on the 2.5s dashboard poll.
      const activity = limit === 0 ? activeLeaseActivity(stateDir, runId, stringValue(row.lease_id)) : null;
      return {
        id: row.report_id,
        leaseId: row.lease_id,
        workerId: row.worker_id,
        reportType: row.report_type,
        result: stringValue(report.result, stringValue(agentReport.result)),
        stopReason: stringValue(report.stop_reason, stringValue(agentReport.stop_reason)),
        neededFact: "needed_fact" in report ? report.needed_fact : "needed_fact" in agentReport ? agentReport.needed_fact : null,
        createdAt: stringValue(report.created_at, stringValue(row.created_at)),
        summary: stringValue(report.summary, "No summary recorded."),
        target: {
          unit: stringValue(target.unit),
          symbol: stringValue(target.symbol),
          sourcePath: stringValue(target.source_path),
          size: numberValue(target.size),
          fuzzy: numberValue(target.fuzzy, numberValue(target.fuzzy_match_percent)),
        },
        writeSet: [...new Set(writeSet)],
        attempts: attempts.map((attempt) => ({
          description: stringValue(attempt.description),
          compiled: attempt.compiled === true,
          oldScore: numberValue(attempt.old_score, NaN),
          newScore: numberValue(attempt.new_score, NaN),
          delta: numberValue(attempt.delta, 0),
          artifactPath: stringValue(attempt.artifact_path),
          source: "model",
        })),
        runnerAttempts: leaseRunnerAttempts,
        activity,
        scoreDelta,
        patchPath: stringValue(row.patch_path, stringValue(agentReport.patch_path)),
        acceptanceGate: asObject(report.acceptance_gate),
        runnerValidation,
        repairAttempts: asObject(report.repair_attempts),
        error: asObject(report.error),
        nextRecommendation: stringValue(agentReport.next_recommendation),
        leaseStatus: row.lease_status,
        queueStatus: row.queue_status,
      };
    });
  } finally {
    store.db.close();
  }
}

function touchedFilesFromReports(reports: JsonObject[]): JsonObject[] {
  const touched = new Map<string, JsonObject>();
  for (const report of reports) {
    const type = stringValue(report.reportType);
    const files = asArray(report.writeSet).map((item) => stringValue(item)).filter(Boolean);
    for (const path of files) {
      const current = touched.get(path) ?? {
        path,
        reports: 0,
        progressReports: 0,
        stalledReports: 0,
        needsFactReports: 0,
        needsReworkReports: 0,
        toolErrorReports: 0,
        scoreDelta: 0,
        lastAt: "",
      };
      current.reports = numberValue(current.reports) + 1;
      current.progressReports = numberValue(current.progressReports) + (type === "progress" || type === "score_candidate" ? 1 : 0);
      current.stalledReports = numberValue(current.stalledReports) + (type === "stalled_no_useful_guess" ? 1 : 0);
      current.needsFactReports = numberValue(current.needsFactReports) + (type === "needs_fact" ? 1 : 0);
      current.needsReworkReports = numberValue(current.needsReworkReports) + (type === "needs_rework" ? 1 : 0);
      current.toolErrorReports = numberValue(current.toolErrorReports) + (type === "tool_error" ? 1 : 0);
      current.providerErrorReports = numberValue(current.providerErrorReports) + (type === "provider_error" ? 1 : 0);
      current.scoreDelta = numberValue(current.scoreDelta) + numberValue(report.scoreDelta);
      current.lastAt = stringValue(report.createdAt, stringValue(current.lastAt));
      touched.set(path, current);
    }
  }
  return [...touched.values()].sort((left, right) => stringValue(right.lastAt).localeCompare(stringValue(left.lastAt)));
}

function readJsonLines(path: string, maxLines: number): JsonObject[] {
  try {
    if (!path || !existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .slice(-maxLines)
      .map((line) => readInlineJson(line))
      .filter((record) => Object.keys(record).length > 0);
  } catch {
    return [];
  }
}

function compactActivityEvent(event: JsonObject): JsonObject {
  const score = asObject(event.score);
  return {
    createdAt: stringValue(event.created_at),
    attemptIndex: numberValue(event.attempt_index, NaN),
    phase: stringValue(event.phase),
    eventType: stringValue(event.event_type),
    summary: stringValue(event.summary),
    score: Object.keys(score).length > 0 ? { before: score.before ?? null, after: score.after ?? null, exact: score.exact === true } : null,
    artifactPath: stringValue(event.artifact_path),
    sessionId: stringValue(event.session_id),
  };
}

// Leases started before activity.jsonl existed still have return-gate and
// repair-request artifacts; synthesize a coarse timeline from those.
function activityFromReturnGates(workerLogDir: string): JsonObject[] {
  const validationDir = resolve(workerLogDir, "runner_validation");
  if (!existsSync(validationDir)) return [];
  let gateFiles: Array<{ index: number; path: string }> = [];
  try {
    gateFiles = readdirSync(validationDir)
      .map((file) => {
        const match = /^attempt-(\d+)\.return_gate\.json$/.exec(file);
        return match ? { index: Number(match[1]), path: resolve(validationDir, file) } : null;
      })
      .filter((entry): entry is { index: number; path: string } => entry !== null)
      .sort((left, right) => left.index - right.index);
  } catch {
    return [];
  }
  return gateFiles.slice(-4).map((entry) => {
    const gate = readJsonObject(entry.path);
    const validation = asObject(gate.runner_validation);
    const target = asObject(validation.target);
    const repairReasons = asArray(gate.repair_reasons).map((item) => stringValue(item)).filter(Boolean);
    let createdAt = "";
    try {
      createdAt = statSync(entry.path).mtime.toISOString();
    } catch {
      createdAt = "";
    }
    return {
      created_at: createdAt,
      attempt_index: numberValue(gate.attempt_index, entry.index),
      phase: repairReasons.length > 0 ? "repair_request" : "validation",
      event_type: repairReasons.length > 0 ? "runner_validation_rejected" : "runner_validation_passed",
      summary: repairReasons.length > 0 ? repairReasons.join("; ").slice(0, 400) : `runner validation ${stringValue(validation.status, "unknown")}`,
      score:
        Object.keys(target).length > 0
          ? { before: target.before ?? null, after: target.after ?? null, exact: target.exact === true }
          : undefined,
      artifact_path: entry.path,
    };
  });
}

function activeLeaseActivity(stateDir: string, runId: string, leaseId: string): JsonObject {
  const workerLogDir = resolve(stateDir, "runs", runId, "worker_logs", leaseId);
  let source = "activity_log";
  let events = readJsonLines(resolve(workerLogDir, "activity.jsonl"), 60);
  if (events.length === 0) {
    events = activityFromReturnGates(workerLogDir);
    source = events.length > 0 ? "return_gates" : "none";
  }
  const toolEvents = readJsonLines(resolve(workerLogDir, "tool_events.jsonl"), 30);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastTool = toolEvents.length > 0 ? toolEvents[toolEvents.length - 1] : null;
  const lastScoreEvent = [...events].reverse().find((event) => {
    const score = asObject(event.score);
    return Number.isFinite(numberValue(score.after, NaN)) || Number.isFinite(numberValue(score.before, NaN));
  });
  const lastRepair = [...events].reverse().find((event) => stringValue(event.event_type) === "repair_requested" || stringValue(event.event_type) === "runner_validation_rejected");
  const attemptIndex = events.reduce((max, event) => Math.max(max, numberValue(event.attempt_index, -1)), -1);
  return {
    source,
    workerLogDir,
    attemptIndex: attemptIndex >= 0 ? attemptIndex : null,
    phase: lastEvent ? stringValue(lastEvent.phase) : "",
    lastEvent: lastEvent ? compactActivityEvent(lastEvent) : null,
    lastTool: lastTool
      ? {
          createdAt: stringValue(lastTool.created_at),
          tool: stringValue(lastTool.tool),
          status: stringValue(lastTool.status),
          exitCode: lastTool.exit_code ?? null,
          errorKind: stringValue(lastTool.error_kind),
          durationMs: numberValue(lastTool.duration_ms, NaN),
        }
      : null,
    lastScore: lastScoreEvent ? asObject(lastScoreEvent.score) : null,
    lastRepairSummary: lastRepair ? stringValue(lastRepair.summary) : "",
    recentEvents: events.slice(-12).map(compactActivityEvent),
    toolEventCount: toolEvents.length,
  };
}

function activeFilesForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    const rows = store.db
      .query(
        `
          SELECT
            leases.id AS lease_id,
            leases.queue_id,
            leases.worker_id,
            leases.base_rev,
            leases.ttl,
            leases.heartbeat_at,
            queue.leased_at,
            targets.id AS target_id,
            targets.unit,
            targets.symbol,
            targets.source_path,
            targets.size,
            targets.fuzzy,
            targets.matched,
            targets.complete,
            targets.priority,
            targets.reason
          FROM leases
          JOIN queue ON queue.id = leases.queue_id
          JOIN targets ON targets.id = queue.target_id
          WHERE queue.run_id = ?
            AND leases.status = 'active'
          ORDER BY queue.leased_at ASC
        `,
      )
      .all(runId) as JsonObject[];
    return rows.map((row) => ({
      leaseId: row.lease_id,
      queueId: row.queue_id,
      workerId: row.worker_id,
      baseRev: row.base_rev,
      ttl: row.ttl,
      heartbeatAt: row.heartbeat_at,
      leasedAt: row.leased_at,
      activity: activeLeaseActivity(stateDir, runId, stringValue(row.lease_id)),
      targetId: row.target_id,
      unit: stringValue(row.unit),
      symbol: stringValue(row.symbol),
      sourcePath: stringValue(row.source_path),
      size: numberValue(row.size),
      fuzzy: numberValue(row.fuzzy, NaN),
      matched: numberValue(row.matched, NaN),
      complete: numberValue(row.complete, NaN),
      priority: numberValue(row.priority, NaN),
      reason: stringValue(row.reason),
    }));
  } finally {
    store.db.close();
  }
}

function reportPositiveAttempts(report: JsonObject): JsonObject[] {
  return asArray(report.attempts)
    .map(asObject)
    .filter((attempt) => attemptHasPercentScores(attempt) && numberValue(attempt.delta) > 0);
}

function reportScoreDelta(report: JsonObject): number {
  const recorded = numberValue(report.scoreDelta, NaN);
  if (Number.isFinite(recorded)) return recorded;
  return reportPositiveAttempts(report).reduce((sum, attempt) => sum + Math.max(0, numberValue(attempt.delta)), 0);
}

function reportRunnerTarget(report: JsonObject): JsonObject | null {
  return runnerValidationTarget(asObject(report.runnerValidation));
}

function reportHasExactAttempt(report: JsonObject): boolean {
  const runnerTarget = reportRunnerTarget(report);
  if (runnerTarget) return runnerTarget.exact === true;
  return reportPositiveAttempts(report).some(
    (attempt) => numberValue(attempt.oldScore, NaN) < 99.99999 && numberValue(attempt.newScore, NaN) >= 99.99999,
  );
}

function reportFailed(report: JsonObject): boolean {
  const gate = asObject(report.acceptanceGate);
  const validation = asObject(report.runnerValidation);
  const repairAttempts = asObject(report.repairAttempts);
  const validationStatus = stringValue(validation.status);
  return (
    gate.accepted === false ||
    (validationStatus !== "" && validationStatus !== "passed" && validationStatus !== "skipped") ||
    repairAttempts.exhausted === true
  );
}

function runnerValidationRejected(report: JsonObject): boolean {
  const status = stringValue(asObject(report.runnerValidation).status);
  return status !== "" && status !== "passed" && status !== "skipped";
}

function reportResult(report: JsonObject): ReportResult {
  const runnerTarget = reportRunnerTarget(report);
  if (runnerTarget) {
    if (runnerTarget.exact === true) return "exact";
    if (runnerTarget.improved === true || numberValue(runnerValidationDelta(asObject(report.runnerValidation)), 0) > 0) return "improved";
    return "no_progress";
  }
  // A rejected runner validation can never render as success, even when the
  // model-authored result/attempts claim exact or improved.
  if (runnerValidationRejected(report)) return "no_progress";
  const explicit = stringValue(report.result);
  if (reportHasExactAttempt(report)) return "exact";
  if (explicit === "no_progress") return explicit;
  if (explicit === "exact" || explicit === "improved") return reportScoreDelta(report) > 0 ? "improved" : "no_progress";
  return reportScoreDelta(report) > 0 ? "improved" : "no_progress";
}

function reportStopReason(report: JsonObject, result = reportResult(report)): StopReason {
  const explicit = stringValue(report.stopReason);
  if (explicit === "target_complete" || explicit === "needs_fact" || explicit === "stalled") return explicit;
  if (explicit === "no_useful_hypothesis") return "stalled";
  if (result === "exact") return "target_complete";
  if (stringValue(report.reportType) === "needs_fact") return "needs_fact";
  return "stalled";
}

function reportOutcome(report: JsonObject): ReportOutcome {
  const reportType = stringValue(report.reportType);
  // Legacy rows recorded gate rejections as tool_error; recover them by error kind.
  const errorKind = stringValue(asObject(report.error).kind);
  if (reportType === "needs_rework" || /^(?:runner_validation_|acceptance_gate_failed$)/.test(errorKind)) return "needs_rework";
  if (reportType === "provider_error" || errorKind === "provider_error") return "provider_error";
  if (reportType === "tool_error" || Object.keys(asObject(report.error)).length > 0) return "tool_error";
  if (reportFailed(report)) return "needs_rework";
  const result = reportResult(report);
  const stopReason = reportStopReason(report, result);
  if (result === "exact") return "exact";
  if (result === "improved") return stopReason === "needs_fact" ? "improved_needs_fact" : "improved_stalled";
  return stopReason === "needs_fact" ? "no_progress_needs_fact" : "no_progress_stalled";
}

function reportOutcomeCounts(reports: JsonObject[]): JsonObject {
  const counts: Record<ReportOutcome | "all", number> = {
    all: reports.length,
    exact: 0,
    improved_stalled: 0,
    improved_needs_fact: 0,
    no_progress_stalled: 0,
    no_progress_needs_fact: 0,
    needs_rework: 0,
    tool_error: 0,
    provider_error: 0,
  };
  for (const report of reports) counts[reportOutcome(report)] += 1;
  return counts;
}

function improvementRowsFromReports(reports: JsonObject[]): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const report of reports) {
    const target = asObject(report.target);
    const base = {
      reportId: report.id,
      reportType: report.reportType,
      createdAt: report.createdAt,
      workerId: report.workerId,
      symbol: stringValue(target.symbol),
      unit: stringValue(target.unit),
      sourcePath: stringValue(target.sourcePath, asArray(report.writeSet).map((item) => stringValue(item)).find(Boolean) ?? ""),
      summary: stringValue(report.summary),
      patchPath: stringValue(report.patchPath),
    };

    // Runner-validated progress is canonical even when the model-authored
    // attempts[] narrative has no numeric score fields.
    const runnerTarget = reportRunnerTarget(report);
    if (!runnerTarget && runnerValidationRejected(report)) continue;
    const runnerDelta = runnerValidationDelta(asObject(report.runnerValidation));
    if (runnerTarget && runnerDelta !== null && (runnerDelta > 0 || runnerTarget.exact === true)) {
      const before = numberValue(runnerTarget.before, NaN);
      const after = numberValue(runnerTarget.after, NaN);
      rows.push({
        ...base,
        totalDelta: Math.max(0, runnerDelta),
        bestDelta: Math.max(0, runnerDelta),
        oldScore: before,
        newScore: after,
        attempts: Math.max(1, reportPositiveAttempts(report).length),
        exactMatches: runnerTarget.exact === true && before < 99.99999 ? 1 : 0,
        source: "runner",
      });
      continue;
    }

    const attempts = reportPositiveAttempts(report);
    if (attempts.length === 0) continue;
    const bestAttempt = attempts.reduce((best, attempt) => (numberValue(attempt.delta) > numberValue(best.delta) ? attempt : best), attempts[0] ?? {});
    const oldScores = attempts.map((attempt) => numberValue(attempt.oldScore, NaN)).filter(Number.isFinite);
    const newScores = attempts.map((attempt) => numberValue(attempt.newScore, NaN)).filter(Number.isFinite);
    const totalDelta = attempts.reduce((sum, attempt) => sum + numberValue(attempt.delta), 0);
    const exactMatches = attempts.filter((attempt) => numberValue(attempt.oldScore, NaN) < 99.99999 && numberValue(attempt.newScore, NaN) >= 99.99999).length;
    rows.push({
      ...base,
      totalDelta,
      bestDelta: numberValue(bestAttempt.delta),
      oldScore: oldScores.length ? Math.min(...oldScores) : NaN,
      newScore: newScores.length ? Math.max(...newScores) : NaN,
      attempts: attempts.length,
      exactMatches,
      source: "model",
    });
  }
  return rows.sort((left, right) => stringValue(right.createdAt).localeCompare(stringValue(left.createdAt)));
}

function fileImprovementRows(improvements: JsonObject[]): JsonObject[] {
  const files = new Map<string, JsonObject>();
  for (const improvement of improvements) {
    const path = stringValue(improvement.sourcePath, "unknown");
    const current = files.get(path) ?? {
      path,
      reports: 0,
      symbols: new Set<string>(),
      totalDelta: 0,
      bestDelta: 0,
      bestScore: NaN,
      exactMatches: 0,
      firstAt: "",
      lastAt: "",
    };
    current.reports = numberValue(current.reports) + 1;
    current.totalDelta = numberValue(current.totalDelta) + numberValue(improvement.totalDelta);
    current.bestDelta = Math.max(numberValue(current.bestDelta), numberValue(improvement.bestDelta));
    const score = numberValue(improvement.newScore, NaN);
    current.bestScore = Number.isFinite(score) ? Math.max(numberValue(current.bestScore, -Infinity), score) : current.bestScore;
    current.exactMatches = numberValue(current.exactMatches) + numberValue(improvement.exactMatches);
    current.lastAt = stringValue(current.lastAt).localeCompare(stringValue(improvement.createdAt)) > 0 ? current.lastAt : improvement.createdAt;
    current.firstAt = stringValue(current.firstAt) && stringValue(current.firstAt).localeCompare(stringValue(improvement.createdAt)) < 0 ? current.firstAt : improvement.createdAt;
    const symbols = current.symbols instanceof Set ? current.symbols : new Set<string>();
    const symbol = stringValue(improvement.symbol);
    if (symbol) symbols.add(symbol);
    current.symbols = symbols;
    files.set(path, current);
  }
  const rows: JsonObject[] = [];
  for (const file of files.values()) {
    rows.push({
      ...file,
      symbols: [...(file.symbols instanceof Set ? file.symbols : new Set<string>())],
      bestScore: numberValue(file.bestScore, NaN),
    });
  }
  return rows.sort((left, right) => numberValue(right.totalDelta) - numberValue(left.totalDelta));
}

function runSummary(
  status: JsonObject,
  reports: JsonObject[],
  initialMeasures: JsonObject,
  currentMeasures: JsonObject,
  improvements: JsonObject[],
  trustedReport: JsonObject = {},
): JsonObject {
  const run = asObject(status.run);
  const createdAtMs = timeMs(run.createdAt);
  const lastReportAtMs = reports.reduce((latest, report) => Math.max(latest, timeMs(report.createdAt)), 0);
  const reportTypes = new Map<string, number>();
  for (const report of reports) {
    const type = stringValue(report.reportType, "unknown");
    reportTypes.set(type, (reportTypes.get(type) ?? 0) + 1);
  }
  const positiveAttempts = improvements.reduce((sum, improvement) => sum + numberValue(improvement.attempts), 0);
  const targetExactMatches = improvements.reduce((sum, improvement) => sum + numberValue(improvement.exactMatches), 0);
  const trustedCounts = asObject(trustedReport.counts);
  const reportReady = stringValue(trustedReport.status) === "ready";
  return {
    createdAt: stringValue(run.createdAt),
    elapsedMs: createdAtMs ? Math.max(0, Date.now() - createdAtMs) : 0,
    lastReportAt: lastReportAtMs ? new Date(lastReportAtMs).toISOString() : null,
    lastReportAgeMs: lastReportAtMs ? Math.max(0, Date.now() - lastReportAtMs) : null,
    totalReports: reports.length,
    reportTypes: Object.fromEntries(reportTypes),
    progressReports: numberValue(reportTypes.get("progress")) + numberValue(reportTypes.get("score_candidate")),
    stalledReports: numberValue(reportTypes.get("stalled_no_useful_guess")),
    needsFactReports: numberValue(reportTypes.get("needs_fact")),
    needsReworkReports: numberValue(reportTypes.get("needs_rework")),
    toolErrorReports: numberValue(reportTypes.get("tool_error")),
    providerErrorReports: numberValue(reportTypes.get("provider_error")),
    reportOutcomeCounts: reportOutcomeCounts(reports),
    positiveAttempts,
    improvedSymbols: improvements.length,
    improvedFiles: new Set(improvements.map((improvement) => stringValue(improvement.sourcePath)).filter(Boolean)).size,
    exactMatches: targetExactMatches,
    targetExactMatches,
    reportNewMatches: reportReady ? numberValue(trustedCounts.newMatches) : null,
    reportImprovements: reportReady ? numberValue(trustedCounts.improvements) : null,
    reportStatus: stringValue(trustedReport.status, "missing"),
    totalPositiveDelta: improvements.reduce((sum, improvement) => sum + numberValue(improvement.totalDelta), 0),
    matchedCodeDelta: measureDelta(initialMeasures, currentMeasures, "matched_code_percent"),
    completeCodeDelta: measureDelta(initialMeasures, currentMeasures, "complete_code_percent"),
    matchedFunctionDelta: measureDelta(initialMeasures, currentMeasures, "matched_functions_percent"),
    completeUnitDelta: measureDelta(initialMeasures, currentMeasures, "complete_units"),
  };
}

function eventsForRun(stateDir: string, runId: string, limit = 40): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, event_type, producer, handled_at, created_at, payload_json
            FROM events
            WHERE run_id = ?
            ORDER BY created_at DESC
            ${sqlLimit(limit)}
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => {
      const payload = readInlineJson(stringValue(row.payload_json));
      const target = asObject(payload.target);
      return {
        id: row.id,
        eventType: row.event_type,
        producer: row.producer,
        handledAt: row.handled_at,
        createdAt: row.created_at,
        leaseId: payload.lease_id,
        reason: payload.reason,
        symbol: target.symbol,
        sourcePath: target.source_path,
      };
    });
  } finally {
    store.db.close();
  }
}

function countBy(rows: JsonObject[], key: string): JsonObject {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = stringValue(row[key], "unknown") || "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]));
}

function piSessionsForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, lease_id, role, session_id, session_file, provider, model, thinking_level, status, output_path, created_at
            FROM pi_sessions
            WHERE run_id = ?
            ORDER BY created_at DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      leaseId: row.lease_id,
      role: row.role,
      sessionId: row.session_id,
      sessionFile: row.session_file,
      provider: row.provider,
      model: row.model,
      thinkingLevel: row.thinking_level,
      status: row.status,
      outputPath: row.output_path,
      createdAt: row.created_at,
    }));
  } finally {
    store.db.close();
  }
}

function directorCyclesForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT id, trigger_event, active_workers, summary_path, decision_path, created_at
            FROM director_cycles
            WHERE run_id = ?
            ORDER BY created_at DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      triggerEvent: row.trigger_event,
      activeWorkers: numberValue(row.active_workers),
      summaryPath: row.summary_path,
      decisionPath: row.decision_path,
      createdAt: row.created_at,
    }));
  } finally {
    store.db.close();
  }
}

function leasesForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT
              leases.id,
              leases.queue_id,
              leases.worker_id,
              leases.base_rev,
              leases.write_set_hash,
              leases.worktree_path,
              leases.ttl,
              leases.heartbeat_at,
              leases.status,
              queue.leased_at,
              targets.unit,
              targets.symbol,
              targets.source_path
            FROM leases
            JOIN queue ON queue.id = leases.queue_id
            JOIN targets ON targets.id = queue.target_id
            WHERE queue.run_id = ?
            ORDER BY COALESCE(queue.leased_at, leases.heartbeat_at, leases.ttl) DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      id: row.id,
      queueId: row.queue_id,
      workerId: row.worker_id,
      baseRev: row.base_rev,
      writeSetHash: row.write_set_hash,
      worktreePath: row.worktree_path,
      ttl: row.ttl,
      heartbeatAt: row.heartbeat_at,
      status: row.status,
      leasedAt: row.leased_at,
      unit: row.unit,
      symbol: row.symbol,
      sourcePath: row.source_path,
    }));
  } finally {
    store.db.close();
  }
}

function queueTargetsForRun(stateDir: string, runId: string): JsonObject[] {
  const store = openState(stateDir);
  try {
    return (
      store.db
        .query(
          `
            SELECT
              queue.id AS queue_id,
              queue.priority AS queue_priority,
              queue.reason AS queue_reason,
              queue.status AS queue_status,
              queue.created_at AS queue_created_at,
              queue.leased_at,
              targets.id AS target_id,
              targets.unit,
              targets.symbol,
              targets.source_path,
              targets.size,
              targets.fuzzy,
              targets.matched,
              targets.complete,
              targets.risk,
              targets.status AS target_status,
              targets.priority AS target_priority,
              targets.reason AS target_reason,
              targets.created_at AS target_created_at
            FROM queue
            JOIN targets ON targets.id = queue.target_id
            WHERE queue.run_id = ?
            ORDER BY queue.created_at DESC
          `,
        )
        .all(runId) as JsonObject[]
    ).map((row) => ({
      queueId: row.queue_id,
      targetId: row.target_id,
      queueStatus: row.queue_status,
      targetStatus: row.target_status,
      priority: numberValue(row.queue_priority, numberValue(row.target_priority)),
      reason: stringValue(row.queue_reason, stringValue(row.target_reason)),
      createdAt: row.queue_created_at,
      leasedAt: row.leased_at,
      unit: row.unit,
      symbol: row.symbol,
      sourcePath: row.source_path,
      size: numberValue(row.size),
      fuzzy: numberValue(row.fuzzy, NaN),
      matched: numberValue(row.matched, NaN),
      complete: numberValue(row.complete, NaN),
      risk: row.risk,
    }));
  } finally {
    store.db.close();
  }
}

function checkpointForRun(stateDir: string, runId: string): JsonObject | null {
  const store = openState(stateDir);
  try {
    return latestCheckpointSummary(store, runId) as JsonObject | null;
  } finally {
    store.db.close();
  }
}

function latestChildDirectory(root: string): string {
  if (!existsSync(root)) return "";
  try {
    const dirs = readdirSync(root)
      .map((file) => resolve(root, file))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((left, right) => left.localeCompare(right));
    return dirs.length > 0 ? dirs[dirs.length - 1] ?? "" : "";
  } catch {
    return "";
  }
}

function latestRegressionCheckSummary(stateDir: string, runId: string): JsonObject | null {
  const artifactDir = latestChildDirectory(resolve(stateDir, "regression_checks", runId));
  if (!artifactDir) return null;
  const summaryPath = resolve(artifactDir, "summary.json");
  const summary = readJsonObject(summaryPath);
  if (!summary.status) return null;
  return {
    ...summary,
    artifactDir,
    summaryPath,
  };
}

function latestPrSplitPlanSummary(stateDir: string, runId: string): JsonObject | null {
  const artifactDir = latestChildDirectory(resolve(stateDir, "pr_handoff", runId, "split_plans"));
  if (!artifactDir) return null;
  const summaryPath = resolve(artifactDir, "summary.json");
  const summary = readJsonObject(summaryPath);
  if (!summary.status) return null;
  return {
    ...summary,
    artifactDir,
    summaryPath,
  };
}

function latestQaRepairSummary(stateDir: string, runId: string): JsonObject | null {
  const artifactDir = latestChildDirectory(resolve(stateDir, "qa_repairs", runId));
  if (!artifactDir) return null;
  const summaryPath = resolve(artifactDir, "summary.json");
  const summary = readJsonObject(summaryPath);
  if (!summary.schema_version) return null;
  return {
    ...summary,
    artifactDir,
    summaryPath,
    queuePath: stringValue(summary.queue_path, resolve(artifactDir, "queue.json")),
    reportPath: stringValue(summary.report_path, resolve(artifactDir, "report.md")),
    shipStatusPath: stringValue(summary.ship_status_path, resolve(artifactDir, "ship_status.json")),
  };
}

function handoffForRun(stateDir: string, runId: string, checkpoint: JsonObject | null): JsonObject {
  return {
    checkpoint,
    qa: latestRegressionCheckSummary(stateDir, runId),
    qaRepair: latestQaRepairSummary(stateDir, runId),
    splitPlan: latestPrSplitPlanSummary(stateDir, runId),
    baseline: readJsonObject(resolve(stateDir, "pr_handoff", "baseline_status.json")),
    ship: readJsonObject(resolve(stateDir, "pr_handoff", "ship_status.json")),
  };
}

// ---------------------------------------------------------------------------
// PR tracking: slice -> branch -> GitHub PR records, persisted across
// sessions so opened PRs stay visible after the plan that produced them is
// superseded. See docs/10-system-design/65-operator-flow-and-pr-tracking.md.

// v2 adds per-slice in-flight preparation state (local.status "preparing" +
// local.prepStartedAt) and a review substate envelope (review.subState /
// review.lastSeenComments / review.subStateSetAt) used by the kanban board.
// normalizePrRecord backfills both on v1 records, so older state upgrades
// transparently.
const PR_RECORDS_SCHEMA_VERSION = "session_pr_records_v2";
const PR_RECORD_SCHEMA_VERSION = "session_pr_record_v2";
const DEFAULT_PR_BATCH_LIMIT = 3;

interface PrRecordContext {
  baseSha?: string;
  runId?: string;
  sessionId?: string;
  sourcePlan?: JsonObject;
}

function prRecordsPath(stateDir: string): string {
  return resolve(stateDir, "pr_handoff", "pr_records.json");
}

function readPrRecords(stateDir: string): JsonObject {
  return readJsonObject(prRecordsPath(stateDir));
}

function prSessionId(runId: string): string {
  return runId ? `run:${runId}` : "legacy";
}

function prRecordContext(stateDir: string, runId = ""): PrRecordContext {
  const baselineStatus = readJsonObject(resolve(stateDir, "pr_handoff", "baseline_status.json"));
  const shipStatus = readJsonObject(resolve(stateDir, "pr_handoff", "ship_status.json"));
  const plan = runId ? latestPrSplitPlanSummary(stateDir, runId) : null;
  const planObject = asObject(plan);
  return {
    runId,
    sessionId: prSessionId(runId),
    baseSha: stringValue(baselineStatus.baseSha, stringValue(shipStatus.baseSha)),
    sourcePlan: Object.keys(planObject).length
      ? {
          runId,
          summaryPath: stringValue(planObject.summaryPath),
          outputPath: stringValue(planObject.outputPath),
          createdAt: stringValue(planObject.createdAt),
        }
      : undefined,
  };
}

function normalizePrRecord(record: JsonObject, context: PrRecordContext = {}): JsonObject {
  const local = asObject(record.local);
  const validation = asObject(record.validation);
  const batch = asObject(record.batch);
  const github = asObject(record.github);
  const review = asObject(record.review);
  const sourcePlan = asObject(record.sourcePlan);
  const prNumber = numberValue(record.prNumber, NaN);
  const comments = numberValue(record.comments, 0);
  const status = stringValue(record.status, "planned");
  const branch = stringValue(record.branch);
  const runId = stringValue(record.runId, context.runId ?? "");
  const sessionId = stringValue(record.sessionId, context.sessionId ?? prSessionId(runId));
  const baseSha = stringValue(record.baseSha, context.baseSha ?? "");
  return {
    ...record,
    schemaVersion: stringValue(record.schemaVersion, PR_RECORD_SCHEMA_VERSION),
    runId,
    sessionId,
    ...(baseSha ? { baseSha } : {}),
    sourcePlan: {
      ...sourcePlan,
      ...asObject(context.sourcePlan),
    },
    local: {
      status: stringValue(local.status, "not_prepared"),
      branch: stringValue(local.branch, branch),
      worktreePath: stringValue(local.worktreePath),
      commitSha: stringValue(local.commitSha),
      preparedAt: stringValue(local.preparedAt),
      prepStartedAt: stringValue(local.prepStartedAt),
      error: stringValue(local.error),
      ...local,
    },
    validation: {
      status: stringValue(validation.status, "not_run"),
      checkedAt: stringValue(validation.checkedAt),
      summaryPath: stringValue(validation.summaryPath),
      reportPath: stringValue(validation.reportPath),
      newMatches: numberValue(validation.newMatches, 0),
      regressions: numberValue(validation.regressions, 0),
      issuesCheck: stringValue(validation.issuesCheck),
      repairNote: stringValue(validation.repairNote),
      ...validation,
    },
    batch: {
      state: stringValue(batch.state, "unbatched"),
      ordinal: numberValue(batch.ordinal, NaN),
      selectedAt: stringValue(batch.selectedAt),
      publishedAt: stringValue(batch.publishedAt),
      ...batch,
    },
    github: {
      status,
      prNumber: Number.isFinite(prNumber) ? prNumber : null,
      url: stringValue(record.url),
      ci: stringValue(record.ci),
      comments,
      author: stringValue(record.author),
      updatedAt: stringValue(record.updatedAt),
      ...github,
    },
    // review.subState is the per-PR review subphase used by the In Review
    // column of the kanban: awaiting | new_comments | changes_requested |
    // fixing. It is derived on GitHub hydrate (see hydrateReviewSubState) and
    // can be set manually via /api/prs/review-state. lastSeenComments tracks
    // the comment count at the last operator ack so new comments surface.
    review: {
      subState: stringValue(review.subState, ""),
      lastSeenComments: numberValue(review.lastSeenComments, comments),
      subStateSetAt: stringValue(review.subStateSetAt),
      lastReviewerSeenAt: stringValue(review.lastReviewerSeenAt),
      lastOurActionAt: stringValue(review.lastOurActionAt),
      ...review,
    },
  };
}

function normalizePrRecordsPayload(payload: JsonObject, context: PrRecordContext = {}): JsonObject {
  return {
    ...payload,
    schemaVersion: stringValue(payload.schemaVersion, PR_RECORDS_SCHEMA_VERSION),
    batchLimit: intValue(payload.batchLimit, DEFAULT_PR_BATCH_LIMIT, 1),
    records: asArray(payload.records).map((record) => normalizePrRecord(asObject(record), context)),
  };
}

function writePrRecords(stateDir: string, payload: JsonObject): JsonObject {
  const normalized = normalizePrRecordsPayload(payload);
  mkdirSync(dirname(prRecordsPath(stateDir)), { recursive: true });
  writeFileSync(prRecordsPath(stateDir), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

// Local preparation stamps local.status "preparing" before it starts so the
// kanban can show the in-flight slice. If that operation never finishes
// (process killed, server restart), the stamp would stick forever; this
// recovers it. It is a no-op while a prepare-local operation is actually
// running (operation is the module-level singleton tracking the live op),
// and otherwise rewrites any "preparing" record back to not_prepared.
// Dashboard polling calls this every few seconds, so stale prep self-heals
// promptly without a manual resync.
function localPrepOperationRunning(): boolean {
  return Boolean(operation && operation.status === "running" && (operation.name === "prepare-local-pr" || operation.name === "prepare-local-batch"));
}

function recoverInFlightPrepState(stateDir: string, payload: JsonObject): JsonObject {
  if (localPrepOperationRunning()) return payload;
  const records = asArray(payload.records).map(asObject);
  let recovered = 0;
  const next = records.map((record) => {
    const local = asObject(record.local);
    if (stringValue(local.status) === "preparing") {
      recovered += 1;
      return { ...record, local: { ...local, status: "not_prepared", prepStartedAt: "", error: "Previous local preparation did not complete; retry." } };
    }
    return record;
  });
  if (recovered === 0) return payload;
  appendLog("ui", `recovered ${recovered} stale in-flight local preparation record(s)`);
  return writePrRecords(stateDir, { ...payload, records: next, syncedAt: stringValue(payload.syncedAt) || new Date().toISOString() });
}

// Find the newest QA-repair artifact directory across the run-scoped
// (qa_repairs/{runId}) and campaign-scoped (qa-repair-campaign /
// qa-repair-lane) roots. Campaigns nest as <campaign>/<timestamp>; the
// run-scoped path is a single timestamped dir. Returns "" when none exists.
function latestQaRepairArtifactDir(stateDir: string, runId: string): string {
  const candidates: string[] = [];
  if (runId) candidates.push(latestChildDirectory(resolve(stateDir, "qa_repairs", runId)));
  for (const root of [resolve(stateDir, "qa-repair-campaign", "qa_repairs"), resolve(stateDir, "qa-repair-lane", "qa_repairs")]) {
    const campaign = latestChildDirectory(root);
    if (campaign) candidates.push(latestChildDirectory(campaign));
  }
  let best = "";
  let bestAt = "";
  for (const dir of candidates) {
    if (!dir) continue;
    const queue = readJsonObject(resolve(dir, "queue.json"));
    const createdAt = stringValue(queue.created_at, stringValue(queue.createdAt, ""));
    // Prefer an explicit created_at; fall back to the dir name (ISO timestamp).
    const effectiveAt = createdAt || dir.split(/[\\/]/).pop() || "";
    if (!best || effectiveAt > bestAt) {
      best = dir;
      bestAt = effectiveAt;
    }
  }
  return best;
}

// Build sourcePath -> status from the newest QA-repair queue, blending the
// per-file queue statuses with the ship_status droppedFiles (paths dropped
// because QA repair is still queued for them). Empty map when no repair run
// exists; the enrich step then becomes a no-op.
function latestQaRepairFileStatuses(stateDir: string, runId: string): Map<string, string> {
  const dir = latestQaRepairArtifactDir(stateDir, runId);
  const result = new Map<string, string>();
  if (!dir) return result;
  for (const candidate of asArray(readJsonObject(resolve(dir, "queue.json")).candidate_files).map(asObject)) {
    const sourcePath = stringValue(candidate.sourcePath);
    if (sourcePath) result.set(sourcePath, stringValue(candidate.status, "needs_qa_repair"));
  }
  const dropped = asObject(readJsonObject(resolve(dir, "ship_status.json")).droppedFiles);
  for (const path of Object.keys(dropped)) {
    if (path && !result.has(path)) result.set(path, "qa_repair_blocked");
  }
  return result;
}

// View-only enrichment: mark planned, not-yet-verified slices whose files
// overlap the latest QA-repair pending set as "repairing". Never overrides a
// locally-verified validation (passed/failed) or an in-flight/blocked local
// workspace — those states are authoritative for the slice.
function enrichRecordsWithQaRepair(records: JsonObject[], stateDir: string, runId: string): JsonObject[] {
  const repairStatuses = latestQaRepairFileStatuses(stateDir, runId);
  if (repairStatuses.size === 0) return records;
  return records.map((record) => {
    const validation = asObject(record.validation);
    const localStatus = stringValue(asObject(record.local).status);
    if (stringValue(record.status, "planned") !== "planned") return record;
    if (["ready", "preparing", "blocked", "dirty"].includes(localStatus)) return record;
    const validationStatus = stringValue(validation.status, "not_run");
    if (validationStatus !== "not_run" && validationStatus !== "") return record;
    const files = asArray(record.files).map((path) => stringValue(path)).filter(Boolean);
    const pending = files.filter((file) => repairStatuses.has(file));
    if (pending.length === 0) return record;
    return {
      ...record,
      validation: { ...validation, status: "repairing", repairNote: `QA repair pending on ${pending.length}/${files.length} file(s)`, repairFileCount: pending.length },
    };
  });
}

// Derive the In Review subphase from GitHub state + the stored last-seen
// baseline. Preserves a manual "fixing" subState unless something newer
// arrived (changes requested again, or comments grew). Returns the review
// envelope to merge into the record on hydrate.
function deriveReviewSubState(prev: JsonObject, githubStatus: string, reviewDecision: string, comments: number): JsonObject {
  const subStateSetAt = stringValue(prev.subStateSetAt);
  const prevSubState = stringValue(prev.subState);
  const lastSeenComments = numberValue(prev.lastSeenComments, comments);
  if (githubStatus === "merged" || githubStatus === "closed" || githubStatus === "draft") {
    return { ...prev, subState: "" };
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    return { ...prev, subState: "changes_requested", lastSeenComments: comments, subStateSetAt: subStateSetAt || new Date().toISOString() };
  }
  const commentsIncreased = comments > lastSeenComments;
  // A manual "fixing" persists across syncs until the operator clears it or
  // new reviewer activity supersedes it; new comments take priority.
  if (commentsIncreased) {
    return { ...prev, subState: "new_comments", lastSeenComments: comments, subStateSetAt: subStateSetAt || new Date().toISOString() };
  }
  if (prevSubState === "fixing") return prev;
  return { ...prev, subState: "awaiting", subStateSetAt: subStateSetAt || new Date().toISOString() };
}

// Assemble the PR records view shown on the dashboard: normalize persisted
// state, self-heal any stale in-flight preparation stamp, then layer the
// QA-repair derivation on top. Never writes the QA-repair enrichment to disk
// — it is a view concern; persisted validation comes from local verification.
function buildPrRecordsView(stateDir: string, runId: string): JsonObject {
  const context = prRecordContext(stateDir, runId);
  const recovered = recoverInFlightPrepState(stateDir, normalizePrRecordsPayload(readPrRecords(stateDir), context));
  const enriched = enrichRecordsWithQaRepair(asArray(recovered.records).map(asObject), stateDir, runId);
  return { ...recovered, records: enriched };
}

function updatePrRecord(stateDir: string, branch: string, update: (record: JsonObject) => JsonObject): JsonObject | null {
  const payload = normalizePrRecordsPayload(readPrRecords(stateDir));
  const records = asArray(payload.records).map(asObject);
  const index = records.findIndex((candidate) => stringValue(candidate.branch) === branch);
  if (index < 0) return null;
  records[index] = normalizePrRecord(update(records[index]));
  return writePrRecords(stateDir, { ...payload, records, syncedAt: new Date().toISOString() });
}

function prBranchPathSlug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "slice";
}

function prWorkspacePath(stateDir: string, runId: string, branch: string): string {
  return resolve(stateDir, "pr_workspaces", runId || "manual", prBranchPathSlug(branch));
}

function prHandoffArtifactPath(stateDir: string, savedPath: string, filename: string): string {
  if (savedPath && existsSync(savedPath)) return savedPath;
  return resolve(stateDir, "pr_handoff", filename);
}

function prRecordMatchesRun(record: JsonObject, runId: string, activeBranches: Set<string> = new Set()): boolean {
  if (!runId) return true;
  const recordRunId = stringValue(record.runId);
  if (recordRunId) return recordRunId === runId;
  const sessionId = stringValue(record.sessionId);
  if (sessionId && sessionId !== "legacy") return sessionId === prSessionId(runId);
  const branch = stringValue(record.branch);
  if (branch && activeBranches.has(branch)) return true;
  const status = stringValue(record.status, "planned");
  return !Number.isFinite(numberValue(record.prNumber, NaN)) && ["planned", "planned_mock", "blocked"].includes(status);
}

function activeSessionPrBlockers(stateDir: string, runId = latestRunId(stateDir)): string[] {
  const payload = normalizePrRecordsPayload(readPrRecords(stateDir));
  const activeBranches = new Set(asArray(latestPrSplitPlanSummary(stateDir, runId)?.slices).map((slice) => stringValue(asObject(slice).branchName)).filter(Boolean));
  const activeStatuses = new Set(["planned", "planned_mock", "branch_pushed", "draft", "open", "changes_requested", "blocked"]);
  const localBlocking = new Set(["ready", "blocked", "dirty"]);
  const blockers: string[] = [];
  for (const record of asArray(payload.records).map(asObject)) {
    if (!prRecordMatchesRun(record, runId, activeBranches)) continue;
    const status = stringValue(record.status, "planned");
    const localStatus = stringValue(asObject(record.local).status, "not_prepared");
    if (status === "merged" || status === "closed") continue;
    if (!activeStatuses.has(status) && !localBlocking.has(localStatus)) continue;
    const label = stringValue(record.displayName, stringValue(record.sliceId, stringValue(record.branch, "PR slice")));
    blockers.push(`${label}: ${status}${localStatus !== "not_prepared" ? ` / local ${localStatus}` : ""}`);
  }
  return blockers;
}

function upstreamRepoSlug(repoRoot: string): string {
  const result = spawnSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  const match = (result.stdout ?? "").trim().match(/github\.com[:/]([^/]+\/[^/.]+)/);
  return match ? match[1] : "";
}

/** PR lifecycle status from GitHub fields; `planned` when no PR exists yet. */
function prStatusFromGithub(pr: JsonObject): string {
  const state = stringValue(pr.state).toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  if (pr.isDraft === true) return "draft";
  if (stringValue(pr.reviewDecision) === "CHANGES_REQUESTED") return "changes_requested";
  return "open";
}

function ciVerdict(rollup: unknown): string {
  const checks = asArray(rollup).map(asObject);
  if (checks.length === 0) return "";
  const states = checks.map((check) => stringValue(check.conclusion, stringValue(check.state)).toUpperCase());
  if (states.some((state) => state === "FAILURE" || state === "ERROR" || state === "TIMED_OUT")) return "failing";
  if (states.some((state) => state === "" || state === "PENDING" || state === "IN_PROGRESS" || state === "QUEUED" || state === "EXPECTED")) return "pending";
  return "passing";
}

function quietGit(repoRoot: string, args: string[]): CliResult {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function splitSeriesMatch(branch: string): RegExpMatchArray | null {
  return branch.match(/^codex\/split-(\d{2})-(.+)$/);
}

function isLocalBranchPrRecord(record: JsonObject): boolean {
  const branch = stringValue(record.branch);
  return Boolean(splitSeriesMatch(branch)) || stringValue(asObject(record.sourcePlan).source) === "local_branch_discovery";
}

function splitSeriesOrdinal(branch: string): number {
  const match = splitSeriesMatch(branch);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function humanizeBranchSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

function splitSeriesTitle(branch: string, total: number): string {
  const match = splitSeriesMatch(branch);
  if (!match) return branch;
  const ordinal = Number(match[1]);
  return `${ordinal}/${total}: ${humanizeBranchSlug(match[2])}`;
}

function splitSeriesSort(left: JsonObject, right: JsonObject): number {
  const leftBranch = stringValue(left.branch);
  const rightBranch = stringValue(right.branch);
  const leftOrdinal = splitSeriesOrdinal(leftBranch);
  const rightOrdinal = splitSeriesOrdinal(rightBranch);
  if (leftOrdinal !== rightOrdinal) return leftOrdinal - rightOrdinal;
  return leftBranch.localeCompare(rightBranch);
}

function branchWorktreePaths(repoRoot: string): Map<string, string> {
  const result = quietGit(repoRoot, ["worktree", "list", "--porcelain"]);
  const paths = new Map<string, string>();
  if (result.exitCode !== 0) return paths;
  let currentPath = "";
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch refs/heads/") && currentPath) {
      paths.set(line.slice("branch refs/heads/".length).trim(), currentPath);
    }
  }
  return paths;
}

function branchExists(repoRoot: string, branch: string): boolean {
  return Boolean(branch) && quietGit(repoRoot, ["rev-parse", "--verify", branch]).exitCode === 0;
}

function localBranchDiffBase(repoRoot: string, baseRef: string, branch: string): string {
  const mergeBase = quietGit(repoRoot, ["merge-base", baseRef, branch]).stdout.trim();
  return mergeBase || baseRef;
}

function mergePrRecord(base: JsonObject, update: JsonObject, context: PrRecordContext = {}): JsonObject {
  return normalizePrRecord(
    {
      ...base,
      ...update,
      sourcePlan: {
        ...asObject(base.sourcePlan),
        ...asObject(update.sourcePlan),
      },
      local: {
        ...asObject(base.local),
        ...asObject(update.local),
      },
      validation: {
        ...asObject(base.validation),
        ...asObject(update.validation),
      },
      batch: {
        ...asObject(base.batch),
        ...asObject(update.batch),
      },
      github: {
        ...asObject(base.github),
        ...asObject(update.github),
      },
    },
    context,
  );
}

function setPrRecord(recordsByBranch: Map<string, JsonObject>, branch: string, update: JsonObject, context: PrRecordContext = {}): JsonObject {
  const merged = mergePrRecord(recordsByBranch.get(branch) ?? {}, update, context);
  recordsByBranch.set(branch, merged);
  return merged;
}

function localSplitSeriesRecords(repoRoot: string, baseRef: string, baseSha: string, context: PrRecordContext): JsonObject[] {
  const refs = quietGit(repoRoot, ["for-each-ref", "refs/heads/codex/split-*", "--format=%(refname:short)%09%(objectname)%09%(upstream:short)"]);
  if (refs.exitCode !== 0) return [];
  const worktrees = branchWorktreePaths(repoRoot);
  const branches = refs.stdout
    .split("\n")
    .map((line) => {
      const [branch = "", commitSha = "", upstream = ""] = line.split("\t");
      return { branch: branch.trim(), commitSha: commitSha.trim(), upstream: upstream.trim() };
    })
    .filter((item) => splitSeriesMatch(item.branch))
    .sort((left, right) => splitSeriesOrdinal(left.branch) - splitSeriesOrdinal(right.branch));
  const total = branches.reduce((max, item) => Math.max(max, splitSeriesOrdinal(item.branch)), 0);
  return branches.map((item) => {
    const diffBase = localBranchDiffBase(repoRoot, baseRef, item.branch);
    const files = quietGit(repoRoot, ["diff", "--name-only", `${diffBase}..${item.branch}`]).stdout
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean);
    const worktreePath = worktrees.get(item.branch) ?? "";
    const worktreeReady = Boolean(worktreePath) && existsSync(resolve(worktreePath, ".git"));
    return normalizePrRecord(
      {
        sliceId: item.branch.replace(/^codex\/split-/, "split-"),
        displayName: splitSeriesTitle(item.branch, total),
        branch: item.branch,
        title: splitSeriesTitle(item.branch, total),
        scope: "split-series",
        files,
        status: "planned",
        baseSha,
        sourcePlan: {
          source: "local_branch_discovery",
          baseRef,
          diffBase,
          discoveredAt: new Date().toISOString(),
        },
        local: {
          status: worktreeReady ? "ready" : "local_only",
          branch: item.branch,
          worktreePath: worktreeReady ? worktreePath : "",
          commitSha: item.commitSha,
          preparedAt: "",
          error: "",
        },
        validation: {
          status: "not_run",
        },
        batch: {
          state: "unbatched",
          ordinal: splitSeriesOrdinal(item.branch),
        },
      },
      context,
    );
  });
}

function shouldKeepUnplannedPrRecord(record: JsonObject, repoRoot: string): boolean {
  const branch = stringValue(record.branch);
  const local = asObject(record.local);
  const sourcePlan = asObject(record.sourcePlan);
  if (record.prNumber) return true;
  if (splitSeriesMatch(branch) && branchExists(repoRoot, branch)) return true;
  if (stringValue(sourcePlan.source) === "local_branch_discovery" && branchExists(repoRoot, branch)) return true;
  return ["ready", "blocked", "dirty", "local_only"].includes(stringValue(local.status));
}

async function hydratePrRecordFromGithub(record: JsonObject, pr: JsonObject, repoSlug: string, repoRoot: string): Promise<JsonObject> {
  const prNumber = numberValue(pr.number, NaN);
  if (!Number.isFinite(prNumber)) return record;
  const update: JsonObject = {
    prNumber,
    url: stringValue(pr.url),
    author: stringValue(asObject(pr.author).login),
    status: prStatusFromGithub(pr),
    updatedAt: stringValue(pr.updatedAt),
    github: {
      status: prStatusFromGithub(pr),
      prNumber,
      url: stringValue(pr.url),
      author: stringValue(asObject(pr.author).login),
      updatedAt: stringValue(pr.updatedAt),
    },
  };
  const view = await runCli(["gh", "pr", "view", String(prNumber), "--repo", repoSlug, "--json", "comments,statusCheckRollup,files"], repoRoot);
  let comments = numberValue(record.comments, 0);
  if (view.exitCode === 0) {
    const detail = asObject(JSON.parse(view.stdout || "{}"));
    comments = asArray(detail.comments).length;
    const ci = ciVerdict(detail.statusCheckRollup);
    update.comments = comments;
    update.ci = ci;
    update.files = asArray(detail.files).map((file) => stringValue(asObject(file).path)).filter(Boolean);
    update.github = {
      ...asObject(update.github),
      ci,
      comments,
    };
  }
  const githubStatus = stringValue(update.status);
  const reviewDecision = stringValue(pr.reviewDecision);
  update.review = deriveReviewSubState(asObject(record.review), githubStatus, reviewDecision, comments);
  return mergePrRecord(record, update);
}

/**
 * Seed records from the latest (ship-filtered) split plan's match slices,
 * keep previously tracked records that already map to a PR, then hydrate
 * status/comments/CI from GitHub. gh failures degrade to seeded records with
 * a warning instead of failing the sync — the board should never go blank
 * because GitHub was unreachable.
 */
async function syncPrRecords(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  const context = prRecordContext(stateDir, runId);
  const plan = latestPrSplitPlanSummary(stateDir, runId);
  const previous = asArray(normalizePrRecordsPayload(readPrRecords(stateDir)).records).map(asObject);
  const previousByBranch = new Map(previous.map((record) => [stringValue(record.branch), record]));
  const baseRef = paths.project?.baseRef ?? "origin/master";
  const baseSha =
    stringValue(context.baseSha) ||
    quietGit(repoRoot, ["rev-parse", "--verify", baseRef]).stdout.trim();

  const recordsByBranch = new Map<string, JsonObject>();
  for (const slice of asArray(plan?.slices).map(asObject)) {
    if (slice.lane !== "match") continue;
    const branch = stringValue(slice.branchName);
    if (!branch) continue;
    const prior = previousByBranch.get(branch) ?? {};
    previousByBranch.delete(branch);
    setPrRecord(recordsByBranch, branch, {
      ...prior,
      sliceId: stringValue(slice.id),
      displayName: stringValue(slice.displayName, stringValue(slice.id)),
      branch,
      title: stringValue(slice.title),
      scope: stringValue(slice.scope),
      files: asArray(slice.pathspecs).map((path) => stringValue(path)).filter(Boolean),
      status: stringValue(prior.status, "planned"),
    }, context);
  }

  for (const localRecord of localSplitSeriesRecords(repoRoot, baseRef, baseSha, context)) {
    const branch = stringValue(localRecord.branch);
    if (!branch) continue;
    const prior = previousByBranch.get(branch) ?? {};
    previousByBranch.delete(branch);
    setPrRecord(recordsByBranch, branch, {
      ...localRecord,
      ...prior,
      sourcePlan: {
        ...asObject(localRecord.sourcePlan),
        ...asObject(prior.sourcePlan),
      },
      local: {
        ...asObject(prior.local),
        ...asObject(localRecord.local),
      },
      validation: {
        ...asObject(localRecord.validation),
        ...asObject(prior.validation),
      },
      batch: {
        ...asObject(localRecord.batch),
        ...asObject(prior.batch),
      },
      files: asArray(prior.files).length > 0 ? asArray(prior.files) : asArray(localRecord.files),
      status: stringValue(prior.status, stringValue(localRecord.status, "planned")),
    }, context);
  }
  // A record whose slice vanished from the plan stays tracked once it has a
  // PR or points at local operator work. Merged work drops out of later plans,
  // and local split branches can exist without GitHub PRs yet; neither should
  // disappear from the board just because the active split-plan artifact moved.
  for (const leftover of previousByBranch.values()) {
    if (shouldKeepUnplannedPrRecord(leftover, repoRoot)) {
      const branch = stringValue(leftover.branch);
      if (branch) setPrRecord(recordsByBranch, branch, normalizePrRecord(leftover, context), context);
    }
  }

  const repoSlug = upstreamRepoSlug(repoRoot);
  let upstreamOpen: number | null = null;
  let warning = "";
  if (repoSlug) {
    const list = await runCli(
      ["gh", "pr", "list", "--repo", repoSlug, "--state", "all", "--limit", "100", "--json", "number,title,state,isDraft,url,headRefName,author,reviewDecision,updatedAt"],
      repoRoot,
    );
    if (list.exitCode === 0) {
      const pulls = (JSON.parse(list.stdout || "[]") as unknown[]).map(asObject);
      const byHead = new Map(pulls.map((pr) => [stringValue(pr.headRefName), pr]));
      const importHeads = new Set<string>();
      for (const pr of pulls) {
        const head = stringValue(pr.headRefName);
        if (!splitSeriesMatch(head)) continue;
        importHeads.add(head);
        if (!recordsByBranch.has(head)) {
          setPrRecord(recordsByBranch, head, {
            sliceId: head.replace(/^codex\/split-/, "split-"),
            displayName: splitSeriesTitle(head, 14),
            branch: head,
            title: stringValue(pr.title, splitSeriesTitle(head, 14)),
            scope: "split-series",
            status: prStatusFromGithub(pr),
            sourcePlan: {
              source: "github_import",
              importedAt: new Date().toISOString(),
            },
            local: {
              status: "remote_only",
              branch: head,
            },
          }, context);
        }
      }

      for (const branch of importHeads) {
        const record = recordsByBranch.get(branch);
        const pr = byHead.get(branch);
        if (!record || !pr) continue;
        recordsByBranch.set(branch, await hydratePrRecordFromGithub(record, pr, repoSlug, repoRoot));
      }

      for (const [branch, record] of [...recordsByBranch.entries()]) {
        if (importHeads.has(branch)) continue;
        const pr = byHead.get(branch);
        if (!pr) continue;
        recordsByBranch.set(branch, await hydratePrRecordFromGithub(record, pr, repoSlug, repoRoot));
      }

      const trackedHeads = new Set([...recordsByBranch.values()].map((record) => stringValue(record.branch)));
      upstreamOpen = pulls.filter((pr) => stringValue(pr.state).toUpperCase() === "OPEN" && !trackedHeads.has(stringValue(pr.headRefName))).length;
    } else {
      warning = `gh pr list failed (${list.exitCode}): ${outputTail(list.stderr, 300)}`;
    }
  } else {
    warning = "Could not derive the upstream repo from the origin remote.";
  }

  const records = [...recordsByBranch.values()].map((record) => normalizePrRecord(record)).sort(splitSeriesSort);
  const payload = writePrRecords(stateDir, { records, upstreamOpen, repo: repoSlug, syncedAt: new Date().toISOString(), ...(warning ? { warning } : {}) });
  appendLog("ui", `PR sync: ${records.length} tracked record(s)${Number.isFinite(Number(upstreamOpen)) ? `, ${upstreamOpen} other open upstream` : ""}${warning ? ` — ${warning}` : ""}`);
  return payload;
}

function pushTimeline(timeline: JsonObject[], item: JsonObject): void {
  const at = stringValue(item.at);
  if (!at) return;
  timeline.push(item);
}

function runTimeline(params: {
  reports: JsonObject[];
  events: JsonObject[];
  sessions: JsonObject[];
  directorCycles: JsonObject[];
  leases: JsonObject[];
}): JsonObject[] {
  const timeline: JsonObject[] = [];
  for (const report of params.reports) {
    const target = asObject(report.target);
    pushTimeline(timeline, {
      kind: "worker_report",
      at: report.createdAt,
      title: stringValue(target.symbol, stringValue(target.sourcePath, "worker report")),
      path: target.sourcePath,
      detail: `${stringValue(report.reportType)} / ${stringValue(report.workerId)}`,
      delta: numberValue(report.scoreDelta),
      exactMatches: reportHasExactAttempt(report)
        ? 1
        : reportPositiveAttempts(report).filter(
            (attempt) => numberValue(attempt.oldScore, NaN) < 99.99999 && numberValue(attempt.newScore, NaN) >= 99.99999,
          ).length,
      id: report.id,
    });
  }
  for (const event of params.events) {
    pushTimeline(timeline, {
      kind: "event",
      at: event.createdAt,
      title: stringValue(event.eventType),
      path: event.sourcePath,
      detail: `${stringValue(event.producer)} / ${event.handledAt ? "handled" : "open"}`,
      id: event.id,
    });
  }
  for (const session of params.sessions) {
    pushTimeline(timeline, {
      kind: "pi_session",
      at: session.createdAt,
      title: `${stringValue(session.role)} session`,
      detail: `${stringValue(session.status)} / ${stringValue(session.model)}`,
      id: session.id,
    });
  }
  for (const cycle of params.directorCycles) {
    pushTimeline(timeline, {
      kind: "legacy_scheduler_cycle",
      at: cycle.createdAt,
      title: "legacy scheduler cycle",
      detail: `${stringValue(cycle.triggerEvent)} / ${numberValue(cycle.activeWorkers)} active workers`,
      id: cycle.id,
    });
  }
  for (const lease of params.leases) {
    pushTimeline(timeline, {
      kind: "lease",
      at: lease.leasedAt || lease.heartbeatAt,
      title: stringValue(lease.symbol, stringValue(lease.sourcePath, "lease")),
      path: lease.sourcePath,
      detail: `${stringValue(lease.status)} / ${stringValue(lease.workerId)}`,
      id: lease.id,
    });
  }
  return timeline.sort((left, right) => timeMs(right.at) - timeMs(left.at));
}

// "2026-06-10T17-00-28-350Z" (filesystem-safe artifact stamp) -> ISO string.
function artifactDirTimestamp(name: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function curatorAgentRuns(stateDir: string): JsonObject[] {
  const curatorRoot = resolve(stateDir, "knowledge_curator");
  if (!existsSync(curatorRoot)) return [];
  try {
    return readdirSync(curatorRoot)
      .filter((name) => {
        try {
          return statSync(resolve(curatorRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((left, right) => right.localeCompare(left))
      .slice(0, 12)
      .map((name) => {
        const dirPath = resolve(curatorRoot, name);
        let outputPath = "";
        try {
          outputPath = readdirSync(dirPath).find((file) => file.endsWith(".txt")) ?? "";
        } catch {
          outputPath = "";
        }
        return {
          id: name,
          startedAt: artifactDirTimestamp(name),
          dir: dirPath,
          outputPath: outputPath ? resolve(dirPath, outputPath) : "",
        };
      });
  } catch {
    return [];
  }
}

function recentCuratedLessons(): JsonObject[] {
  const enrichmentPath = resolve(packageRoot, "knowledge/resource_graph/enrichments/knowledge_curator_updates.jsonl");
  return readJsonLines(enrichmentPath, 500)
    .map((record) => ({
      id: stringValue(record.id),
      kind: stringValue(record.kind),
      status: stringValue(record.status),
      title: stringValue(record.title),
      sourcePath: stringValue(record.source_path),
      trustTier: stringValue(record.trust_tier),
      confidence: numberValue(record.confidence, NaN),
      createdAt: stringValue(record.created_at),
    }))
    .sort((left, right) => stringValue(right.createdAt).localeCompare(stringValue(left.createdAt)))
    .slice(0, 24);
}

function mergedPrIntakeRows(graphDbPath: string): JsonObject[] {
  if (!graphDbPath || !existsSync(graphDbPath)) return [];
  try {
    const db = new Database(graphDbPath, { readonly: true });
    try {
      return (
        db
          .query("SELECT pr, merged_at, indexed_at, touched_files_json, graph_delta_json FROM merged_pr_updates ORDER BY indexed_at DESC LIMIT 12")
          .all() as JsonObject[]
      ).map((row) => {
        let touched: unknown[] = [];
        try {
          touched = asArray(JSON.parse(stringValue(row.touched_files_json, "[]")));
        } catch {
          touched = [];
        }
        const delta = readInlineJson(stringValue(row.graph_delta_json, "{}"));
        return {
          pr: numberValue(row.pr, NaN),
          mergedAt: stringValue(row.merged_at),
          indexedAt: stringValue(row.indexed_at),
          touchedFiles: touched.length,
          graphDelta: delta,
        };
      });
    } finally {
      db.close();
    }
  } catch (error) {
    appendLog("stderr", `merged PR intake read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function knowledgeIntakeSummary(stateDir: string, graphDbPath: string): JsonObject {
  return {
    curatorRuns: curatorAgentRuns(stateDir),
    recentLessons: recentCuratedLessons(),
    mergedPrUpdates: mergedPrIntakeRows(graphDbPath),
    enrichmentPath: resolve(packageRoot, "knowledge/resource_graph/enrichments/knowledge_curator_updates.jsonl"),
  };
}

function runDetails(stateDir: string, explicitRunId = "", project: ResolvedProject | null = null): JsonObject {
  const store = openState(stateDir);
  let status: JsonObject;
  let runId = explicitRunId;
  try {
    status = statusSnapshot(store);
    const run = asObject(status.run);
    if (!runId) runId = stringValue(run.id);
  } finally {
    store.db.close();
  }
  if (!runId) return { project: project ? projectToSummary(project) : null, stateDir, status, runId: "", summary: {}, timeline: [] };

  const reports = workerReports(stateDir, runId, 0);
  const events = eventsForRun(stateDir, runId, 0);
  const sessions = piSessionsForRun(stateDir, runId);
  const directorCycles = directorCyclesForRun(stateDir, runId);
  const leases = leasesForRun(stateDir, runId);
  const queueTargets = queueTargetsForRun(stateDir, runId);
  const improvements = improvementRowsFromReports(reports);
  const improvedFiles = fileImprovementRows(improvements);
  const timeline = runTimeline({ reports, events, sessions, directorCycles, leases });
  const exactMatches = improvements.reduce((sum, improvement) => sum + numberValue(improvement.exactMatches), 0);

  return {
    project: project ? projectToSummary(project) : null,
    stateDir,
    runId,
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      workerReports: reports.length,
      reportOutcomeCounts: reportOutcomeCounts(reports),
      positiveAttempts: improvements.reduce((sum, improvement) => sum + numberValue(improvement.attempts), 0),
      exactMatches,
      improvedFiles: improvedFiles.length,
      improvedSymbols: improvements.length,
      totalPositiveDelta: improvements.reduce((sum, improvement) => sum + numberValue(improvement.totalDelta), 0),
      events: events.length,
      piSessions: sessions.length,
      directorCycles: directorCycles.length,
      leases: leases.length,
      queueRows: queueTargets.length,
      targets: new Set(queueTargets.map((row) => stringValue(row.targetId)).filter(Boolean)).size,
    },
    reportTypes: countBy(reports, "reportType"),
    eventTypes: countBy(events, "eventType"),
    sessionRoles: countBy(sessions, "role"),
    sessionStatuses: countBy(sessions, "status"),
    leaseStatuses: countBy(leases, "status"),
    queueStatuses: countBy(queueTargets, "queueStatus"),
    targetStatuses: countBy(queueTargets, "targetStatus"),
    timeline,
    reports,
    events,
    sessions,
    directorCycles,
    leases,
    queueTargets,
    improvements,
    improvedFiles,
    knowledgeIntake: knowledgeIntakeSummary(stateDir, project?.graphDbPath ?? ""),
  };
}

function readInlineJson(textValue: string): JsonObject {
  try {
    return asObject(JSON.parse(textValue));
  } catch {
    return {};
  }
}

/**
 * Epoch checkpoints, oldest first: the run's measured progress history. Each
 * row is one drain-snapshot-rebuild cycle recorded by the epoch pipeline.
 */
function epochHistory(stateDir: string, limit = 48): JsonObject[] {
  const store = openState(stateDir);
  try {
    return listSavePoints(store, 500)
      .filter((savePoint) => savePoint.triggerKind === "epoch")
      .slice(0, limit)
      .reverse()
      .map((savePoint) => ({
        id: savePoint.id,
        runId: savePoint.runId,
        label: savePoint.label,
        createdAt: savePoint.createdAt,
        commitSha: savePoint.commitSha,
        matchedCodePercent: savePoint.matchedCodePercent,
        measures: compactMeasures(asObject(asObject(savePoint.payload).measures)),
        regressions: asObject(asObject(savePoint.payload).regressions),
        repair: asObject(asObject(savePoint.payload).repair),
      }));
  } catch {
    return [];
  } finally {
    store.db.close();
  }
}

// Keep in sync with the run-loop epoch checkpoint cadence:
// 4 full worker rotations per checkpoint.
const CHECKPOINT_ROTATIONS = 4;
const CHECKPOINT_FALLBACK_WORKERS = 32;

// A start event without a finish older than this is treated as abandoned
// (e.g. the process was killed mid-build) rather than still building.
const CHECKPOINT_BUILD_STALE_MS = 45 * 60_000;

/**
 * An epoch checkpoint build is in flight when the newest epoch_started event
 * has no newer epoch_finished, and started recently enough to be believable.
 */
function checkpointBuildState(stateDir: string, runId: string): { building: boolean; buildingSince: string | null } {
  const store = openState(stateDir);
  try {
    const row = store.db
      .query(
        `
          SELECT event_type, created_at FROM events
          WHERE run_id = ? AND event_type IN ('epoch_started', 'epoch_finished')
          ORDER BY created_at DESC LIMIT 1
        `,
      )
      .get(runId) as Record<string, unknown> | undefined;
    if (!row || stringValue(row.event_type) !== "epoch_started") return { building: false, buildingSince: null };
    const startedMs = Date.parse(stringValue(row.created_at));
    if (!Number.isFinite(startedMs) || Date.now() - startedMs > CHECKPOINT_BUILD_STALE_MS) return { building: false, buildingSince: null };
    return { building: true, buildingSince: stringValue(row.created_at) };
  } catch {
    return { building: false, buildingSince: null };
  } finally {
    store.db.close();
  }
}

/**
 * Countdown to the next epoch checkpoint: completed leases (any worker report
 * except provider_error) since the last epoch save point, against the lease
 * interval the pool checkpoints on.
 */
function checkpointProgressFor(stateDir: string, runId: string, epochs: JsonObject[], reports: JsonObject[], runCreatedAt: string, desiredWorkers: number): JsonObject {
  const workers = Number.isFinite(desiredWorkers) && desiredWorkers > 0 ? desiredWorkers : CHECKPOINT_FALLBACK_WORKERS;
  const interval = workers * CHECKPOINT_ROTATIONS;
  const lastEpochAt = epochs.length > 0 ? stringValue(epochs[epochs.length - 1].createdAt) : "";
  const since = lastEpochAt || runCreatedAt;
  const completions = reports.filter(
    (report) => stringValue(report.reportType) !== "provider_error" && stringValue(report.createdAt) > since,
  ).length;
  const build = checkpointBuildState(stateDir, runId);
  return {
    completionsSinceCheckpoint: completions,
    interval,
    remaining: Math.max(0, interval - completions),
    lastCheckpointAt: lastEpochAt || null,
    building: build.building,
    buildingSince: build.buildingSince,
  };
}

async function runDashboard(paths: DashboardProjectContext): Promise<JsonObject> {
  const { repoRoot, stateDir } = paths;
  const store = openState(stateDir);
  let status: JsonObject;
  let runId = "";
  let runCreatedAt = "";
  let runDesiredWorkers = 0;
  try {
    status = statusSnapshot(store);
    const run = asObject(status.run);
    runId = stringValue(run.id);
    runCreatedAt = stringValue(run.createdAt);
    runDesiredWorkers = numberValue(run.desiredWorkers, 0);
  } finally {
    store.db.close();
  }

  const initialSnapshot = runId ? latestInitialSnapshot(stateDir, runId) : {};
  let initialMeasures = compactMeasures(measuresFromSnapshot(initialSnapshot));
  const campaign = campaignStatus(repoRoot, stateDir, paths.project?.baseRef ?? "origin/master");
  const currentBoard = loadCurrentBoard(repoRoot, campaign);
  // With no run baseline, "start" is the campaign anchor: the last save point.
  // A future run measures forward from here, and until then the metric table
  // shows drift since the anchor instead of n/a.
  let initialSource: string | null = runId ? "run" : null;
  let initialGeneratedAt: unknown = initialSnapshot.generatedAt ?? null;
  if (!Object.values(initialMeasures).some((value) => Number.isFinite(Number(value)))) {
    const savePoint = asObject(campaign.savePoint);
    const savePointMeasures = asObject(asObject(savePoint.payload).measures);
    if (Object.keys(savePointMeasures).length > 0) {
      initialMeasures = compactMeasures(savePointMeasures);
      initialSource = "save_point";
      initialGeneratedAt = savePoint.createdAt ?? null;
    }
  }
  const reports = runId ? workerReports(stateDir, runId, 100) : [];
  const allReports = runId ? workerReports(stateDir, runId, 0) : [];
  const progressReports = reports.filter((report) => stringValue(report.reportType) === "progress" || stringValue(report.reportType) === "score_candidate");
  const improvements = improvementRowsFromReports(allReports);
  const improvedFiles = fileImprovementRows(improvements);
  const queueTargets = runId ? queueTargetsForRun(stateDir, runId) : [];
  const trustedReport = runScopedTrustedReport(repoRoot, (await loadTrustedReport(repoRoot, 0)) as unknown as JsonObject, runCreatedAt);
  const productionChanges = await refreshProductionChanges(repoRoot, stateDir);
  const productionReport = productionChanges
    ? ((await loadTrustedReportFile(productionChanges, "build/GALE01/report_changes_production.json", 0)) as unknown as JsonObject)
    : null;
  const checkpoint = runId ? checkpointForRun(stateDir, runId) : null;
  const handoff = runId ? handoffForRun(stateDir, runId, checkpoint) : { checkpoint: null, qa: null, splitPlan: null };
  const epochs = epochHistory(stateDir);

  return {
    project: paths.project ? projectToSummary(paths.project) : null,
    projectWarnings: paths.project?.warnings ?? [],
    repoRoot,
    stateDir,
    graphDbPath: paths.graphDbPath,
    usePathOverrides: paths.usePathOverrides,
    status,
    initial: {
      generatedAt: initialGeneratedAt,
      measures: initialMeasures,
      source: initialSource,
    },
    current: currentBoard,
    trustedReport,
    productionReport,
    checkpoint,
    handoff,
    runSummary: runSummary(status, allReports, initialMeasures, currentBoard.measures, improvements, trustedReport as unknown as JsonObject),
    improvements,
    improvedFiles,
    activeFiles: runId ? activeFilesForRun(stateDir, runId) : [],
    queueTargets,
    reports,
    progressReports,
    touchedFiles: touchedFilesFromReports(allReports),
    events: runId ? eventsForRun(stateDir, runId, 40) : [],
    process: processStatus(stateDir, paths.project),
    campaign,
    epochs,
    checkpointProgress: runId ? checkpointProgressFor(stateDir, runId, epochs, allReports, runCreatedAt, runDesiredWorkers) : null,
    prs: buildPrRecordsView(stateDir, runId),
  };
}

function processStatus(stateDir = defaultStateDir, project: ResolvedProject | null = null): JsonObject {
  return {
    project: project ? projectToSummary(project) : null,
    running: managed?.state === "running" || managed?.state === "stopping" || managed?.state === "draining",
    state: managed?.state ?? "idle",
    name: managed?.name ?? null,
    pid: managed?.pid ?? null,
    processGroup: managed?.pid ? -managed.pid : null,
    killCommand: managed?.pid ? `kill -TERM -${managed.pid}` : null,
    pidFilePath: managed?.pidFilePath ?? null,
    startedAt: managed?.startedAt ?? null,
    endedAt: managed?.endedAt ?? null,
    exitCode: managed?.exitCode ?? null,
    signal: managed?.signal ?? null,
    command: managed?.command ?? [],
    repoRoot: managed?.repoRoot ?? project?.repoRoot ?? null,
    stateDir: managed?.stateDir ?? stateDir,
    graphDbPath: managed?.graphDbPath ?? project?.graphDbPath ?? null,
    logs: processLogs.slice(-220),
    knownProcesses: savedProcessRecords(stateDir),
    freshRunActive,
    projectSyncActive,
    operation: operation ? (JSON.parse(JSON.stringify(operation)) as JsonObject) : null,
  };
}

function cliPrefix(paths: DashboardProjectContext): string[] {
  const command = ["bun", binPath];
  if (paths.project) command.push("--project", paths.project.projectId);
  command.push("--repo-root", paths.repoRoot, "--state-dir", paths.stateDir);
  return command;
}

function dashboardScheduling(maxWorkersValue: unknown): {
  candidateLimit: number;
  candidateWindow: number;
  epochReadyQueueSize: number;
  epochSize: string;
  fastKgMaintenanceIntervalMs: number;
  fastKgMaintenanceReportCount: number;
  maxWorkers: number;
  queueLowWatermark: number;
  queueTargetSize: number;
} {
  const maxWorkers = intValue(maxWorkersValue, 16, 1);
  const queueTargetSize = maxWorkers * 4;
  return {
    candidateLimit: queueTargetSize,
    candidateWindow: queueTargetSize,
    epochReadyQueueSize: queueTargetSize,
    epochSize: String(queueTargetSize),
    fastKgMaintenanceIntervalMs: 180_000,
    fastKgMaintenanceReportCount: Math.max(4, maxWorkers),
    maxWorkers,
    queueLowWatermark: maxWorkers,
    queueTargetSize,
  };
}

function noRefillBatchRun(stateDir: string, runId: string): boolean {
  if (!runId) return false;
  const store = openState(stateDir);
  try {
    return getRun(store, runId)?.goalKind === "never_run_sweep";
  } finally {
    store.db.close();
  }
}

function commandFromBody(body: JsonObject): { command: string[]; name: string; repoRoot: string; stateDir: string; graphDbPath: string; project: ResolvedProject | null; runId: string } {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { graphDbPath, project, repoRoot, stateDir } = paths;
  const runId = stringValue(body.runId) || latestRunId(stateDir);
  const name = processName(project?.processName ?? stringValue(body.processName, "melee-live"));
  const provider = stringValue(body.provider, "codex-lb");
  const model = stringValue(body.model, "gpt-5.5");
  const thinkingLevel = stringValue(body.thinkingLevel, "medium");
  const workerThinkingLevel = stringValue(body.workerThinkingLevel, "medium");
  const noRefillBatch = noRefillBatchRun(stateDir, runId);
  const normalScheduling = dashboardScheduling(body.maxWorkers);
  const maxWorkers = normalScheduling.maxWorkers;
  const candidateLimit = noRefillBatch ? 0 : normalScheduling.candidateLimit;
  const candidateWindow = noRefillBatch ? 0 : normalScheduling.candidateWindow;
  const queueLowWatermark = noRefillBatch ? 0 : normalScheduling.queueLowWatermark;
  const queueTargetSize = noRefillBatch ? 0 : normalScheduling.queueTargetSize;
  const epochSize = noRefillBatch ? "1" : stringValue(body.epochSize, String(project?.dashboard.epochSize ?? normalScheduling.epochSize));
  const epochReadyQueueSize = noRefillBatch ? 1 : intValue(body.epochReadyQueueSize, project?.dashboard.epochReadyQueueSize ?? normalScheduling.epochReadyQueueSize, 1);
  const fastKgMaintenanceEnabled = !noRefillBatch && body.fastKgMaintenanceEnabled !== false;
  const fastKgMaintenanceIntervalMs = intValue(
    body.fastKgMaintenanceIntervalMs,
    project?.dashboard.fastKgMaintenanceIntervalMs ?? normalScheduling.fastKgMaintenanceIntervalMs,
    0,
  );
  const fastKgMaintenanceReportCount = intValue(
    body.fastKgMaintenanceReportCount,
    project?.dashboard.fastKgMaintenanceReportCount ?? normalScheduling.fastKgMaintenanceReportCount,
    0,
  );
  const fullKgMaintenanceMode = stringValue(body.fullKgMaintenanceMode, project?.dashboard.fullKgMaintenanceMode ?? "full");
  const schedulableLowWatermark = noRefillBatch ? 0 : maxWorkers;
  const queueRefreshIntervalMs = noRefillBatch ? 0 : 60000;
  const idleSleepMs = intValue(body.idleSleepMs, 5000, 100);
  const agentTimeoutSeconds = numberValue(body.agentTimeoutSeconds, noRefillBatch ? 3000 : 0);
  const command = [
    ...cliPrefix(paths),
    "--provider",
    provider,
    "--model",
    model,
    "--thinking-level",
    thinkingLevel,
  ];
  if (boolValue(body.dryRunAgents)) command.push("--dry-run-agents");
  if (agentTimeoutSeconds > 0) command.push("--agent-timeout-seconds", String(Math.trunc(agentTimeoutSeconds)));
  command.push(
    "babysit",
    "--max-workers",
    String(maxWorkers),
    "--idle-sleep-ms",
    String(idleSleepMs),
    "--worker-thinking-level",
    workerThinkingLevel,
    "--candidate-limit",
    String(candidateLimit),
    "--queue-target-size",
    String(queueTargetSize),
    "--epoch-size",
    epochSize,
    "--epoch-ready-queue-size",
    String(epochReadyQueueSize),
    "--candidate-window",
    String(candidateWindow),
    "--queue-refresh-interval-ms",
    String(queueRefreshIntervalMs),
    "--queue-low-watermark",
    String(queueLowWatermark),
    "--schedulable-low-watermark",
    String(schedulableLowWatermark),
    "--graph-db",
    graphDbPath,
    "--fast-kg-maintenance-interval-ms",
    String(fastKgMaintenanceIntervalMs),
    "--fast-kg-maintenance-report-count",
    String(fastKgMaintenanceReportCount),
    "--full-kg-maintenance-mode",
    fullKgMaintenanceMode,
    "--force-recover-leases",
  );
  if (!fastKgMaintenanceEnabled) command.push("--no-fast-kg-maintenance");
  if (noRefillBatch) {
    command.push("--no-epoch-cycle", "--no-blocked-queue-replan", "--repair-attempts", "0", "--max-idle-iterations", "3");
  }
  if (runId) command.push("--run-id", runId);
  return { command, name, repoRoot, stateDir, graphDbPath, project, runId };
}

function spawnManaged(command: string[], stateDir: string, name: string, project: ResolvedProject | null): ManagedProcess {
  const child = spawn(command[0] ?? "bun", command.slice(1), {
    cwd: packageRoot,
    detached: true,
    env: process.env,
    argv0: `orch-${name}`,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid ?? 0;
  const proc: ManagedProcess = {
    child,
    command,
    graphDbPath: project?.graphDbPath,
    name,
    pid,
    pidFilePath: pidFilePath(stateDir, name),
    project: project ? projectToSummary(project) : null,
    repoRoot: project?.repoRoot,
    startedAt: new Date().toISOString(),
    state: "running",
    stateDir,
  };
  writeProcessFile(proc);
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => appendLog("stdout", String(chunk)));
  child.stderr?.on("data", (chunk) => appendLog("stderr", String(chunk)));
  child.on("exit", (code, signal) => {
    proc.state = "exited";
    proc.exitCode = code;
    proc.signal = signal;
    proc.endedAt = new Date().toISOString();
    writeProcessFile(proc);
    appendLog("ui", `process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  appendLog("ui", `started ${name} pid=${pid}: ${command.join(" ")}`);
  return proc;
}

async function runCli(command: string[], cwd = packageRoot): Promise<CliResult> {
  const child = spawn(command[0] ?? "bun", command.slice(1), {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    const value = String(chunk);
    stdoutChunks.push(value);
    appendLog("stdout", value);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    const value = String(chunk);
    stderrChunks.push(value);
    appendLog("stderr", value);
  });
  const exitCode = await new Promise<number | null>((resolveExit) => child.on("close", (code) => resolveExit(code)));
  return { exitCode, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
}

function outputTail(textValue: string, maxLength = 2000): string {
  if (textValue.length <= maxLength) return textValue;
  return `...${textValue.slice(textValue.length - maxLength)}`;
}

async function runGit(repoRoot: string, args: string[], options: { check?: boolean; failureHint?: string } = {}): Promise<CliResult> {
  const result = await runCli(["git", ...args], repoRoot);
  if (options.check !== false && result.exitCode !== 0) {
    throw new Error(`${options.failureHint ?? `git ${args.join(" ")} failed`} (${result.exitCode}): ${outputTail(result.stderr || result.stdout, 4000)}`);
  }
  return result;
}

function parseBaseRef(baseRef: string): { branch: string; remote: string } {
  const slash = baseRef.indexOf("/");
  if (slash <= 0 || slash === baseRef.length - 1) return { remote: "origin", branch: "master" };
  return { remote: baseRef.slice(0, slash), branch: baseRef.slice(slash + 1) };
}

function mergedPullRequestNumbers(logText: string): number[] {
  const numbers = new Set<number>();
  for (const match of logText.matchAll(/^Merge (?:pull request|PR) #(\d+)/gim)) {
    numbers.add(Number(match[1]));
  }
  // Squash-and-merge commits (doldecomp/melee's merge style) reference the PR
  // as a trailing "(#NNNN)" in the subject line instead of a merge commit.
  for (const match of logText.matchAll(/\(#(\d+)\)\s*$/gm)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers].filter(Number.isFinite).sort((a, b) => a - b);
}

async function syncProjectGitAndFindMergedPrs(paths: DashboardProjectContext): Promise<{ afterRef: string; beforeRef: string; branch: string; mergedPrs: number[]; steps: JsonObject[] }> {
  const baseRef = paths.project?.baseRef ?? "origin/master";
  const { branch: mainBranch, remote } = parseBaseRef(baseRef);
  const before = await runGit(paths.repoRoot, ["rev-parse", "--verify", baseRef], { check: false });
  const beforeRef = before.exitCode === 0 ? before.stdout.trim() : "";
  const steps: JsonObject[] = [
    {
      name: "read_previous_base_ref",
      command: ["git", "rev-parse", "--verify", baseRef],
      exitCode: before.exitCode,
      stdout: outputTail(before.stdout, 2000),
      stderr: outputTail(before.stderr, 2000),
    },
  ];

  appendLog("ui", `git fetch ${remote} started`);
  const fetch = await runGit(paths.repoRoot, ["fetch", "--prune", remote], { failureHint: `Unable to fetch ${remote}` });
  appendLog("ui", `git fetch ${remote} complete`);
  steps.push({ name: "git_fetch", command: ["git", "fetch", "--prune", remote], exitCode: fetch.exitCode, stdout: outputTail(fetch.stdout, 2000), stderr: outputTail(fetch.stderr, 2000) });

  const branchResult = await runGit(paths.repoRoot, ["branch", "--show-current"], { failureHint: "Unable to read current branch" });
  const branch = branchResult.stdout.trim();
  if (!branch) throw new Error("Cannot sync merged PR intake from a detached HEAD checkout.");

  // Skip the rebase when the branch already contains the base ref: a no-op
  // `rebase --autostash` still stashes the whole worktree, and a concurrent
  // git reader (dashboard polls) can hold index.lock at the moment the
  // autostash re-applies — git then keeps the stash and leaves the tree
  // clean, which silently empties the ship set downstream.
  const upToDate = branch !== mainBranch && (await runGit(paths.repoRoot, ["merge-base", "--is-ancestor", baseRef, "HEAD"], { check: false })).exitCode === 0;
  if (upToDate) {
    appendLog("ui", `branch ${branch} already contains ${baseRef}; rebase skipped`);
    steps.push({ name: "git_sync", command: ["git", "rebase", "--autostash", baseRef], exitCode: 0, stdout: `skipped — ${branch} already contains ${baseRef}`, stderr: "" });
  } else {
    const syncArgs = branch === mainBranch ? ["pull", "--ff-only", remote, mainBranch] : ["rebase", "--autostash", baseRef];
    const autostashCount = (): Promise<number> =>
      runGit(paths.repoRoot, ["stash", "list"], { check: false }).then((result) => result.stdout.split("\n").filter((line) => line.includes(": autostash")).length);
    const stashesBefore = await autostashCount();
    appendLog("ui", `git ${syncArgs.join(" ")} started`);
    const sync = await runGit(paths.repoRoot, syncArgs, { failureHint: `Unable to sync branch ${branch}` });
    appendLog("ui", `git ${syncArgs.join(" ")} complete`);
    steps.push({ name: "git_sync", command: ["git", ...syncArgs], exitCode: sync.exitCode, stdout: outputTail(sync.stdout, 2000), stderr: outputTail(sync.stderr, 2000) });

    // If the rebase finished but its autostash was not re-applied (lock race,
    // apply conflict), the worktree silently lost the uncommitted work. Try
    // to restore it; refuse to continue with a wiped tree.
    if ((await autostashCount()) > stashesBefore) {
      let restored = false;
      for (let attempt = 1; attempt <= 3 && !restored; attempt += 1) {
        const pop = await runGit(paths.repoRoot, ["stash", "pop"], { check: false });
        restored = pop.exitCode === 0;
        if (!restored) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
      }
      if (restored) {
        appendLog("ui", "rebase autostash was left behind; restored it with git stash pop");
      } else {
        throw new Error(`The rebase left uncommitted work in a stash and it could not be re-applied automatically. Run \`git stash pop\` in ${paths.repoRoot}, resolve any conflicts, then re-run Prepare Handoff.`);
      }
    }
  }

  const after = await runGit(paths.repoRoot, ["rev-parse", "--verify", baseRef], { failureHint: `Unable to read ${baseRef} after sync` });
  const afterRef = after.stdout.trim();
  if (!beforeRef || beforeRef === afterRef) {
    return { afterRef, beforeRef, branch, mergedPrs: [], steps };
  }

  const range = `${beforeRef}..${afterRef}`;
  const log = await runGit(paths.repoRoot, ["log", "--first-parent", "--format=%s%n%b", range], { failureHint: `Unable to inspect merged PRs in ${range}` });
  const mergedPrs = mergedPullRequestNumbers(log.stdout);
  appendLog("ui", mergedPrs.length ? `merged PRs newly landed: ${mergedPrs.map((number) => `#${number}`).join(", ")}` : "no merged PR numbers found in newly pulled commits");
  steps.push({ name: "discover_merged_prs", command: ["git", "log", "--first-parent", "--format=%s%n%b", range], exitCode: log.exitCode, stdout: outputTail(log.stdout, 4000), stderr: outputTail(log.stderr, 2000), mergedPrs });
  return { afterRef, beforeRef, branch, mergedPrs, steps };
}

function zeroTrustedCounts(): JsonObject {
  return {
    newMatches: 0,
    brokenMatches: 0,
    improvements: 0,
    fuzzyRegressions: 0,
    metricRegressions: 0,
    metricProgressions: 0,
  };
}

function staleTrustedReport(report: JsonObject, reason: string): JsonObject {
  return {
    ...report,
    status: "stale",
    staleReason: reason,
    counts: zeroTrustedCounts(),
    newMatches: [],
    brokenMatches: [],
    improvements: [],
    fuzzyRegressions: [],
    metricRegressions: [],
    metricProgressions: [],
  };
}

// Improvements are gains over the *production* baseline (upstream master, the
// floor PRs verify against), not the session baseline — New Session resets
// the session baseline to the current tree, which would otherwise make every
// carried local improvement vanish from the board. Diff the current report
// against the cached per-SHA production baseline report whenever the current
// report is newer than the last diff. objdiff-cli only joins two JSON files,
// so this is cheap; the in-flight guard keeps concurrent dashboard polls from
// stampeding it.
let productionChangesInFlight: Promise<void> | null = null;

async function refreshProductionChanges(repoRoot: string, stateDir: string): Promise<string | null> {
  const outPath = resolve(repoRoot, "build/GALE01/report_changes_production.json");
  const reportPath = resolve(repoRoot, "build/GALE01/report.json");
  const objdiffCli = resolve(repoRoot, "build/tools/objdiff-cli");
  const baselineStatus = readJsonObject(resolve(stateDir, "pr_handoff", "baseline_status.json"));
  const worktreeDir = stringValue(baselineStatus.worktreeDir);
  const productionBaseline = worktreeDir ? resolve(worktreeDir, "build/GALE01/baseline.json") : "";
  if (!productionBaseline || !existsSync(productionBaseline) || !existsSync(reportPath) || !existsSync(objdiffCli)) {
    return existsSync(outPath) ? outPath : null;
  }
  const sourceMs = Math.max(statSync(reportPath).mtime.getTime(), statSync(productionBaseline).mtime.getTime());
  if (existsSync(outPath) && statSync(outPath).mtime.getTime() >= sourceMs) return outPath;
  if (!productionChangesInFlight) {
    productionChangesInFlight = (async () => {
      const result = await runCli([objdiffCli, "report", "changes", "--format", "json-pretty", productionBaseline, reportPath, "-o", outPath], repoRoot);
      if (result.exitCode !== 0) {
        appendLog("stderr", `production changes diff failed (${result.exitCode}): ${outputTail(result.stderr || result.stdout, 1000)}`);
      }
    })().finally(() => {
      productionChangesInFlight = null;
    });
  }
  await productionChangesInFlight;
  return existsSync(outPath) ? outPath : null;
}

function runScopedTrustedReport(repoRoot: string, report: JsonObject, runCreatedAt: string): JsonObject {
  if (stringValue(report.status) !== "ready") return report;
  const reportMs = timeMs(report.generatedAt);
  const runMs = timeMs(runCreatedAt);
  const baselinePath = resolve(repoRoot, "build/GALE01/baseline.json");
  const baselineMs = existsSync(baselinePath) ? statSync(baselinePath).mtime.getTime() : 0;
  if (reportMs > 0 && runMs > 0 && reportMs < runMs) {
    return staleTrustedReport(report, "report_changes.json was generated before the current run");
  }
  if (reportMs > 0 && baselineMs > 0 && reportMs < baselineMs) {
    return staleTrustedReport(report, "report_changes.json is older than baseline.json");
  }
  return report;
}

function waitForExit(proc: ManagedProcess, timeoutMs: number): Promise<boolean> {
  if (proc.state === "exited") return Promise.resolve(true);
  return new Promise((resolveWait) => {
    const timeout = setTimeout(() => resolveWait(false), timeoutMs);
    proc.child.once("exit", () => {
      clearTimeout(timeout);
      resolveWait(true);
    });
  });
}

async function stopManaged(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  const runId = stringValue(body.runId) || latestRunId(stateDir);
  const name = processName(paths.project?.processName ?? stringValue(body.processName, "melee-live"));
  let stopped = false;

  if (managed && managed.state !== "exited") {
    managed.state = "stopping";
    writeProcessFile(managed);
    appendLog("ui", "stop requested");
    if (managed.pid) {
      try {
        process.kill(-managed.pid, "SIGTERM");
      } catch (error) {
        appendLog("stderr", `SIGTERM failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const graceful = await waitForExit(managed, 5000);
    if (!graceful && managed.pid) {
      try {
        process.kill(-managed.pid, "SIGKILL");
        appendLog("ui", "sent SIGKILL to process group");
      } catch (error) {
        appendLog("stderr", `SIGKILL failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await waitForExit(managed, 2000);
    }
    stopped = true;
  } else {
    const saved = savedProcessRecords(stateDir).find((record) => stringValue(record.name) === name);
    const pid = intValue(saved?.pid, 0, 0);
    if (!pid || saved?.alive !== true) return { stopped: false, reason: "not_running", process: processStatus(stateDir, paths.project) };
    updateSavedProcessFile(stateDir, name, { state: "stopping", pid });
    appendLog("ui", `stop requested for saved process ${name} pid=${pid}`);
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      appendLog("stderr", `SIGTERM failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let exited = await waitForProcessGroupExit(pid, 5000);
    let signal = "SIGTERM";
    if (!exited) {
      try {
        process.kill(-pid, "SIGKILL");
        appendLog("ui", `sent SIGKILL to saved process group ${pid}`);
      } catch (error) {
        appendLog("stderr", `SIGKILL failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      signal = "SIGKILL";
      exited = await waitForProcessGroupExit(pid, 2000);
    }
    updateSavedProcessFile(stateDir, name, {
      state: exited ? "exited" : "stopping",
      endedAt: exited ? new Date().toISOString() : null,
      signal,
    });
    stopped = true;
  }

  let recovery: JsonObject | null = null;
  if (runId && body.recoverLeases !== false) {
    const command = [
      ...cliPrefix(paths),
      "recover-leases",
      "--run-id",
      runId,
      "--force",
      "--reason",
      "ui stop requested",
    ];
    const result = await runCli(command);
    recovery = { command, ...result };
    appendLog("ui", `recover-leases exit=${result.exitCode}`);
  }
  return { stopped, recovery, process: processStatus(stateDir, paths.project) };
}

async function drainManaged(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const stateDir = paths.stateDir;
  const name = processName(paths.project?.processName ?? stringValue(body.processName, "melee-live"));
  const saved = savedProcessRecords(stateDir).find((record) => stringValue(record.name) === name);
  const pid = managed && managed.state !== "exited" ? managed.pid : intValue(saved?.pid, 0, 0);
  if (!pid || !processGroupAlive(pid)) return { draining: false, reason: "not_running", process: processStatus(stateDir, paths.project) };

  const children = directChildPids(pid);
  if (managed && managed.pid === pid && managed.state !== "exited") {
    managed.state = "draining";
    writeProcessFile(managed);
  } else {
    updateSavedProcessFile(stateDir, name, { state: "draining", pid, drainRequestedAt: new Date().toISOString() });
  }

  appendLog("ui", `drain requested for ${name} pid=${pid}`);
  const signaled: number[] = [];
  if (children.length > 0) {
    for (const childPid of children) {
      try {
        process.kill(childPid, "SIGTERM");
        signaled.push(childPid);
      } catch (error) {
        appendLog("stderr", `soft SIGTERM failed for child ${childPid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    try {
      process.kill(pid, "SIGTERM");
      signaled.push(pid);
    } catch (error) {
      appendLog("stderr", `soft SIGTERM failed for process ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (children.length > 0) {
    try {
      process.kill(pid, "SIGKILL");
      appendLog("ui", `stopped supervisor ${pid}; workers remain in process group to finish`);
    } catch (error) {
      appendLog("stderr", `supervisor stop failed for ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { draining: signaled.length > 0, signaled, process: processStatus(stateDir, paths.project) };
}

function latestRunId(stateDir: string): string {
  const store = openState(stateDir);
  try {
    return getLatestRun(store)?.id ?? "";
  } finally {
    store.db.close();
  }
}

function gitText(repoRoot: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function campaignDirtyPaths(statusShort: string): string[] {
  return statusShort
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const path = line.slice(3).trim().replace(/^"|"$/g, "");
      return path !== "decomp-orchestrator" && !path.startsWith("decomp-orchestrator/") && !path.startsWith(".decomp-orchestrator-state");
    });
}

let campaignCache: { key: string; at: number; value: JsonObject } | null = null;

function invalidateCampaignCache(): void {
  campaignCache = null;
}

const UPSTREAM_FETCH_INTERVAL_MS = 10 * 60 * 1000;
const upstreamFetches = new Map<string, { at: number; inFlight: boolean }>();

/**
 * Keep upstream refs fresh in the background so behindBase reflects what is
 * actually on the remote (newly merged PRs to intake), not the last manual
 * sync. Fires at most once per interval per repo/remote and never blocks the
 * dashboard request; returns the last completed fetch time, if any.
 */
function refreshUpstreamRefs(repoRoot: string, baseRef: string): number | null {
  const { remote } = parseBaseRef(baseRef);
  const key = `${repoRoot}\0${remote}`;
  const entry = upstreamFetches.get(key);
  const lastAt = entry?.at ?? 0;
  if (entry && (entry.inFlight || Date.now() - lastAt < UPSTREAM_FETCH_INTERVAL_MS)) return lastAt || null;
  upstreamFetches.set(key, { at: lastAt, inFlight: true });
  void runGit(repoRoot, ["fetch", "--prune", "--quiet", remote], { check: false })
    .then((result) => {
      if (result.exitCode === 0) {
        upstreamFetches.set(key, { at: Date.now(), inFlight: false });
        invalidateCampaignCache();
      } else {
        upstreamFetches.set(key, { at: lastAt, inFlight: false });
        appendLog("stderr", `background fetch ${remote} failed (${result.exitCode}): ${outputTail(result.stderr || result.stdout, 400)}`);
      }
    })
    .catch((error) => {
      upstreamFetches.set(key, { at: lastAt, inFlight: false });
      appendLog("stderr", `background fetch ${remote} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  return lastAt || null;
}

/**
 * Where-we-are summary for the canonical campaign: the latest save point plus
 * the current git position, so the dashboard can open from the save point and
 * flag staleness instead of showing a zeroed report.
 */
function campaignStatus(repoRoot: string, stateDir: string, baseRefFallback: string): JsonObject {
  const key = `${repoRoot}\0${stateDir}`;
  if (campaignCache && campaignCache.key === key && Date.now() - campaignCache.at < 10_000) return campaignCache.value;
  const store = openState(stateDir);
  let savePoint: ReturnType<typeof latestSavePoint> = null;
  try {
    savePoint = latestSavePoint(store);
  } finally {
    store.db.close();
  }
  const headSha = gitText(repoRoot, ["rev-parse", "HEAD"]);
  const branch = gitText(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirtyPaths = campaignDirtyPaths(gitText(repoRoot, ["status", "--short", "--ignore-submodules=all"]) ?? "");
  const baseRef = savePoint?.baseRef ?? baseRefFallback;
  const upstreamFetchedAt = refreshUpstreamRefs(repoRoot, baseRef);
  const aheadText = gitText(repoRoot, ["rev-list", "--count", `${baseRef}..HEAD`]);
  const behindText = gitText(repoRoot, ["rev-list", "--count", `HEAD..${baseRef}`]);
  const baseSha = gitText(repoRoot, ["rev-parse", "--verify", baseRef]);
  const dirty = dirtyPaths.length > 0;
  const value: JsonObject = {
    savePoint: savePoint as unknown as JsonObject | null,
    head: { sha: headSha, branch, dirty, dirtyPaths: dirtyPaths.slice(0, 20) },
    baseRef,
    baseSha,
    aheadOfBase: aheadText === null ? null : Number(aheadText),
    behindBase: behindText === null ? null : Number(behindText),
    upstreamFetchedAt: upstreamFetchedAt ? new Date(upstreamFetchedAt).toISOString() : null,
    stale: Boolean(savePoint) && (savePoint?.commitSha !== headSha || dirty),
  };
  campaignCache = { key, at: Date.now(), value };
  return value;
}

const SAVE_POINT_TRIGGERS = new Set(["manual", "init", "pause", "checkpoint", "qa", "ship", "sync", "fresh"]);

/** Best-effort save point at a phase boundary; failures log but never block the boundary action. */
async function boundarySavePoint(paths: DashboardProjectContext, trigger: string, label = ""): Promise<JsonObject | null> {
  try {
    const command = [...cliPrefix(paths), "save-point", "--trigger", trigger];
    if (label) command.push("--label", label);
    const result = await runCli(command);
    invalidateCampaignCache();
    if (result.exitCode !== 0) {
      appendLog("stderr", `save-point (${trigger}) failed (${result.exitCode}): ${outputTail(result.stderr || result.stdout, 800)}`);
      return null;
    }
    appendLog("ui", `save-point (${trigger}) recorded`);
    return parseCliJsonOutput(result.stdout);
  } catch (error) {
    appendLog("stderr", `save-point (${trigger}) failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function createSavePoint(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const trigger = stringValue(body.trigger, "manual");
  if (!SAVE_POINT_TRIGGERS.has(trigger)) throw new Error(`Unknown save-point trigger: ${trigger}`);
  const result = await boundarySavePoint(paths, trigger, stringValue(body.label));
  if (!result) throw new Error("save-point failed; see process logs");
  return result;
}

function initRunCommand(body: JsonObject): { command: string[]; repoRoot: string; stateDir: string; graphDbPath: string; project: ResolvedProject | null } {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { graphDbPath, project, repoRoot, stateDir } = paths;
  const { candidateLimit, maxWorkers } = dashboardScheduling(body.maxWorkers);
  const command = [
    ...cliPrefix(paths),
    ...(boolValue(body.dryRunAgents) ? ["--dry-run-agents"] : []),
    "init-run",
    "--desired-workers",
    String(maxWorkers),
    "--candidate-limit",
    String(candidateLimit),
    "--goal-kind",
    stringValue(body.goalKind, "matched_code_percent"),
    "--goal-value",
    String(project?.dashboard.goalValue ?? numberValue(body.goalValue, 100)),
    "--graph-db",
    graphDbPath,
  ];
  return { command, repoRoot, stateDir, graphDbPath, project };
}

async function initRun(body: JsonObject): Promise<JsonObject> {
  const init = initRunCommand(body);
  const { command } = init;
  appendLog("ui", `init-run started: ${command.join(" ")}`);
  const result = await runCli(command);
  appendLog("ui", `init-run exit=${result.exitCode}`);
  if (result.exitCode !== 0) {
    throw new Error(`init-run failed (${result.exitCode ?? "signal"}): ${result.stderr || result.stdout || "no output"}`);
  }
  const savePoint = await boundarySavePoint(resolveDashboardProject(body, { useDefaultProject: true }), "init");
  return {
    project: init.project ? projectToSummary(init.project) : null,
    command,
    parsed: parseCliJsonOutput(result.stdout),
    savePoint,
    ...result,
  };
}

async function runFreshStep(steps: FreshRunStep[], name: string, command: string[], cwd: string): Promise<void> {
  appendLog("ui", `${name} started: ${command.join(" ")}`);
  const result = await runCli(command, cwd);
  appendLog("ui", `${name} exit=${result.exitCode}`);
  const step = {
    name,
    command,
    cwd,
    exitCode: result.exitCode,
    stdout: outputTail(result.stdout, 4000),
    stderr: outputTail(result.stderr, 4000),
  };
  steps.push(step);
  if (result.exitCode !== 0) {
    throw new Error(`${name} failed (${result.exitCode ?? "signal"}): ${outputTail(result.stderr || result.stdout || "no output")}`);
  }
}

function compactReportRunResult(result: ReportRunResult): JsonObject {
  return {
    baselinePath: result.baselinePath,
    reportChangesPath: result.reportChangesPath,
    reportPath: result.reportPath,
    resetBaseline: result.resetBaseline,
    timestamps: result.timestamps,
    steps: result.steps.map((step) => ({
      name: step.name,
      command: step.command,
      exitCode: step.exitCode,
      stdout: outputTail(step.stdout, 1000),
      stderr: outputTail(step.stderr, 1000),
    })),
  };
}

function compactCheckpointResult(result: ReturnType<typeof createRunCheckpoint>): JsonObject {
  const compactItem = (item: (typeof result.items)[number]): JsonObject => ({
    reportId: item.reportId,
    symbol: item.symbol,
    sourcePath: item.sourcePath,
    patchPath: item.patchPath || null,
  });
  return {
    checkpoint: result.checkpoint,
    counts: result.counts,
    prCandidates: result.items.filter((item) => item.disposition === "pr_candidate").map(compactItem),
    improvementCandidates: result.items.filter((item) => item.disposition === "improvement_candidate").map(compactItem),
    carryForwardCount: result.items.filter((item) => !shipsInPr(item.disposition)).length,
  };
}

function parseCliJsonOutput(stdout: string): JsonObject {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try {
    return asObject(JSON.parse(trimmed));
  } catch {
    return {};
  }
}

function activeRunIdFromBody(body: JsonObject, stateDir: string): string {
  const runId = stringValue(body.runId) || latestRunId(stateDir);
  if (!runId) throw new Error("No run found. Run init-run first.");
  return runId;
}

function prGroupMode(value: unknown): string {
  const groupMode = stringValue(value, "melee-subsystem");
  return groupMode === "top-dir" ? groupMode : "melee-subsystem";
}

function prSplitStrategy(value: unknown): string {
  const strategy = stringValue(value, "deterministic");
  return strategy === "agent" ? strategy : "deterministic";
}

function prHandoffRoot(stateDir: string, runId: string, kind: string): string {
  return resolve(stateDir, "pr_handoff", runId, kind, artifactTimestamp());
}

// PR handoff steps read and build against the checkout, so they refuse to run
// while a worker process is alive — drain or stop it first. Pause/resume stay
// allowed because pausing is how the operator stops intake in the first place.
function assertHandoffIdle(stateDir: string, action: string): void {
  const activeManaged = managed?.state === "running" || managed?.state === "stopping" || managed?.state === "draining";
  const activeSaved = savedProcessRecords(stateDir).find((record) => record.alive === true);
  if (activeManaged || activeSaved) {
    const name = stringValue(activeSaved?.name, managed?.name ?? "managed process");
    throw new Error(`${action} requires stopped workers. Stop or drain the active process (${name}) first.`);
  }
}

async function pauseRunForPr(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  const drain = await drainManaged({ ...body, repoRoot, stateDir, runId });
  const store = openState(stateDir);
  let run: ReturnType<typeof updateRunStatus>;
  try {
    run = updateRunStatus(store, runId, "paused", "ui");
    appendLog("ui", `run ${runId} paused for PR handoff`);
  } finally {
    store.db.close();
  }
  const savePoint = await boundarySavePoint(paths, "pause");
  return { paused: true, project: paths.project ? projectToSummary(paths.project) : null, repoRoot, stateDir, run, drain, savePoint };
}

function resumeRunForPr(body: JsonObject): JsonObject {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  const store = openState(stateDir);
  try {
    const run = updateRunStatus(store, runId, "active", "ui");
    appendLog("ui", `run ${runId} resumed after PR handoff pause`);
    return { resumed: true, project: paths.project ? projectToSummary(paths.project) : null, repoRoot, stateDir, run };
  } finally {
    store.db.close();
  }
}

async function checkpointRunForPr(body: JsonObject, reworkSymbols: string[] = []): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const stateDir = paths.stateDir;
  const runId = activeRunIdFromBody(body, stateDir);
  assertHandoffIdle(stateDir, "Checkpoint");
  return withOperation("checkpoint", "Checkpoint", ["checkpoint"], async () => {
    operationStep("checkpoint", `run ${runId}`);
    appendLog("ui", `PR checkpoint started for run ${runId}`);
    const store = openState(stateDir);
    let result: JsonObject;
    try {
      result = compactCheckpointResult(
        createRunCheckpoint(store, runId, {
          improvementPromotion: {
            minGainPoints: paths.project?.pr.improvementMinGainPoints,
            minMatchedBytes: paths.project?.pr.improvementMinMatchedBytes,
          },
          reworkSymbols,
          title: "PR handoff checkpoint",
        }),
      );
      appendLog("ui", `PR checkpoint complete for run ${runId}`);
    } finally {
      store.db.close();
    }
    const savePoint = await boundarySavePoint(paths, "checkpoint");
    return { project: paths.project ? projectToSummary(paths.project) : null, ...result, savePoint };
  });
}

async function runPrQa(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  assertHandoffIdle(stateDir, "PR QA");
  const target = stringValue(body.qaTarget, paths.project?.validation.qaTarget ?? "changes_all").trim() || "changes_all";
  if (target.startsWith("-") || /\s/.test(target)) throw new Error("QA target must be one Ninja target name.");
  const command = [
    ...cliPrefix(paths),
    "regression-check",
    "--run-id",
    runId,
    "--target",
    target,
    "--report-title",
    stringValue(body.qaReportTitle, "Report for GALE01 PR handoff"),
    "--report-max-rows",
    String(intValue(body.qaReportMaxRows, 300, 0)),
  ];
  // Matches-only shipping: fuzzy-only evidence never promotes, so the
  // promotion gate stays at its default (exact match or matched-byte
  // movement required).
  if (body.requirePrPromotion !== false) command.push("--require-pr-promotion");
  return withOperation("qa", "QA Gate", ["QA build & regression gate"], async () => {
    operationStep("QA build & regression gate", `ninja ${target} + saved-baseline regression check`);
    appendLog("ui", `PR QA started: ${command.join(" ")}`);
    const result = await runCli(command);
    appendLog("ui", `PR QA exit=${result.exitCode}`);
    const parsed = parseCliJsonOutput(result.stdout);
    const latest = latestRegressionCheckSummary(stateDir, runId) ?? {};
    const merged = { ...latest, ...parsed };
    const promotion = asObject(merged.prPromotion);
    const evidence = asObject(promotion.evidence);
    const verdictParts = [`verdict ${stringValue(promotion.status, stringValue(merged.status, "unknown"))}`];
    if (Object.keys(evidence).length > 0) {
      verdictParts.push(
        `${numberValue(evidence.newMatches)} new match(es)`,
        `${numberValue(evidence.matchedCodeBytesDelta)}B matched code`,
        `${numberValue(evidence.unmatchedImprovementBytes)}B fuzzy improvement`,
      );
    }
    operationStepDetail("QA build & regression gate", verdictParts.join(" · "));
    const savePoint = await boundarySavePoint(paths, "qa");
    return {
      ...merged,
      savePoint,
      uiCommand: command,
      cliExitCode: result.exitCode,
      stdout: outputTail(result.stdout, 4000),
      stderr: outputTail(result.stderr, 4000),
    };
  });
}

async function runReconcile(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  const mode = stringValue(body.mode, "ship-validate") === "sync-merge" ? "sync-merge" : "ship-validate";
  const store = openState(stateDir);
  try {
    const run = getRun(store, runId);
    if (run && run.status === "active") {
      throw new Error(`Run ${run.id} is active. The reconcile agent only runs while scheduling is locked — pause intake first.`);
    }
  } finally {
    store.db.close();
  }
  const command = [
    ...cliPrefix(paths),
    ...(boolValue(body.dryRunAgents) ? ["--dry-run-agents"] : []),
    "reconcile",
    "--mode",
    mode,
    "--run-id",
    runId,
    "--base-ref",
    stringValue(body.prBaseRef, paths.project?.baseRef ?? "origin/master"),
    "--attempt-budget",
    String(intValue(body.reconcileAttemptBudget, 3, 1)),
  ];
  if (mode === "ship-validate" && body.allowMissingRegressionCheck === true) command.push("--allow-missing-regression-check");
  return withOperation("reconcile", "Reconcile", ["reconcile regressions"], async () => {
    operationStep("reconcile regressions", `${mode} agent fix loop`);
    appendLog("ui", `reconcile (${mode}) started: ${command.join(" ")}`);
    const result = await runCli(command);
    appendLog("ui", `reconcile (${mode}) exit=${result.exitCode}`);
    return {
      mode,
      parsed: parseCliJsonOutput(result.stdout),
      uiCommand: command,
      cliExitCode: result.exitCode,
      stdout: outputTail(result.stdout, 4000),
      stderr: outputTail(result.stderr, 4000),
    };
  });
}

async function runQaRepairForPr(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  assertHandoffIdle(stateDir, "QA repair");
  let checkpointPath = "";
  const checkpointStore = openState(stateDir);
  try {
    checkpointPath = stringValue(latestCheckpointSummary(checkpointStore, runId)?.summaryPath);
  } finally {
    checkpointStore.db.close();
  }
  const command = [
    ...cliPrefix(paths),
    ...(boolValue(body.dryRunAgents) ? ["--dry-run-agents"] : []),
    "qa-repair",
    "--run-id",
    runId,
    "--base-ref",
    stringValue(body.prBaseRef, paths.project?.baseRef ?? "origin/master").trim() || "origin/master",
  ];
  if (checkpointPath && existsSync(checkpointPath)) command.push("--checkpoint", checkpointPath);
  else command.push("--all-scan-files");
  if (body.qaRepairRunAgents !== false) command.push("--run-agents");
  const maxItems = intValue(body.qaRepairMaxItems, 0, 0);
  if (maxItems > 0) command.push("--max-items", String(maxItems));
  return withOperation("qa-repair", "QA Repair", ["QA repair lane"], async () => {
    operationStep("QA repair lane", checkpointPath ? "candidate-file scan and repair queue" : "scan replay/candidate fallback");
    appendLog("ui", `QA repair started: ${command.join(" ")}`);
    const result = await runCli(command);
    appendLog("ui", `QA repair exit=${result.exitCode}`);
    const parsed = parseCliJsonOutput(result.stdout);
    const latest = latestQaRepairSummary(stateDir, runId) ?? {};
    const merged = { ...latest, ...parsed };
    const counts = asObject(merged.counts);
    operationStepDetail(
      "QA repair lane",
      `${numberValue(counts.files_with_errors)} file(s) with errors; ${numberValue(counts.queued_items)} repair item(s); ${stringValue(merged.recommendation, "unknown")}`,
    );
    return {
      ...merged,
      project: paths.project ? projectToSummary(paths.project) : null,
      runId,
      checkpointPath: checkpointPath || null,
      uiCommand: command,
      cliExitCode: result.exitCode,
      stdout: outputTail(result.stdout, 4000),
      stderr: outputTail(result.stderr, 4000),
    };
  });
}

async function runPrSplitPlan(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { stateDir } = paths;
  const runId = activeRunIdFromBody(body, stateDir);
  assertHandoffIdle(stateDir, "PR split planning");
  const artifactDir = prHandoffRoot(stateDir, runId, "split_plans");
  const outputPath = resolve(artifactDir, "pr_split_plan.md");
  const summaryPath = resolve(artifactDir, "summary.json");
  mkdirSync(artifactDir, { recursive: true });
  let checkpointPath = "";
  const checkpointStore = openState(stateDir);
  try {
    checkpointPath = stringValue(latestCheckpointSummary(checkpointStore, runId)?.summaryPath);
  } finally {
    checkpointStore.db.close();
  }
  const command = [
    ...cliPrefix(paths),
    "pr-split-plan",
    "--base-ref",
    stringValue(body.prBaseRef, paths.project?.baseRef ?? "origin/master").trim() || "origin/master",
    "--group-mode",
    prGroupMode(stringValue(body.prGroupMode, paths.project?.pr.groupMode ?? "melee-subsystem")),
    "--strategy",
    prSplitStrategy(stringValue(body.prSplitStrategy, paths.project?.pr.splitStrategy ?? "deterministic")),
    "--max-files-per-pr",
    String(intValue(body.prMaxFilesPerPr, paths.project?.pr.maxFilesPerPr ?? 30, 1)),
    "--branch-prefix",
    stringValue(body.prBranchPrefix, paths.project?.pr.branchPrefix ?? "pr-split").trim() || "pr-split",
    "--title-prefix",
    stringValue(body.prTitlePrefix, paths.project?.pr.titlePrefix ?? "Melee decomp"),
    "--output",
    outputPath,
    "--agent-output-dir",
    resolve(artifactDir, "splitter_agent"),
    "--run-id",
    runId,
    "--json",
  ];
  if (checkpointPath && existsSync(checkpointPath)) command.push("--checkpoint", checkpointPath);
  const reportChangesRelative = paths.project?.validation.reportChangesPath ?? "build/GALE01/report_changes.json";
  if (existsSync(resolve(paths.repoRoot, reportChangesRelative))) command.push("--report-changes", reportChangesRelative);
  // Set by the prepare pipeline's post-verification replan: restrict match
  // slices to the files that survived ship-set verification.
  const shipStatusPath = stringValue(body.prShipStatusPath);
  if (shipStatusPath && existsSync(shipStatusPath)) command.push("--ship-status", shipStatusPath);
  if (boolValue(body.prCommittedOnly)) command.push("--committed-only");
  if (body.prIncludeUntracked === false) command.push("--no-untracked");
  return withOperation("split-plan", "Plan PRs", ["plan PR slices"], async () => {
    operationStep("plan PR slices", checkpointPath ? "lane-aware (latest checkpoint)" : "no checkpoint; lane-less plan");
    appendLog("ui", `PR split plan started: ${command.join(" ")}`);
    const result = await runCli(command);
    appendLog("ui", `PR split plan exit=${result.exitCode}`);
    const plan = parseCliJsonOutput(result.stdout);
    const slices = (Array.isArray(plan.slices) ? plan.slices : []).map(asObject);
    if (result.exitCode === 0) {
      operationStepDetail(
        "plan PR slices",
        `${slices.filter((slice) => slice.lane === "match").length} match PR(s) · ${slices.filter((slice) => slice.lane === "local").length} local-only slice(s)`,
      );
    }
    const summary = {
      status: result.exitCode === 0 ? "passed" : "failed",
      totalFiles: numberValue(plan.totalFiles, 0),
      sliceCount: slices.length,
      shipFilterApplied: boolValue(plan.shipFilterApplied),
      planningStrategy: stringValue(plan.planningStrategy, "deterministic"),
      splitterApplied: boolValue(plan.splitterApplied),
      splitterArtifacts: asObject(plan.splitterArtifacts),
      matchSlices: slices.filter((slice) => slice.lane === "match").length,
      localSlices: slices.filter((slice) => slice.lane === "local").length,
      unassignedSlices: slices.filter((slice) => !slice.lane).length,
      matchPathspecs: [
        ...new Set(
          slices
            .filter((slice) => slice.lane === "match")
            .flatMap((slice) => (Array.isArray(slice.pathspecs) ? slice.pathspecs : []))
            .map((path) => stringValue(path))
            .filter(Boolean),
        ),
      ],
      // Per-slice detail so PR tracking can seed records (branch, title,
      // files) without reparsing the rendered plan.
      slices: slices.map((slice) => ({
        id: stringValue(slice.id),
        displayName: stringValue(slice.displayName),
        lane: slice.lane ?? null,
        scope: stringValue(slice.scope),
        branchName: stringValue(slice.branchName),
        title: stringValue(slice.title),
        pathspecs: asArray(slice.pathspecs).map((path) => stringValue(path)).filter(Boolean),
        fileCount: numberValue(slice.fileCount),
      })),
      runId,
    project: paths.project ? projectToSummary(paths.project) : null,
    repoRoot: paths.repoRoot,
    stateDir,
    artifactDir,
    outputPath,
    summaryPath,
    checkpointPath: checkpointPath || null,
    baseRef: stringValue(body.prBaseRef, paths.project?.baseRef ?? "origin/master").trim() || "origin/master",
    groupMode: prGroupMode(stringValue(body.prGroupMode, paths.project?.pr.groupMode ?? "melee-subsystem")),
    requestedPlanningStrategy: prSplitStrategy(stringValue(body.prSplitStrategy, paths.project?.pr.splitStrategy ?? "deterministic")),
    maxFilesPerPr: intValue(body.prMaxFilesPerPr, paths.project?.pr.maxFilesPerPr ?? 30, 1),
    command,
    exitCode: result.exitCode,
    stdout: outputTail(result.stdout, 4000),
    stderr: outputTail(result.stderr, 4000),
    createdAt: new Date().toISOString(),
    };
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    return summary;
  });
}

/**
 * Rebuild the production baseline from the current base ref: a detached
 * worktree at the base SHA builds `ninja baseline`, cached per SHA (same
 * /tmp layout as the melee-pr-workflow skill so manual and UI runs share the
 * cache), and the resulting baseline.json is copied into the checkout. This
 * is what current changes are compared against — upstream as merged, without
 * any local work.
 */
function linkMissingFiles(sourceDir: string, targetDir: string): number {
  let linked = 0;
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = resolve(sourceDir, entry);
    const targetPath = resolve(targetDir, entry);
    if (statSync(sourcePath).isDirectory()) {
      linked += linkMissingFiles(sourcePath, targetPath);
    } else if (!existsSync(targetPath)) {
      symlinkSync(sourcePath, targetPath);
      linked += 1;
    }
  }
  return linked;
}

async function rebuildProductionBaseline(paths: DashboardProjectContext): Promise<JsonObject> {
  const { repoRoot } = paths;
  const baseRef = paths.project?.baseRef ?? "origin/master";
  const baseSha = (await runGit(repoRoot, ["rev-parse", "--verify", baseRef], { failureHint: `Unable to resolve ${baseRef}` })).stdout.trim();
  const worktreeDir = resolve(tmpdir(), `melee-baseline-${baseSha}`);
  const worktreeBaseline = resolve(worktreeDir, "build/GALE01/baseline.json");
  const cached = existsSync(worktreeBaseline);
  if (!cached) {
    if (!existsSync(worktreeDir)) {
      appendLog("ui", `baseline worktree add ${worktreeDir} @ ${baseSha.slice(0, 10)}`);
      await runGit(repoRoot, ["worktree", "add", "--detach", worktreeDir, baseSha], { failureHint: "Unable to add the baseline worktree" });
    }
    // Original game assets under orig/ are gitignored (only .gitkeep skeleton
    // dirs are tracked), so a fresh worktree cannot split the DOL. Symlink
    // every asset file the main checkout has that the worktree lacks.
    const origSource = resolve(repoRoot, "orig");
    if (existsSync(origSource)) {
      const linked = linkMissingFiles(origSource, resolve(worktreeDir, "orig"));
      if (linked > 0) appendLog("ui", `baseline worktree linked ${linked} orig/ game asset file(s) from the main checkout`);
    }
    if (!existsSync(resolve(worktreeDir, "build.ninja"))) {
      appendLog("ui", "baseline configure started");
      const configure = await runCli(["python3", "configure.py"], worktreeDir);
      if (configure.exitCode !== 0) {
        throw new Error(`Baseline configure failed (${configure.exitCode}): ${outputTail(configure.stderr || configure.stdout, 4000)}`);
      }
    }
    appendLog("ui", `baseline build started: ninja baseline @ ${baseSha.slice(0, 10)} (first build for this base SHA does a full build)`);
    const build = await runCli(["ninja", "baseline"], worktreeDir);
    if (build.exitCode !== 0) {
      throw new Error(`Baseline build failed (${build.exitCode}): ${outputTail(build.stderr || build.stdout, 4000)}`);
    }
    appendLog("ui", "baseline build complete");
  } else {
    appendLog("ui", `baseline reused from cache for ${baseSha.slice(0, 10)}`);
  }
  const baselinePath = resolve(repoRoot, "build/GALE01/baseline.json");
  mkdirSync(dirname(baselinePath), { recursive: true });
  copyFileSync(worktreeBaseline, baselinePath);
  appendLog("ui", `production baseline installed at ${baselinePath}`);
  const status = { baseRef, baseSha, worktreeDir, cached, baselinePath, installedAt: new Date().toISOString() };
  const statusPath = resolve(paths.stateDir, "pr_handoff", "baseline_status.json");
  mkdirSync(dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
  return status as unknown as JsonObject;
}

async function ensureOpenPrBaseline(paths: DashboardProjectContext): Promise<JsonObject> {
  const baseRef = paths.project?.baseRef ?? "origin/master";
  const baseSha = (await runGit(paths.repoRoot, ["rev-parse", "--verify", baseRef], { failureHint: `Unable to resolve ${baseRef}` })).stdout.trim();
  const status = readJsonObject(resolve(paths.stateDir, "pr_handoff", "baseline_status.json"));
  const worktreeDir = stringValue(status.worktreeDir);
  const baselinePath = worktreeDir ? resolve(worktreeDir, "build/GALE01/baseline.json") : "";
  if (stringValue(status.baseSha) === baseSha && worktreeDir && existsSync(baselinePath)) return status;

  const reason =
    stringValue(status.baseSha) && stringValue(status.baseSha) !== baseSha
      ? `baseline cache is stale (${stringValue(status.baseSha).slice(0, 10)} != ${baseSha.slice(0, 10)})`
      : worktreeDir && !existsSync(baselinePath)
        ? `baseline cache is missing at ${worktreeDir}`
        : "baseline cache is missing";
  appendLog("ui", `open draft: ${reason}; rebuilding production baseline`);
  return rebuildProductionBaseline(paths);
}

// Parsed branch-vs-baseline report; the source for both rework
// reclassification and the repair requeue.
async function regressionReportFromChanges(repoRoot: string): Promise<RegressionReport | null> {
  const reportChangesPath = resolve(repoRoot, "build/GALE01/report_changes.json");
  if (!existsSync(reportChangesPath)) return null;
  try {
    return await readRegressionReport(reportChangesPath, "prepare handoff", 0);
  } catch (error) {
    appendLog("stderr", `regression report parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Verify exactly what would ship: apply the match-lane diff (worktree vs the
 * base SHA, so uncommitted work counts) onto the cached baseline worktree,
 * rebuild incrementally, and run the regression report there. The branch can
 * be messy with local-only work — the PR gate is whether the assembled ship
 * set is clean against the production baseline. The worktree is reset
 * afterwards so the per-SHA baseline cache stays valid.
 */
async function verifyShipSet(paths: DashboardProjectContext, baseline: JsonObject, matchPathspecs: string[]): Promise<JsonObject> {
  const { repoRoot, stateDir } = paths;
  const worktreeDir = stringValue(baseline.worktreeDir);
  const baseSha = stringValue(baseline.baseSha);
  const statusPath = resolve(stateDir, "pr_handoff", "ship_status.json");
  const writeStatus = (status: JsonObject): JsonObject => {
    mkdirSync(dirname(statusPath), { recursive: true });
    writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
    return status;
  };
  if (!worktreeDir || !baseSha || !existsSync(worktreeDir)) {
    throw new Error("Ship-set verification needs the baseline worktree; run the rebuild-production-baseline step first.");
  }
  if (matchPathspecs.length === 0) {
    return writeStatus({ status: "nothing_to_ship", baseSha, files: 0, checkedAt: new Date().toISOString() });
  }

  // A metric regression names a unit ("main/melee/mp/mplib::.sdata2"); map it
  // back to the source file that ships so the offender can be dropped.
  const sourcePathFromUnit = (name: string): string => {
    const unit = name.split("::")[0] ?? "";
    const parts = unit.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return `src/${parts.slice(1).join("/")}.c`;
  };

  const patchPath = resolve(stateDir, "pr_handoff", "ship_set.patch");
  mkdirSync(dirname(patchPath), { recursive: true });
  let pathspecs = [...matchPathspecs];
  const droppedFiles = new Map<string, string[]>();

  // Survivor loop: anything that regresses the baseline drops out of the ship
  // set and the remainder re-verifies, until the assembly is clean. Dropped
  // symbols are already requeued as rework by the branch QA pass.
  for (let round = 1; round <= 4; round += 1) {
    if (pathspecs.length === 0) {
      return writeStatus({ status: "nothing_to_ship", baseSha, files: 0, droppedFiles: Object.fromEntries(droppedFiles), checkedAt: new Date().toISOString() });
    }
    const diff = await runCli(["git", "diff", "--binary", baseSha, "--", ...pathspecs], repoRoot);
    if (diff.exitCode !== 0) throw new Error(`Ship-set diff failed (${diff.exitCode}): ${outputTail(diff.stderr, 2000)}`);
    writeFileSync(patchPath, diff.stdout, "utf8");

    let report: RegressionReport;
    let issues: CodeIssuesResult;
    try {
      appendLog("ui", `ship-set round ${round}: applying ${pathspecs.length} match file(s) onto the baseline worktree`);
      const apply = await runCli(["git", "apply", patchPath], worktreeDir);
      if (apply.exitCode !== 0) throw new Error(`Ship-set patch did not apply cleanly (${apply.exitCode}): ${outputTail(apply.stderr, 2000)}`);
      const build = await runCli(["ninja", "changes_all"], worktreeDir);
      if (build.exitCode !== 0) throw new Error(`Ship-set build failed (${build.exitCode}): ${outputTail(build.stderr || build.stdout, 4000)}`);
      report = await readRegressionReport(resolve(worktreeDir, "build/GALE01/report_changes.json"), "ship set", 0);
      // Upstream CI parity: the patched tree must also pass the Issues lint.
      issues = await checkCodeIssues(worktreeDir);
      if (issues.status === "unavailable") appendLog("ui", `ship-set round ${round}: code-issues check skipped — ${outputTail(issues.output, 300)}`);
      if (issues.status === "issues") appendLog("ui", `ship-set round ${round}: code issues in ${issues.files.join(", ") || "(unattributed)"}\n${outputTail(issues.output, 2000)}`);
    } finally {
      // Restore the cached worktree to its pristine base state for reuse.
      await runCli(["git", "reset", "--hard", baseSha], worktreeDir);
      await runCli(["git", "clean", "-fd", "--", "src", "include", "config"], worktreeDir);
    }

    const clean =
      report.regressions.length === 0 && report.brokenMatches.length === 0 && report.fuzzyRegressions.length === 0 && issues.status !== "issues";
    if (clean) {
      const status = {
        status: report.newMatches.length > 0 ? "pr_ready" : "nothing_to_ship",
        baseSha,
        files: pathspecs.length,
        rounds: round,
        newMatches: report.newMatches.length,
        brokenMatches: 0,
        fuzzyRegressions: 0,
        metricRegressions: 0,
        matchedCodeBytesDelta: report.summary.matchedCodeBytesDelta,
        issuesCheck: issues.status,
        droppedFiles: Object.fromEntries(droppedFiles),
        shippedFiles: pathspecs,
        patchPath,
        checkedAt: new Date().toISOString(),
      };
      appendLog("ui", `ship-set verification: ${status.status} (${status.newMatches} confirmed matches, ${droppedFiles.size} file(s) dropped for rework)`);
      return writeStatus(status);
    }

    const offenders = new Map<string, string[]>();
    const note = (file: string, reason: string): void => {
      if (!file) return;
      offenders.set(file, [...(offenders.get(file) ?? []), reason]);
    };
    for (const file of issues.files) {
      note(file, "code issue (upstream check-issues lint)");
    }
    for (const entry of [...report.brokenMatches, ...report.fuzzyRegressions]) {
      note(entry.sourcePath || sourcePathFromUnit(entry.unitName), `${entry.itemName} ${entry.fromPercent.toFixed(2)} -> ${entry.toPercent.toFixed(2)}`);
    }
    for (const change of report.regressions) {
      note(sourcePathFromUnit(stringValue((change as unknown as JsonObject).name)), `metric ${stringValue((change as unknown as JsonObject).name)}`);
    }
    const droppable = [...offenders.keys()].filter((file) => pathspecs.includes(file));
    if (droppable.length === 0) {
      const status = {
        status: "blocked",
        baseSha,
        files: pathspecs.length,
        rounds: round,
        newMatches: report.newMatches.length,
        brokenMatches: report.brokenMatches.length,
        fuzzyRegressions: report.fuzzyRegressions.length,
        metricRegressions: report.regressions.length,
        droppedFiles: Object.fromEntries(droppedFiles),
        unattributed: Object.fromEntries(offenders),
        patchPath,
        checkedAt: new Date().toISOString(),
      };
      appendLog("ui", "ship-set verification: blocked — regressions could not be attributed to a shippable file");
      return writeStatus(status);
    }
    for (const file of droppable) {
      droppedFiles.set(file, offenders.get(file) ?? []);
      appendLog("ui", `ship-set round ${round}: dropping ${file} (${(offenders.get(file) ?? []).join("; ")})`);
    }
    pathspecs = pathspecs.filter((file) => !droppable.includes(file));
  }
  return writeStatus({ status: "blocked", baseSha, rounds: 4, droppedFiles: Object.fromEntries(droppedFiles), reason: "regressions persisted after 4 refinement rounds", checkedAt: new Date().toISOString() });
}

function remoteOwner(repoRoot: string, remote: string): string {
  const result = spawnSync("git", ["-C", repoRoot, "remote", "get-url", remote], { encoding: "utf8" });
  if (result.status !== 0) return "";
  const match = (result.stdout ?? "").trim().match(/github\.com[:/]([^/]+)\//);
  return match ? match[1] : "";
}

// Upstream CI's "Issues" job rejects PRs that introduce clang semantic issues
// (-Wself-assign, conflicting prototypes, ...) that the MWCC match build never
// sees. Run the exact same container locally so a slice fails here, before it
// is pushed, instead of failing on the PR. The image is amd64-only, so the
// platform is pinned (Docker on Apple Silicon runs it under Rosetta).
const CHECK_ISSUES_IMAGE = "ghcr.io/doldecomp/melee/check-issues:latest";
let dockerAvailable: boolean | null = null;

interface CodeIssuesResult {
  status: "clean" | "issues" | "unavailable";
  output: string;
  files: string[];
}

async function checkCodeIssues(worktreeDir: string): Promise<CodeIssuesResult> {
  if (dockerAvailable === null) {
    dockerAvailable = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  }
  if (!dockerAvailable) {
    return { status: "unavailable", output: "docker is not available; upstream CI will still run the Issues check", files: [] };
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  const run = await runCli([
    "docker", "run", "--rm",
    "--platform", "linux/amd64",
    "--user", `${uid}:${gid}`,
    "--volume", `${worktreeDir}:/input:ro`,
    CHECK_ISSUES_IMAGE,
  ]);
  const output = `${run.stdout}\n${run.stderr}`.trim();
  if (run.exitCode === 0) return { status: "clean", output, files: [] };
  // The checker prints an issue tree with per-file counts; anything else
  // (daemon hiccup, image pull failure) is infrastructure, not a verdict.
  if (!/Issues: \d/.test(output)) return { status: "unavailable", output, files: [] };
  const files = [...new Set([...output.matchAll(/^\s+((?:src|include)\/\S+) \(\d+\)$/gm)].map((match) => match[1]))];
  return { status: "issues", output, files };
}

async function verifyPrSliceInBaseline(params: { baseSha: string; baselineWorktree: string; files: string[]; patchPath: string }): Promise<{ issues: CodeIssuesResult; report: RegressionReport }> {
  const includeArgs = params.files.map((file) => `--include=${file}`);
  let report: RegressionReport | null = null;
  let issues: CodeIssuesResult = { status: "unavailable", output: "verification did not reach code-issues", files: [] };
  try {
    const apply = await runCli(["git", "apply", ...includeArgs, params.patchPath], params.baselineWorktree);
    if (apply.exitCode !== 0) throw new Error(`Slice patch did not apply (${apply.exitCode}): ${outputTail(apply.stderr, 1500)}`);
    const build = await runCli(["ninja", "changes_all"], params.baselineWorktree);
    if (build.exitCode !== 0) throw new Error(`Slice build failed (${build.exitCode}): ${outputTail(build.stderr || build.stdout, 3000)}`);
    report = await readRegressionReport(resolve(params.baselineWorktree, "build/GALE01/report_changes.json"), "slice isolation", 0);
    if (report.regressions.length === 0 && report.brokenMatches.length === 0 && report.fuzzyRegressions.length === 0) {
      issues = await checkCodeIssues(params.baselineWorktree);
    } else {
      issues = { status: "unavailable", output: "skipped — slice regressed in isolation", files: [] };
    }
  } finally {
    await runCli(["git", "reset", "--hard", params.baseSha], params.baselineWorktree);
    await runCli(["git", "clean", "-fd", "--", "src", "include", "config"], params.baselineWorktree);
  }
  if (!report) throw new Error("Slice verification did not produce a regression report.");
  return { report, issues };
}

function sliceValidationSummary(report: RegressionReport, issues: CodeIssuesResult): JsonObject {
  const regressions = report.regressions.length + report.brokenMatches.length + report.fuzzyRegressions.length;
  const status = regressions > 0 || issues.status === "issues" ? "failed" : issues.status === "unavailable" ? "warning" : "passed";
  return {
    status,
    checkedAt: new Date().toISOString(),
    newMatches: report.newMatches.length,
    regressions,
    brokenMatches: report.brokenMatches.length,
    fuzzyRegressions: report.fuzzyRegressions.length,
    metricRegressions: report.regressions.length,
    matchedCodeBytesDelta: report.summary.matchedCodeBytesDelta,
    issuesCheck: issues.status,
    issuesFiles: issues.files,
    issuesOutput: issues.status === "clean" ? "" : outputTail(issues.output, 1200),
  };
}

function assertSliceVerificationClean(branch: string, validation: JsonObject): void {
  if (stringValue(validation.status) === "passed" || stringValue(validation.status) === "warning") return;
  throw new Error(
    `Slice ${branch} is not locally ready: ${numberValue(validation.brokenMatches)} broken · ${numberValue(validation.fuzzyRegressions)} fuzzy · ${numberValue(validation.metricRegressions)} metric · ${stringValue(validation.issuesCheck)} issues.`,
  );
}

async function readyLocalPrSource(params: { baseSha: string; branch: string; files: string[]; record: JsonObject; repoRoot: string; stateDir: string }): Promise<JsonObject | null> {
  const local = asObject(params.record.local);
  const worktreePath = stringValue(local.worktreePath);
  const localStatus = stringValue(local.status);
  const localBranchRecord = isLocalBranchPrRecord(params.record);

  if (localStatus !== "ready" && !localBranchRecord) return null;
  if (localStatus === "ready" && (!worktreePath || !existsSync(resolve(worktreePath, ".git")))) {
    updatePrRecord(params.stateDir, params.branch, (record) => ({
      ...record,
      local: {
        ...asObject(record.local),
        status: localBranchRecord ? "local_only" : "blocked",
        error: worktreePath ? `Local PR worktree is missing at ${worktreePath}.` : "Local PR worktree path is missing.",
      },
    }));
    if (!localBranchRecord) return null;
  }

  if (worktreePath && existsSync(resolve(worktreePath, ".git"))) {
    const status = await runGit(worktreePath, ["status", "--porcelain"], { check: false });
    if (status.exitCode !== 0) throw new Error(`Unable to inspect local PR worktree for ${params.branch}: ${outputTail(status.stderr || status.stdout, 1200)}`);
    if (status.stdout.trim()) {
      const message = `Local PR worktree for ${params.branch} has uncommitted changes at ${worktreePath}. Commit or stash them before opening a draft.`;
      updatePrRecord(params.stateDir, params.branch, (record) => ({
        ...record,
        local: {
          ...asObject(record.local),
          status: "dirty",
          error: message,
        },
      }));
      throw new Error(message);
    }

    const currentBranch = await runGit(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"], { failureHint: `Unable to read local PR worktree branch for ${params.branch}` });
    if (currentBranch.stdout.trim() !== params.branch) {
      throw new Error(`Local PR worktree for ${params.branch} is checked out to ${currentBranch.stdout.trim() || "(detached)"}. Check out ${params.branch} before opening.`);
    }
  }

  if (!branchExists(params.repoRoot, params.branch)) return null;
  const sourceRepo = worktreePath && existsSync(resolve(worktreePath, ".git")) ? worktreePath : params.repoRoot;
  const head = await runGit(params.repoRoot, ["rev-parse", params.branch], { failureHint: `Unable to read local PR branch HEAD for ${params.branch}` });
  const commitSha = head.stdout.trim();
  const diffBase = localBranchDiffBase(params.repoRoot, params.baseSha, params.branch);
  const changed = await runGit(params.repoRoot, ["diff", "--name-only", `${diffBase}..${params.branch}`], { failureHint: `Unable to inspect local PR diff for ${params.branch}` });
  const changedFiles = changed.stdout.split("\n").map((file) => file.trim()).filter(Boolean);
  if (changedFiles.length === 0) throw new Error(`Local PR branch ${params.branch} has no committed diff from ${diffBase.slice(0, 10)}.`);
  const manifest = new Set(params.files);
  const outsideManifest = changedFiles.filter((file) => !manifest.has(file));
  if (outsideManifest.length > 0) {
    throw new Error(`Local PR branch ${params.branch} changes file(s) outside the PR manifest: ${outsideManifest.slice(0, 8).join(", ")}${outsideManifest.length > 8 ? `, +${outsideManifest.length - 8} more` : ""}. Re-plan or move those edits before opening.`);
  }

  const patchDir = resolve(params.stateDir, "pr_handoff", "local_patches");
  mkdirSync(patchDir, { recursive: true });
  const patchPath = resolve(patchDir, `${prBranchPathSlug(params.branch)}.patch`);
  const diff = await runGit(params.repoRoot, ["diff", "--binary", `${diffBase}..${params.branch}`, "--", ...params.files], { failureHint: `Unable to write local PR patch for ${params.branch}` });
  if (!diff.stdout.trim()) throw new Error(`Local PR worktree for ${params.branch} produced an empty manifest diff.`);
  writeFileSync(patchPath, diff.stdout, "utf8");

  return {
    commitSha,
    diffBase,
    patchPath,
    source: sourceRepo === worktreePath ? "local_worktree" : "local_branch",
    worktreePath: sourceRepo === worktreePath ? worktreePath : "",
  };
}

async function prepareLocalPrWorkspace(params: {
  baseSha: string;
  branch: string;
  files: string[];
  force: boolean;
  patchPath: string;
  record: JsonObject;
  repoRoot: string;
  runId: string;
  stateDir: string;
  title: string;
}): Promise<JsonObject> {
  const local = asObject(params.record.local);
  const existingWorktree = stringValue(local.worktreePath);
  const worktreePath = existingWorktree || prWorkspacePath(params.stateDir, params.runId, params.branch);
  if (stringValue(local.status) === "ready" && worktreePath && existsSync(resolve(worktreePath, ".git"))) {
    return {
      ...params.record,
      local: { ...local, status: "ready", branch: params.branch, worktreePath },
    };
  }
  if (existsSync(worktreePath) && !params.force) {
    throw new Error(`Local worktree already exists at ${worktreePath}. Inspect it or rerun with force before overwriting local PR workspace state.`);
  }

  mkdirSync(dirname(worktreePath), { recursive: true });
  if (!existsSync(resolve(worktreePath, ".git"))) {
    await runGit(params.repoRoot, ["worktree", "prune"], { check: false });
    const add = await runGit(params.repoRoot, ["worktree", "add", "-B", params.branch, worktreePath, params.baseSha], { check: false });
    if (add.exitCode !== 0) throw new Error(`git worktree add failed (${add.exitCode}): ${outputTail(add.stderr || add.stdout, 1500)}`);
  } else if (params.force) {
    const checkout = await runGit(worktreePath, ["checkout", "-B", params.branch, params.baseSha], { check: false });
    if (checkout.exitCode !== 0) throw new Error(`git checkout failed in local PR worktree (${checkout.exitCode}): ${outputTail(checkout.stderr || checkout.stdout, 1500)}`);
    await runGit(worktreePath, ["reset", "--hard", params.baseSha], { check: false });
    await runGit(worktreePath, ["clean", "-fd", "--", "src", "include", "config"], { check: false });
  }

  const origSource = resolve(params.repoRoot, "orig");
  if (existsSync(origSource)) linkMissingFiles(origSource, resolve(worktreePath, "orig"));

  const includeArgs = params.files.map((file) => `--include=${file}`);
  const apply = await runCli(["git", "apply", "--index", ...includeArgs, params.patchPath], worktreePath);
  if (apply.exitCode !== 0) throw new Error(`Patch apply failed in the local PR worktree (${apply.exitCode}): ${outputTail(apply.stderr, 1500)}`);
  const commit = await runCli(["git", "commit", "-m", params.title], worktreePath);
  if (commit.exitCode !== 0) throw new Error(`git commit failed in the local PR worktree (${commit.exitCode}): ${outputTail(commit.stderr || commit.stdout, 1500)}`);
  const head = await runGit(worktreePath, ["rev-parse", "HEAD"], { failureHint: "Unable to read local PR worktree HEAD" });
  return {
    ...params.record,
    local: {
      ...local,
      status: "ready",
      branch: params.branch,
      worktreePath,
      commitSha: head.stdout.trim(),
      preparedAt: new Date().toISOString(),
      error: "",
    },
  };
}

async function prepareLocalPrForBranch(body: JsonObject, branch: string): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  assertHandoffIdle(stateDir, "Prepare local PR");
  const runId = activeRunIdFromBody(body, stateDir);
  const context = prRecordContext(stateDir, runId);
  const payload = normalizePrRecordsPayload(readPrRecords(stateDir));
  const records = asArray(payload.records).map(asObject);
  const index = records.findIndex((candidate) => stringValue(candidate.branch) === branch);
  if (index < 0) throw new Error(`No PR record for branch ${branch}; run Sync PR Status first.`);
  const record = normalizePrRecord(records[index], context);
  const status = stringValue(record.status, "planned");
  if (status !== "planned") throw new Error(`Local preparation expects a planned PR slice; ${branch} is ${status}.`);
  const files = asArray(record.files).map((path) => stringValue(path)).filter(Boolean);
  if (files.length === 0) throw new Error(`PR record for ${branch} has no file manifest; re-run Plan PRs and Sync PR Status.`);

  const shipStatus = readJsonObject(resolve(stateDir, "pr_handoff", "ship_status.json"));
  if (stringValue(shipStatus.status) !== "pr_ready") throw new Error("Ship set is not pr_ready; run Prepare Handoff first.");
  const patchPath = stringValue(shipStatus.patchPath, resolve(stateDir, "pr_handoff", "ship_set.patch"));
  if (!existsSync(patchPath)) throw new Error(`Verified ship patch missing at ${patchPath}; run Prepare Handoff first.`);
  const baselineStatus = readJsonObject(resolve(stateDir, "pr_handoff", "baseline_status.json"));
  const baseSha = stringValue(baselineStatus.baseSha);
  const baselineWorktree = stringValue(baselineStatus.worktreeDir);
  if (!baseSha || !baselineWorktree || !existsSync(baselineWorktree)) {
    throw new Error("Baseline worktree missing; run Prepare Handoff to rebuild the production baseline.");
  }
  if (baseSha !== stringValue(shipStatus.baseSha)) throw new Error("Baseline and ship status disagree on the base SHA; re-run Prepare Handoff.");

  try {
    updatePrRecord(stateDir, branch, (current) => ({
      ...current,
      local: { ...asObject(current.local), status: "preparing", prepStartedAt: new Date().toISOString(), error: "" },
    }));
    operationStep("verify slice locally", `${files.length} file(s) onto baseline ${baseSha.slice(0, 10)}`);
    const { report, issues } = await verifyPrSliceInBaseline({ baseSha, baselineWorktree, files, patchPath });
    const validation = sliceValidationSummary(report, issues);
    assertSliceVerificationClean(branch, validation);
    operationStepDetail("verify slice locally", `${numberValue(validation.newMatches)} new match(es), ${stringValue(validation.issuesCheck)} issues check`);

    operationStep("prepare local worktree", branch);
    const title = stringValue(record.title, `Melee decomp: ${stringValue(record.displayName, branch)}`);
    const prepared = await prepareLocalPrWorkspace({
      baseSha,
      branch,
      files,
      force: body.forceLocalPrepare === true,
      patchPath,
      record: { ...record, baseSha, validation },
      repoRoot,
      runId,
      stateDir,
      title,
    });
    const updated = normalizePrRecord(
      {
        ...prepared,
        status: "planned",
        baseSha,
        validation,
        batch: {
          ...asObject(prepared.batch),
          state: stringValue(asObject(prepared.batch).state, "unbatched"),
        },
      },
      context,
    );
    records[index] = updated;
    const nextPayload = writePrRecords(stateDir, { ...payload, records, syncedAt: stringValue(payload.syncedAt) || new Date().toISOString() });
    operationStepDetail("prepare local worktree", `${branch} @ ${stringValue(asObject(updated.local).commitSha).slice(0, 10)}`);
    appendLog("ui", `local PR prepared: ${branch} -> ${stringValue(asObject(updated.local).worktreePath)}`);
    return { prepared: true, branch, record: updated, prs: nextPayload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    records[index] = normalizePrRecord(
      {
        ...record,
        local: {
          ...asObject(record.local),
          status: "blocked",
          error: message,
        },
        validation: {
          ...asObject(record.validation),
          status: "failed",
          checkedAt: new Date().toISOString(),
        },
      },
      context,
    );
    writePrRecords(stateDir, { ...payload, records });
    throw error;
  }
}

async function prepareLocalPr(body: JsonObject): Promise<JsonObject> {
  const branch = stringValue(body.prBranch);
  if (!branch) throw new Error("Prepare local PR needs prBranch (the slice's branch name).");
  return withOperation("prepare-local-pr", `Prepare Local PR — ${branch}`, ["verify slice locally", "prepare local worktree"], () => prepareLocalPrForBranch(body, branch));
}

// Manual review-substate control for the In Review column. The operator uses
// it to ack new comments (clears "new_comments" back to "awaiting") or to
// mark that they are addressing feedback ("fixing"). Derivation on the next
// sync supersedes "fixing" only when new reviewer activity arrives.
async function setPrReviewState(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const branch = stringValue(body.prBranch);
  if (!branch) throw new Error("Review state needs prBranch (the slice's branch name).");
  const subState = stringValue(body.subState);
  const allowed = new Set(["awaiting", "new_comments", "changes_requested", "fixing", ""]);
  if (!allowed.has(subState)) throw new Error(`Unknown review subState: ${subState || "(empty)"}.`);
  const seenComments = numberValue(body.seenComments, NaN);
  const updated = updatePrRecord(paths.stateDir, branch, (record) => {
    const review = asObject(record.review);
    const github = asObject(record.github);
    const currentComments = numberValue(github.comments, numberValue(record.comments, 0));
    return {
      ...record,
      review: {
        ...review,
        subState,
        lastSeenComments: Number.isFinite(seenComments) ? seenComments : currentComments,
        subStateSetAt: new Date().toISOString(),
        ...(subState === "fixing" ? { lastOurActionAt: new Date().toISOString() } : subState === "awaiting" ? { lastReviewerSeenAt: new Date().toISOString() } : {}),
      },
    };
  });
  if (!updated) throw new Error(`No PR record for branch ${branch}; run Sync PR Status first.`);
  appendLog("ui", `review state for ${branch}: ${subState || "(cleared)"}`);
  const runId = activeRunIdFromBody(body, paths.stateDir);
  return { branch, review: asObject(updated).review, prs: buildPrRecordsView(paths.stateDir, runId) };
}

async function prepareLocalPrBatch(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const runId = activeRunIdFromBody(body, paths.stateDir);
  const payload = normalizePrRecordsPayload(readPrRecords(paths.stateDir));
  const limit = intValue(body.batchLimit, DEFAULT_PR_BATCH_LIMIT, 1);
  const candidates = asArray(payload.records)
    .map(asObject)
    .filter((record) => prRecordMatchesRun(record, runId) && stringValue(record.status, "planned") === "planned" && stringValue(asObject(record.local).status, "not_prepared") === "not_prepared" && stringValue(record.branch))
    .slice(0, limit);
  if (candidates.length === 0) throw new Error("No planned PR slices need local preparation.");
  return withOperation("prepare-local-batch", `Prepare Local Batch — next ${candidates.length}`, candidates.map((record) => stringValue(record.branch)), async () => {
    const results: JsonObject[] = [];
    for (const record of candidates) {
      const branch = stringValue(record.branch);
      operationStep(branch, "local workspace preparation");
      try {
        const result = await prepareLocalPrForBranch(body, branch);
        results.push({ branch, prepared: true, record: asObject(result.record) });
        operationStepDetail(branch, "local ready");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ branch, prepared: false, error: message });
        operationStepDetail(branch, `failed: ${outputTail(message, 300)}`);
        appendLog("stderr", `prepare-local-batch: ${branch} failed — ${message}`);
      }
    }
    const preparedCount = results.filter((result) => result.prepared === true).length;
    if (preparedCount === 0) throw new Error(`No local PR workspaces prepared; all ${results.length} slice(s) failed. See Logs.`);
    return { preparedCount, failedCount: results.length - preparedCount, results, prs: normalizePrRecordsPayload(readPrRecords(paths.stateDir)) };
  });
}

/**
 * Publish one planned slice as a draft PR. The slice is re-verified alone in
 * the cached baseline worktree (incremental build + regression report, then
 * reset — same machinery as ship-set verification), then a branch is cut
 * from the base SHA, the slice's subset of ship_set.patch is committed,
 * pushed to the fork, and opened as a draft so nothing pings maintainers
 * until the operator un-drafts it. The PR board re-syncs at the end.
 */
async function openPrForSlice(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  assertHandoffIdle(stateDir, "Open PR");
  const branch = stringValue(body.prBranch);
  if (!branch) throw new Error("Open PR needs prBranch (the slice's branch name).");
  const records = asArray(readPrRecords(stateDir).records).map(asObject);
  const record = records.find((candidate) => stringValue(candidate.branch) === branch);
  if (!record) throw new Error(`No PR record for branch ${branch}; run Sync PR Status first.`);
  if (record.prNumber) throw new Error(`Branch ${branch} already has PR #${numberValue(record.prNumber)}.`);
  const files = asArray(record.files).map((path) => stringValue(path)).filter(Boolean);
  if (files.length === 0) throw new Error(`PR record for ${branch} has no file manifest; re-run Plan PRs and Sync PR Status.`);

  const repoSlug = upstreamRepoSlug(repoRoot);
  const forkOwner = remoteOwner(repoRoot, "fork");
  if (!repoSlug || !forkOwner) throw new Error("Need an `origin` (upstream) and `fork` (push target) remote on the checkout.");

  const title = stringValue(record.title, `Melee decomp: ${stringValue(record.displayName, branch)}`);
  const steps = ["prepare baseline", "prepare source patch", "verify slice in isolation", "check code issues", "publish branch", "create draft PR", "sync PR records"];
  return withOperation("open-pr", `Open PR — ${stringValue(record.displayName, branch)}`, steps, async () => {
    const baseRef = paths.project?.baseRef ?? "origin/master";
    operationStep("prepare baseline", baseRef);
    const baselineStatus = await ensureOpenPrBaseline(paths);
    const baseSha = stringValue(baselineStatus.baseSha);
    const baselineWorktree = stringValue(baselineStatus.worktreeDir);
    const baselineJson = baselineWorktree ? resolve(baselineWorktree, "build/GALE01/baseline.json") : "";
    if (!baseSha || !baselineWorktree || !existsSync(baselineJson)) {
      failOperationStep("prepare baseline");
      throw new Error("Baseline worktree missing; run Prepare Handoff to rebuild the production baseline.");
    }
    operationStepDetail("prepare baseline", `${baseSha.slice(0, 10)} at ${baselineWorktree}`);

    operationStep("prepare source patch", isLocalBranchPrRecord(record) ? "local branch" : "verified ship set");
    const localSource = await readyLocalPrSource({ baseSha, branch, files, record, repoRoot, stateDir });
    const shipStatus = readJsonObject(resolve(stateDir, "pr_handoff", "ship_status.json"));
    let patchToApply = stringValue(localSource?.patchPath);
    let shipSetVerified = false;
    if (localSource) {
      operationStepDetail("prepare source patch", `${stringValue(localSource.source, "local source")} commit ${stringValue(localSource.commitSha).slice(0, 10)}`);
    } else {
      if (stringValue(shipStatus.status) !== "pr_ready") {
        operationNextHint("Run Prepare Handoff, or make sure the local PR branch exists so Open Draft can publish from that branch.");
        throw new Error("Ship set is not pr_ready and no local branch source was available.");
      }
      if (baseSha !== stringValue(shipStatus.baseSha)) {
        operationNextHint("Run Prepare Handoff again, or open from a local branch that can be verified against the current baseline.");
        throw new Error(`Verified ship set was prepared for ${stringValue(shipStatus.baseSha).slice(0, 10)}, but ${baseRef} is ${baseSha.slice(0, 10)}.`);
      }
      const shipPatchPath = prHandoffArtifactPath(stateDir, stringValue(shipStatus.patchPath), "ship_set.patch");
      if (!existsSync(shipPatchPath)) throw new Error(`Verified ship patch missing at ${shipPatchPath}; run Prepare Handoff first.`);
      patchToApply = shipPatchPath;
      shipSetVerified = true;
      operationStepDetail("prepare source patch", "verified ship_set.patch");
    }
    if (!patchToApply) throw new Error(`No source patch could be prepared for ${branch}.`);

    const includeArgs = files.map((file) => `--include=${file}`);
    operationStep("verify slice in isolation", `${files.length} file(s) onto baseline ${baseSha.slice(0, 10)}`);
    const { report, issues } = await verifyPrSliceInBaseline({ baseSha, baselineWorktree, files, patchPath: patchToApply });
    if (report.regressions.length > 0 || report.brokenMatches.length > 0 || report.fuzzyRegressions.length > 0) {
      failOperationStep("verify slice in isolation");
      operationNextHint("This slice does not stand alone — it likely depends on a shared/support slice. Open that slice's PR first, or stack the branches manually.");
      throw new Error(`Slice ${branch} regresses in isolation: ${report.brokenMatches.length} broken · ${report.fuzzyRegressions.length} fuzzy · ${report.regressions.length} metric.`);
    }
    operationStepDetail("verify slice in isolation", `${report.newMatches.length} new match(es), 0 regressions`);
    operationStep("check code issues", "upstream check-issues lint on the patched tree");
    if (issues.status === "issues") {
      failOperationStep("check code issues");
      operationNextHint("Upstream CI's Issues job would reject this slice. Fix the listed file(s) (e.g. permuter slop like self-assignment, conflicting prototypes) and re-run Prepare Handoff.");
      throw new Error(`Slice ${branch} fails the upstream Issues lint in ${issues.files.join(", ") || "(unattributed files)"}: ${outputTail(issues.output, 1200)}`);
    }
    operationStepDetail("check code issues", issues.status === "clean" ? "Issues: OK" : `skipped — ${outputTail(issues.output, 200)}`);

    if (localSource) {
      updatePrRecord(stateDir, branch, (current) => ({
        ...current,
        local: {
          ...asObject(current.local),
          status: stringValue(localSource.source) === "local_worktree" ? "ready" : "local_only",
          worktreePath: stringValue(localSource.worktreePath),
          commitSha: stringValue(localSource.commitSha),
          error: "",
        },
        validation: sliceValidationSummary(report, issues),
      }));
      operationStep("publish branch", `fork/${branch}`);
      const push =
        stringValue(localSource.source) === "local_worktree"
          ? await runCli(["git", "push", "--force-with-lease", "-u", "fork", `HEAD:${branch}`], stringValue(localSource.worktreePath))
          : await runCli(["git", "push", "--force-with-lease", "-u", "fork", `${branch}:${branch}`], repoRoot);
      if (push.exitCode !== 0) throw new Error(`git push failed (${push.exitCode}): ${outputTail(push.stderr, 1500)}`);
    } else {
      operationStep("publish branch", branch);
      const worktreeDir = resolve(tmpdir(), `melee-pr-${branch.replace(/[^A-Za-z0-9_.-]+/g, "-")}`);
      if (existsSync(worktreeDir)) await runCli(["git", "worktree", "remove", "--force", worktreeDir], repoRoot);
      const add = await runCli(["git", "worktree", "add", "-B", branch, worktreeDir, baseSha], repoRoot);
      if (add.exitCode !== 0) throw new Error(`git worktree add failed (${add.exitCode}): ${outputTail(add.stderr, 1500)}`);
      try {
        const apply = await runCli(["git", "apply", "--index", ...includeArgs, patchToApply], worktreeDir);
        if (apply.exitCode !== 0) throw new Error(`Patch apply failed in the PR worktree (${apply.exitCode}): ${outputTail(apply.stderr, 1500)}`);
        const commit = await runCli(["git", "commit", "-m", title], worktreeDir);
        if (commit.exitCode !== 0) throw new Error(`git commit failed (${commit.exitCode}): ${outputTail(commit.stderr || commit.stdout, 1500)}`);
        const push = await runCli(["git", "push", "--force-with-lease", "-u", "fork", branch], worktreeDir);
        if (push.exitCode !== 0) throw new Error(`git push failed (${push.exitCode}): ${outputTail(push.stderr, 1500)}`);
      } finally {
        await runCli(["git", "worktree", "remove", "--force", worktreeDir], repoRoot);
      }
    }

    operationStep("create draft PR", `${repoSlug} ← ${forkOwner}:${branch}`);
    const bodyDir = resolve(stateDir, "pr_handoff", "pr_bodies");
    mkdirSync(bodyDir, { recursive: true });
    const bodyPath = resolve(bodyDir, `${branch.replace(/[^A-Za-z0-9_.-]+/g, "-")}.md`);
    const bodyLines = [
      "## Summary",
      "",
      `Exact-match decompilation of ${files.length} file(s) (${report.newMatches.length} newly matched function(s)). Produced by the decomp-orchestrator pipeline; only runner-validated exact matches ship.`,
      "",
      "## Files",
      "",
      ...files.map((file) => `- \`${file}\``),
      "",
      "## Verification",
      "",
      `- Slice verified in isolation against the production baseline at \`${baseSha.slice(0, 10)}\`: applied alone, built with \`ninja changes_all\`, regression report clean (0 broken matches, 0 fuzzy regressions, 0 metric regressions).`,
      ...(shipSetVerified ? [`- Also verified as part of the full ship set (${numberValue(shipStatus.newMatches)} new matches, 0 regressions).`] : []),
      ...(localSource ? [`- Published from the ${stringValue(localSource.source, "local source").replace(/_/g, " ")} commit \`${stringValue(localSource.commitSha).slice(0, 10)}\`.`] : []),
      ...(issues.status === "clean" ? ["- Passed the upstream `check-issues` lint locally (same container as CI's Issues job)."] : []),
    ];
    writeFileSync(bodyPath, `${bodyLines.join("\n")}\n`, "utf8");
    const create = await runCli(
      ["gh", "pr", "create", "--repo", repoSlug, "--head", `${forkOwner}:${branch}`, "--draft", "--title", title, "--body-file", bodyPath],
      stringValue(localSource?.worktreePath) || repoRoot,
    );
    if (create.exitCode !== 0) throw new Error(`gh pr create failed (${create.exitCode}): ${outputTail(create.stderr || create.stdout, 1500)}`);
    const prUrl = create.stdout.trim().split("\n").pop() ?? "";
    operationStepDetail("create draft PR", prUrl);
    appendLog("ui", `draft PR opened: ${prUrl}`);

    operationStep("sync PR records");
    const prs = await syncPrRecords({ ...body });
    const updated = asArray(prs.records).map(asObject).find((candidate) => stringValue(candidate.branch) === branch) ?? null;
    operationStepDetail("sync PR records", updated ? `${branch} → ${stringValue(updated.status)} #${numberValue(updated.prNumber)}` : "synced");
    return { opened: true, branch, record: updated, prs };
  });
}

/**
 * Open every planned slice as a draft PR, one at a time. Support/shared
 * slices go first (subsystem slices may only build on top of them); a slice
 * that fails is recorded and skipped so one bad slice doesn't strand the
 * rest. Each slice runs the same verify -> branch -> push -> draft pipeline
 * as the single-slice button.
 */
async function openAllPlannedPrs(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const runId = activeRunIdFromBody(body, paths.stateDir);
  const records = asArray(normalizePrRecordsPayload(readPrRecords(paths.stateDir)).records).map(asObject);
  const planned = records.filter(
    (record) => prRecordMatchesRun(record, runId) && stringValue(record.status, "planned") === "planned" && stringValue(record.branch) && asArray(record.files).length > 0,
  );
  if (planned.length === 0) throw new Error("No planned PR records to open. Run Prepare Handoff (or Plan PRs + Sync PR Status) first.");
  const ordered = [...planned].sort((left, right) => {
    const leftSubsystem = stringValue(left.scope).startsWith("melee/") ? 1 : 0;
    const rightSubsystem = stringValue(right.scope).startsWith("melee/") ? 1 : 0;
    return leftSubsystem - rightSubsystem || stringValue(left.branch).localeCompare(stringValue(right.branch));
  });
  return withOperation("open-all-prs", "Open All Draft PRs", ordered.map((record) => stringValue(record.branch)), async () => {
    const results: JsonObject[] = [];
    for (const record of ordered) {
      const branch = stringValue(record.branch);
      operationStep(branch);
      try {
        const result = await openPrForSlice({ ...body, prBranch: branch });
        const opened = asObject(result.record);
        results.push({ branch, opened: true, prNumber: numberValue(opened.prNumber, NaN), url: stringValue(opened.url) });
        operationStepDetail(branch, `draft #${numberValue(opened.prNumber)} opened`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ branch, opened: false, error: message });
        operationStepDetail(branch, `failed: ${outputTail(message, 300)}`);
        appendLog("stderr", `open-all: ${branch} failed — ${message}`);
      }
    }
    const openedCount = results.filter((result) => result.opened === true).length;
    if (openedCount === 0) {
      operationNextHint("Every slice failed to open. Check the Logs tab for the first failure; isolation failures usually mean the slice needs to stack on a shared slice.");
      throw new Error(`No PRs opened; all ${results.length} slice(s) failed. See Logs.`);
    }
    appendLog("ui", `open-all: ${openedCount}/${results.length} draft PR(s) opened`);
    return { openedCount, failedCount: results.length - openedCount, results };
  });
}

async function openNextDraftBatch(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const runId = activeRunIdFromBody(body, paths.stateDir);
  const limit = intValue(body.batchLimit, DEFAULT_PR_BATCH_LIMIT, 1);
  const payload = normalizePrRecordsPayload(readPrRecords(paths.stateDir));
  const ready = asArray(payload.records)
    .map(asObject)
    .filter((record) => {
      const localStatus = stringValue(asObject(record.local).status);
      return (
        prRecordMatchesRun(record, runId) &&
        stringValue(record.status, "planned") === "planned" &&
        stringValue(record.branch) &&
        (localStatus === "ready" || (localStatus === "local_only" && isLocalBranchPrRecord(record)))
      );
    })
    .slice(0, limit);
  if (ready.length === 0) throw new Error("No local-ready or local-branch PR slices to open. Prepare a local batch first, or run Sync PRs to rediscover local branches.");
  return withOperation("open-draft-batch", `Open Draft Batch — next ${ready.length}`, ready.map((record) => stringValue(record.branch)), async () => {
    const results: JsonObject[] = [];
    const published = new Set<string>();
    for (const record of ready) {
      const branch = stringValue(record.branch);
      operationStep(branch);
      try {
        const result = await openPrForSlice({ ...body, prBranch: branch });
        const opened = asObject(result.record);
        results.push({ branch, opened: true, prNumber: numberValue(opened.prNumber, NaN), url: stringValue(opened.url) });
        published.add(branch);
        operationStepDetail(branch, `draft #${numberValue(opened.prNumber)} opened`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ branch, opened: false, error: message });
        operationStepDetail(branch, `failed: ${outputTail(message, 300)}`);
        appendLog("stderr", `open-draft-batch: ${branch} failed — ${message}`);
      }
    }
    const openedCount = results.filter((result) => result.opened === true).length;
    if (openedCount === 0) {
      operationNextHint("Every local-ready slice failed to open. Check the Logs tab for the first failure.");
      throw new Error(`No PRs opened; all ${results.length} local-ready slice(s) failed. See Logs.`);
    }

    const latest = normalizePrRecordsPayload(readPrRecords(paths.stateDir));
    const updatedRecords = asArray(latest.records).map((value) => {
      const record = asObject(value);
      if (!published.has(stringValue(record.branch))) return record;
      return normalizePrRecord(
        {
          ...record,
          batch: {
            ...asObject(record.batch),
            state: "published",
            publishedAt: new Date().toISOString(),
          },
        },
      );
    });
    const prs = writePrRecords(paths.stateDir, { ...latest, records: updatedRecords, syncedAt: new Date().toISOString() });
    return { openedCount, failedCount: results.length - openedCount, results, prs };
  });
}

async function preparePrHandoff(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const stateDir = paths.stateDir;
  const runId = activeRunIdFromBody(body, stateDir);
  assertHandoffIdle(stateDir, "Prepare handoff");
  const prepareSteps = [
    "pause intake",
    "pull upstream & rebase",
    "PR intake agents",
    "knowledge graph rebuild",
    "rebuild production baseline",
    "QA build & regression gate",
    "checkpoint",
    "requeue rework",
    "QA repair lane",
    "plan PR slices",
    "verify ship set",
    "reconcile & re-verify",
    "replan PR slices",
    "sync PR records",
    "save point",
  ];
  return withOperation("prepare", "Prepare Handoff", prepareSteps, async () => {
    operationStep("pause intake");
    const pause = body.pauseBeforeHandoff !== false ? await pauseRunForPr(body) : null;

    operationStep("pull upstream & rebase");
    const gitSync = await syncProjectGitAndFindMergedPrs(paths);
    operationStepDetail(
      "pull upstream & rebase",
      gitSync.beforeRef === gitSync.afterRef
        ? `already at ${paths.project?.baseRef ?? "origin/master"} (${gitSync.afterRef.slice(0, 10)})`
        : `${gitSync.mergedPrs.length} merged PR(s) pulled; ${gitSync.branch} rebased onto ${gitSync.afterRef.slice(0, 10)}`,
    );

    if (gitSync.mergedPrs.length > 0) {
      await runMergedPrIntakeAndKnowledge(paths, gitSync.mergedPrs, boolValue(body.dryRunAgents));
    } else {
      operationStep("PR intake agents", "skipped — no newly merged PRs");
      operationStep("knowledge graph rebuild", "skipped — no newly merged PRs");
    }

    operationStep("rebuild production baseline");
    const baseline = await rebuildProductionBaseline(paths);
    operationStepDetail("rebuild production baseline", `${stringValue(baseline.baseSha).slice(0, 10)} ${baseline.cached ? "(cached)" : "(full build)"}`);

    // QA builds the branch against the fresh baseline; the checkpoint then
    // classifies with that knowledge so regressed symbols land in
    // needs_rework instead of a shipping lane. The checkpoint always lands,
    // even when the gate fails, so the rework ledger survives the abort.
    const qa = await runPrQa({ ...body, stateDir, runId });
    const qaPassed = stringValue(qa.status) === "passed" && numberValue(qa.cliExitCode, 1) === 0;

    const regressionReport = await regressionReportFromChanges(paths.repoRoot);
    const reworkEntries = regressionReport ? [...regressionReport.brokenMatches, ...regressionReport.fuzzyRegressions] : [];
    const reworkSymbols = [...new Set(reworkEntries.map((entry) => entry.itemName).filter(Boolean))];
    const checkpoint = await checkpointRunForPr({ ...body, stateDir, runId }, reworkSymbols);
    if (reworkSymbols.length > 0) {
      operationStepDetail("checkpoint", `${reworkSymbols.length} regressed symbol(s) moved to needs_rework`);
    }

    // Rework is not just parked: regressed symbols go back into the queue at
    // repair priority so the next working session fixes them first. This runs
    // before the gate verdict aborts, so blocked prepares still queue repairs.
    operationStep("requeue rework");
    let requeued = 0;
    if (regressionReport && reworkEntries.length > 0) {
      const sourcePaths = new Map<string, string>();
      for (const entry of reworkEntries) {
        if (entry.sourcePath) sourcePaths.set(entry.unitName, entry.sourcePath);
      }
      const repairPlan = planRegressionRepair(regressionReport, { pauseThreshold: 0, repairPriorityBase: 400, requeueLimit: 64, sourcePaths });
      const store = openState(stateDir);
      try {
        requeued = prioritizeQueuedTargets(store, runId, repairPlan.repairCandidates);
      } finally {
        store.db.close();
      }
      appendLog("ui", `requeued ${requeued} regressed target(s) for repair`);
      operationStepDetail("requeue rework", `${requeued} regressed target(s) queued at repair priority`);
    } else {
      operationStepDetail("requeue rework", "nothing regressed against the baseline");
    }

    // The branch-level QA verdict is informational: regressions there are
    // rework (already requeued), not PR blockers, because only the assembled
    // match set ships. The ship-set verification below is the real gate.
    const branchVerdict = stringValue(asObject(qa.prPromotion).status, stringValue(qa.status, "unknown"));

    const qaRepair = await runQaRepairForPr({ ...body, stateDir, runId });
    const qaRepairShipStatusPath = stringValue(qaRepair.shipStatusPath);

    const splitPlan = await runPrSplitPlan({ ...body, stateDir, runId, prShipStatusPath: qaRepairShipStatusPath });
    if (stringValue(splitPlan?.status) !== "passed") throw new Error("PR split planning failed; see Logs for the pr-split-plan output.");

    const matchPathspecs = asArray(splitPlan.matchPathspecs).map((path) => stringValue(path)).filter(Boolean);
    operationStep("verify ship set", `${matchPathspecs.length} match file(s) onto baseline ${stringValue(baseline.baseSha).slice(0, 10)}`);
    let ship = await verifyShipSet(paths, baseline, matchPathspecs);
    let shipStatus = stringValue(ship.status);
    const shipDetail = (): string =>
      shipStatus === "pr_ready"
        ? `pr_ready — ${numberValue(ship.newMatches)} confirmed match(es) across ${numberValue(ship.files)} file(s), 0 regressions`
        : `${shipStatus} — ${numberValue(ship.fuzzyRegressions)} fuzzy · ${numberValue(ship.metricRegressions)} metric regression(s)`;
    operationStepDetail("verify ship set", shipDetail());
    if (shipStatus === "nothing_to_ship") {
      failOperationStep("verify ship set");
      operationNextHint("No confirmed matches survive verification yet. Resume the run to produce more matches; dropped files are already requeued as rework.");
      throw new Error("Nothing to ship: no new matches survive against the production baseline.");
    }

    // Handoff is the hard save point, so it owns its own repair: when the
    // ship set is blocked the reconcile agent gets one fix loop before the
    // pipeline gives up, instead of bouncing the operator to a button.
    if (shipStatus !== "pr_ready" && body.autoReconcile !== false) {
      operationStep("reconcile & re-verify", "ship set blocked — reconcile agent fix loop");
      await runReconcile({ ...body, stateDir, runId, mode: "ship-validate" });
      ship = await verifyShipSet(paths, baseline, matchPathspecs);
      shipStatus = stringValue(ship.status);
      operationStepDetail("reconcile & re-verify", shipDetail());
    } else {
      operationStep("reconcile & re-verify", "skipped — ship set clean");
    }
    if (shipStatus !== "pr_ready") {
      failOperationStep("reconcile & re-verify");
      operationNextHint("Regressions persist after the reconcile attempt. Inspect ship_status.json, fix or drop the offending files, then re-run Prepare Handoff.");
      throw new Error(`Ship set is ${shipStatus}: ${numberValue(ship.fuzzyRegressions)} fuzzy and ${numberValue(ship.metricRegressions)} metric regression(s) remain after reconcile.`);
    }
    const droppedCount = Object.keys(asObject(ship.droppedFiles)).length;

    // The plan above was the verification *input*; when the survivor loop
    // dropped files, regenerate it against the verdict so match slices
    // natively exclude the drops and the artifact the operator ships from
    // needs no manual subtraction.
    operationStep("replan PR slices");
    let finalSplitPlan = splitPlan;
    const shippedFiles = asArray(ship.shippedFiles).map((path) => stringValue(path)).filter(Boolean);
    const plannedMatches = asArray(splitPlan.matchPathspecs).map((path) => stringValue(path)).filter(Boolean);
    if (droppedCount > 0 || shippedFiles.length !== plannedMatches.length) {
      finalSplitPlan = await runPrSplitPlan({
        ...body,
        stateDir,
        runId,
        prShipStatusPath: resolve(stateDir, "pr_handoff", "ship_status.json"),
      });
      if (stringValue(finalSplitPlan?.status) !== "passed") {
        failOperationStep("replan PR slices");
        throw new Error("Post-verification PR split replan failed; see Logs for the pr-split-plan output.");
      }
      operationStepDetail(
        "replan PR slices",
        `${droppedCount} dropped file(s) moved to the local lane; match slices now carry ${asArray(finalSplitPlan.matchPathspecs).length} file(s)`,
      );
    } else {
      operationStepDetail("replan PR slices", "skipped — every planned match file survived verification");
    }

    // The handoff ends the session: seed the PR board from the final plan so
    // stage 4 lists exactly what to open, then anchor everything with the
    // hard `ship` save point. The next run starts from here.
    operationStep("sync PR records");
    let prRecords: JsonObject | null = null;
    try {
      prRecords = await syncPrRecords({ ...body, stateDir, runId });
      operationStepDetail("sync PR records", `${asArray(prRecords.records).length} PR record(s) tracked`);
    } catch (error) {
      operationStepDetail("sync PR records", `seeding failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    operationStep("save point", "hard save point — session handoff");
    const savePoint = await boundarySavePoint(paths, "ship", `handoff ${stringValue(baseline.baseSha).slice(0, 10)}`);
    if (savePoint) operationStepDetail("save point", `ship save point at ${stringValue(asObject(savePoint).commitSha).slice(0, 10) || "HEAD"}`);

    return {
      prepared: true,
      project: paths.project ? projectToSummary(paths.project) : null,
      blockedAt: null,
      runId,
      pause,
      prRecords,
      savePoint,
      gitSync: { beforeRef: gitSync.beforeRef, afterRef: gitSync.afterRef, branch: gitSync.branch, mergedPrs: gitSync.mergedPrs },
      baseline,
      reworkSymbols,
      requeued,
      branchVerdict,
      checkpoint,
      qa,
      qaRepair,
      splitPlan: finalSplitPlan,
      ship,
    };
  });
}

async function runReportNow(body: JsonObject): Promise<JsonObject> {
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const repoRoot = paths.repoRoot;
  const resetBaseline = boolValue(body.resetBaseline);
  appendLog("ui", `report-run${resetBaseline ? " --reset-baseline" : ""} started`);
  const result = await forceReportRun(repoRoot, { resetBaseline });
  appendLog("ui", `report-run${resetBaseline ? " --reset-baseline" : ""} complete`);
  return { project: paths.project ? projectToSummary(paths.project) : null, ...compactReportRunResult(result) };
}

async function freshRun(body: JsonObject): Promise<JsonObject> {
  if (freshRunActive) {
    throw new Error("Fresh Run is already running. Wait for it to finish before starting another one.");
  }
  freshRunActive = true;
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  try {
    const name = processName(paths.project?.processName ?? stringValue(body.processName, "melee-live"));
    const activeManaged = managed?.state === "running" || managed?.state === "stopping" || managed?.state === "draining";
    const activeSaved = savedProcessRecords(stateDir).find((record) => record.alive === true);
    if (activeManaged || activeSaved) {
      const activeName = stringValue(activeSaved?.name, managed?.name ?? name);
      throw new Error(`Stop the active process (${activeName}) before starting a fresh run.`);
    }
    const prBlockers = activeSessionPrBlockers(stateDir);
    if (prBlockers.length > 0) {
      throw new Error(`Resolve this session's PR work before starting a fresh run: ${prBlockers.slice(0, 6).join("; ")}${prBlockers.length > 6 ? `; +${prBlockers.length - 6} more` : ""}`);
    }

    const steps: FreshRunStep[] = [];
    const resetReportBaseline = body.resetReportBaseline !== false;
    const refreshPrLibrary = body.refreshPrLibrary !== false;
    const checkpointBeforeFresh = body.checkpointBeforeFresh !== false;
    let reportRunResult: JsonObject | null = null;
    let checkpointResult: JsonObject | null = null;
    beginOperation("fresh", "New Session", ["checkpoint", "reset report baseline", "init run", "report against new baseline", "refresh PR library", "save point"]);

    if (checkpointBeforeFresh) {
      const runId = stringValue(body.runId) || latestRunId(stateDir);
      if (runId) {
        operationStep("checkpoint", `run ${runId}`);
        appendLog("ui", `fresh checkpoint started for run ${runId}`);
        const store = openState(stateDir);
        try {
          checkpointResult = compactCheckpointResult(
            createRunCheckpoint(store, runId, {
              improvementPromotion: {
                minGainPoints: paths.project?.pr.improvementMinGainPoints,
                minMatchedBytes: paths.project?.pr.improvementMinMatchedBytes,
              },
              title: "Fresh run checkpoint",
            }),
          );
        } finally {
          store.db.close();
        }
        appendLog("ui", `fresh checkpoint complete for run ${runId}`);
      }
    }

    if (resetReportBaseline) {
      operationStep("reset report baseline");
      appendLog("ui", "fresh report start reset started");
      reportRunResult = compactReportRunResult(await forceReportRun(repoRoot, { generateChanges: false, resetBaseline: true }));
      appendLog("ui", "fresh report start reset complete");
    }

    operationStep("init run");
    const init = initRunCommand({ ...body, repoRoot, stateDir });
    await runFreshStep(steps, "init-run", init.command, packageRoot);

    if (resetReportBaseline) {
      operationStep("report against new baseline");
      appendLog("ui", "fresh report changes started");
      reportRunResult = compactReportRunResult(await forceReportRun(repoRoot, { resetBaseline: false }));
      appendLog("ui", "fresh report changes complete");
    }

    if (refreshPrLibrary) {
      operationStep("refresh PR library");
      await runFreshStep(
        steps,
        "refresh PR library",
        [
          "python3",
          resolve(packageRoot, "knowledge/sources/code_context/past_prs/commands/sync_repo_and_pr_library.py"),
          "--skip-git",
          "--pr-activity",
          "updated",
          "--refresh-existing-prs",
          "--postmortem-mode",
          boolValue(body.dryRunAgents) ? "scaffold" : "pi",
          "--postmortem-scope",
          "fetched",
          "--postmortem-jobs",
          "16",
        ],
        packageRoot,
      );
    }
    operationStep("save point");
    const savePoint = await boundarySavePoint(paths, "fresh");
    endOperation();
    return {
      fresh: true,
      project: paths.project ? projectToSummary(paths.project) : null,
      repoRoot,
      stateDir,
      refreshPrLibrary,
      resetReportBaseline,
      checkpointBeforeFresh,
      checkpoint: checkpointResult,
      reportRun: reportRunResult,
      savePoint,
      steps,
    };
  } catch (error) {
    endOperation(error);
    throw error;
  } finally {
    freshRunActive = false;
  }
}

// Fetch the newly merged PR dumps, run the intake (postmortem) agents, and
// rebuild the knowledge graph. Shared by Sync Merged PRs and Prepare Handoff
// so pulled PRs are always indexed before work continues on the new base.
async function runMergedPrIntakeAndKnowledge(paths: DashboardProjectContext, mergedPrs: number[], dryRunAgents: boolean): Promise<JsonObject[]> {
  const command = [
    "python3",
    resolve(packageRoot, "knowledge/sources/code_context/past_prs/commands/fetch_recent_pr_dump.py"),
    "--repo",
    "doldecomp/melee",
    "--refresh-existing",
    "--postmortem-mode",
    dryRunAgents ? "scaffold" : "pi",
    "--postmortem-scope",
    "fetched",
    "--postmortem-rerun-existing",
    "--postmortem-jobs",
    "16",
    "--fetch-jobs",
    String(Math.min(16, Math.max(1, mergedPrs.length))),
  ];
  for (const number of mergedPrs) command.push("--pr", String(number));

  appendLog("ui", `merged PR intake started for ${mergedPrs.length} PR(s)`);
  operationStep("PR intake agents", mergedPrs.map((number) => `#${number}`).join(", "));
  const intakeResult = await runCli(command, packageRoot);
  appendLog("ui", `merged PR intake ${intakeResult.exitCode === 0 ? "complete" : "failed"}`);
  if (intakeResult.exitCode !== 0) {
    throw new Error(`Merged PR intake failed (${intakeResult.exitCode}): ${outputTail(intakeResult.stderr || intakeResult.stdout, 4000)}`);
  }

  const graphCommand = [
    ...cliPrefix(paths),
    "kg-maintain",
    "--graph-db",
    paths.graphDbPath,
    "--no-pr-index",
    "--no-tool-runners",
    "--no-tool-index",
  ];
  appendLog("ui", "knowledge graph rebuild started");
  operationStep("knowledge graph rebuild");
  const graphResult = await runCli(graphCommand, packageRoot);
  appendLog("ui", `knowledge graph rebuild ${graphResult.exitCode === 0 ? "complete" : "failed"}`);
  if (graphResult.exitCode !== 0) {
    throw new Error(`Knowledge graph rebuild failed (${graphResult.exitCode}): ${outputTail(graphResult.stderr || graphResult.stdout, 4000)}`);
  }
  return [
    {
      name: "fetch_merged_prs_and_run_intake_agents",
      command,
      exitCode: intakeResult.exitCode,
      stdout: outputTail(intakeResult.stdout, 4000),
      stderr: outputTail(intakeResult.stderr, 4000),
    },
    {
      name: "rebuild_knowledge_graph",
      command: graphCommand,
      exitCode: graphResult.exitCode,
      stdout: outputTail(graphResult.stdout, 4000),
      stderr: outputTail(graphResult.stderr, 4000),
    },
  ];
}

async function syncProjectIntake(body: JsonObject): Promise<JsonObject> {
  if (projectSyncActive) {
    throw new Error("Fetch & Re-sync is already running. Wait for it to finish before starting another sync.");
  }
  projectSyncActive = true;
  const paths = resolveDashboardProject(body, { useDefaultProject: true });
  const { repoRoot, stateDir } = paths;
  beginOperation("sync", "Sync Merged PRs", ["pull upstream & find merged PRs", "PR intake agents", "knowledge graph rebuild", "save point"]);
  try {
    const activeManaged = managed?.state === "running" || managed?.state === "stopping" || managed?.state === "draining";
    const activeSaved = savedProcessRecords(stateDir).find((record) => record.alive === true);
    if (activeManaged || activeSaved) {
      const activeName = stringValue(activeSaved?.name, managed?.name ?? paths.project?.processName ?? "melee-live");
      throw new Error(`Stop the active process (${activeName}) before fetching and re-syncing.`);
    }
    const runId = latestRunId(stateDir);
    if (runId) {
      const store = openState(stateDir);
      try {
        const run = getRun(store, runId);
        if (run && run.status === "active") {
          throw new Error(
            `Run ${run.id} is active. Sync is hard-locked while a run is active because pulling upstream invalidates the run baseline. Pause intake (PR handoff) or complete the run first.`,
          );
        }
      } finally {
        store.db.close();
      }
    }

    operationStep("pull upstream & find merged PRs");
    const gitSync = await syncProjectGitAndFindMergedPrs(paths);
    if (gitSync.mergedPrs.length === 0) {
      appendLog("ui", "merged PR intake skipped: no newly merged PRs found after git sync");
      operationStep("save point", "no newly merged PRs; intake skipped");
      const skippedSavePoint = await boundarySavePoint(paths, "sync", `sync ${gitSync.afterRef ?? ""}`.trim());
      endOperation();
      return {
        synced: true,
        skippedIntake: true,
        savePoint: skippedSavePoint,
        reason: "no_newly_merged_prs",
        project: paths.project ? projectToSummary(paths.project) : null,
        repoRoot,
        stateDir,
        beforeRef: gitSync.beforeRef,
        afterRef: gitSync.afterRef,
        branch: gitSync.branch,
        mergedPrs: [],
        steps: gitSync.steps,
        createdAt: new Date().toISOString(),
      };
    }

    const intakeSteps = await runMergedPrIntakeAndKnowledge(paths, gitSync.mergedPrs, boolValue(body.dryRunAgents));
    operationStep("save point");
    const syncSavePoint = await boundarySavePoint(paths, "sync", `sync ${gitSync.afterRef ?? ""}`.trim());
    endOperation();
    return {
      synced: true,
      savePoint: syncSavePoint,
      project: paths.project ? projectToSummary(paths.project) : null,
      repoRoot,
      stateDir,
      beforeRef: gitSync.beforeRef,
      afterRef: gitSync.afterRef,
      branch: gitSync.branch,
      mergedPrs: gitSync.mergedPrs,
      steps: [...gitSync.steps, ...intakeSteps],
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    endOperation(error);
    throw error;
  } finally {
    projectSyncActive = false;
  }
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/config") {
    const selectedProject = defaultProject();
    const projects = availableProjects();
    return json({
      packageRoot,
      defaultRepoRoot: selectedProject?.repoRoot ?? defaultRepoRoot,
      defaultStateDir: selectedProject?.stateDir ?? defaultStateDir,
      defaultGraphDbPath: selectedProject?.graphDbPath ?? resolve(defaultStateDir, "knowledge-graph.sqlite"),
      defaultProjectId: selectedProject?.projectId ?? "",
      selectedProject: selectedProject ? projectToSummary(selectedProject) : null,
      availableProjects: projects,
      projectDefaults: projectDefaults(selectedProject),
      port,
      hotReload: hotReloadEnabled,
      dashboardStreamIntervalMs,
    });
  }
  if (url.pathname === "/api/dev-events") return hotReloadEvents();
  if (url.pathname === "/api/dashboard/events") return dashboardEvents(url);
  if (url.pathname === "/api/dashboard") {
    const paths = requestPaths(url, { useDefaultProject: true });
    return json(await runDashboard(paths));
  }
  if (url.pathname === "/api/run/details") {
    const paths = requestPaths(url, { useDefaultProject: true });
    return json(runDetails(paths.stateDir, url.searchParams.get("runId") || "", paths.project));
  }
  if (url.pathname === "/api/standards") {
    const paths = requestPaths(url, { useDefaultProject: true });
    if (req.method === "POST") {
      const body = asObject(await req.json().catch(() => ({})));
      return json(applyStandardEdit(asObject(body.edit) as unknown as StandardEdit));
    }
    return json(loadStandardsPayload(paths.project));
  }
  if (url.pathname === "/api/process") {
    const paths = requestPaths(url, { useDefaultProject: true });
    return json(processStatus(paths.stateDir, paths.project));
  }
  if (url.pathname === "/api/project/sync" && req.method === "POST") {
    return json(await syncProjectIntake(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/process/start" && req.method === "POST") {
    const body = asObject(await req.json().catch(() => ({})));
    if (managed?.state === "running" || managed?.state === "stopping" || managed?.state === "draining") {
      return json({ error: "process already running", process: processStatus() }, { status: 409 });
    }
    const { command, name, stateDir, project } = commandFromBody(body);
    const runId = stringValue(body.runId) || latestRunId(stateDir);
    if (runId) {
      const requestedWorkers = dashboardScheduling(body.maxWorkers).maxWorkers;
      const store = openState(stateDir);
      try {
        const run = getRun(store, runId);
        if (run && run.status !== "active") {
          return json({ error: `Run ${run.id} is ${run.status}; resume it before starting workers.`, run, process: processStatus(stateDir, project) }, { status: 409 });
        }
        // The worker pool clamps --max-workers to the run's desired_workers, so
        // align the run record with the requested size before spawning.
        if (run && run.desiredWorkers !== requestedWorkers) {
          setRunDesiredWorkers(store, run.id, requestedWorkers, "dashboard");
          appendLog("ui", `run ${run.id} desired_workers ${run.desiredWorkers} -> ${requestedWorkers}`);
        }
      } finally {
        store.db.close();
      }
    }
    managed = spawnManaged(command, stateDir, name, project);
    return json({ started: true, project: project ? projectToSummary(project) : null, command, process: processStatus(stateDir, project) });
  }
  if (url.pathname === "/api/process/stop" && req.method === "POST") {
    return json(await stopManaged(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/process/drain" && req.method === "POST") {
    return json(await drainManaged(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/pause" && req.method === "POST") {
    return json(await pauseRunForPr(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/resume" && req.method === "POST") {
    return json(resumeRunForPr(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/run/checkpoint" && req.method === "POST") {
    return json(await checkpointRunForPr(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/qa" && req.method === "POST") {
    return json(await runPrQa(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/qa-repair" && req.method === "POST") {
    return json(await runQaRepairForPr(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/sync" && req.method === "POST") {
    return json(await syncPrRecords(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/review-state" && req.method === "POST") {
    return json(await setPrReviewState(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/prepare-local" && req.method === "POST") {
    return json(await prepareLocalPr(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/prepare-local-batch" && req.method === "POST") {
    return json(await prepareLocalPrBatch(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/open" && req.method === "POST") {
    return json(await openPrForSlice(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/open-batch" && req.method === "POST") {
    return json(await openNextDraftBatch(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/prs/open-all" && req.method === "POST") {
    return json(await openAllPlannedPrs(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/split-plan" && req.method === "POST") {
    return json(await runPrSplitPlan(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/reconcile" && req.method === "POST") {
    return json(await runReconcile(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/save-point" && req.method === "POST") {
    return json(await createSavePoint(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/pr/prepare" && req.method === "POST") {
    return json(await preparePrHandoff(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/run/init" && req.method === "POST") {
    return json(await initRun(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/run/fresh" && req.method === "POST") {
    return json(await freshRun(asObject(await req.json().catch(() => ({})))));
  }
  if (url.pathname === "/api/report/run" && req.method === "POST") {
    return json(await runReportNow(asObject(await req.json().catch(() => ({})))));
  }
  return json({ error: "not found" }, { status: 404 });
}

function staticResponse(pathname: string): Response {
  const appRoot = existsSync(resolve(builtStaticRoot, "index.html")) ? builtStaticRoot : staticRoot;
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const path = resolve(appRoot, file);
  if (!path.startsWith(appRoot)) return text("Not found", { status: 404 });
  if (!existsSync(path)) {
    const fallback = resolve(appRoot, "index.html");
    if (existsSync(fallback)) return staticFile(fallback);
    return text("Not found", { status: 404 });
  }
  return staticFile(path);
}

export async function fetchDashboardServer(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, url);
    return staticResponse(url.pathname);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export function serveDashboardServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    fetch: fetchDashboardServer,
  });
  console.log(`decomp-orchestrator UI listening on http://localhost:${port}${hotReloadEnabled ? " (hot reload enabled)" : ""}`);
  return server;
}

if (import.meta.main) serveDashboardServer();
