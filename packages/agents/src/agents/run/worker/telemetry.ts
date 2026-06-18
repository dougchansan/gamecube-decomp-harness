/**
 * Runner-owned worker telemetry artifacts.
 *
 * Two append-only JSONL files live under worker_logs/<lease_id>/ so the
 * dashboard can observe an active lease before the final report row exists:
 *
 * - activity.jsonl: lifecycle timeline (attempt started, gate evaluated,
 *   runner validation result, repair requested, report recorded).
 * - tool_events.jsonl: one record per Pi custom tool invocation.
 *
 * The runner writes these from authoritative state (DB lease id, validation
 * results); model output is only ever quoted as descriptive context.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const WORKER_ACTIVITY_LOG = "activity.jsonl";
export const WORKER_TOOL_EVENTS_LOG = "tool_events.jsonl";

export interface WorkerActivityEvent {
  lease_id: string;
  session_id?: string;
  attempt_index?: number;
  phase: string;
  event_type: string;
  unit?: string;
  symbol?: string;
  summary: string;
  score?: {
    before: number | null;
    after: number | null;
    exact: boolean;
  };
  artifact_path?: string;
  [key: string]: unknown;
}

export interface WorkerToolEvent {
  lease_id?: string;
  attempt_index?: number;
  tool: string;
  params?: unknown;
  status: "ok" | "tool_error" | "threw";
  exit_code?: number | null;
  error_kind?: string;
  error_summary?: string;
  duration_ms: number;
  [key: string]: unknown;
}

function appendJsonLine(workerLogDir: string, fileName: string, record: Record<string, unknown>): void {
  try {
    mkdirSync(workerLogDir, { recursive: true });
    appendFileSync(resolve(workerLogDir, fileName), `${JSON.stringify({ ...record, created_at: new Date().toISOString() })}\n`);
  } catch {
    // Telemetry must never take down the worker loop; the canonical report and
    // validation artifacts are written elsewhere.
  }
}

export function appendWorkerActivityEvent(workerLogDir: string, event: WorkerActivityEvent): void {
  appendJsonLine(workerLogDir, WORKER_ACTIVITY_LOG, event);
}

export function appendWorkerToolEvent(workerLogDir: string, event: WorkerToolEvent): void {
  appendJsonLine(workerLogDir, WORKER_TOOL_EVENTS_LOG, event);
}

/** Bound a tool param/result payload before persisting it in telemetry. */
export function boundedTelemetryValue(value: unknown, maxChars = 2000): unknown {
  if (value == null) return value;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return value;
  return `${text.slice(0, maxChars)}…<truncated ${text.length - maxChars} chars>`;
}
