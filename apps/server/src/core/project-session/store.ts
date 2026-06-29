import type { Database } from "bun:sqlite";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  createProjectSessionRecord,
  defaultKernelTraceState,
  normalizeCompleteState,
  normalizeKernelTraceState,
  normalizePreparingState,
  normalizePrState,
  normalizeProcessState,
  normalizeRunningState,
  projectSessionView,
} from "./state.js";
import type {
  CreateProjectSessionInput,
  ProjectSessionPatch,
  ProjectSessionRecord,
  ProjectSessionView,
} from "./types.js";
import { newProjectSessionId, newProjectSessionUuid } from "./identity.js";
import { createOrchestratorStateOrm, immediateTransaction, now as currentTime } from "@server/core/orchestrator-state";
import { projectSessions, type ProjectSessionRow } from "@server/core/orchestrator-state/storage/schema";

type Row = ProjectSessionRow;
type SqlValue = string | number | bigint | boolean | null | Uint8Array;

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function parseJson(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function rowToProjectSession(row: Row): ProjectSessionRecord {
  const now = stringValue(row.updatedAt, currentTime());
  const projectId = stringValue(row.projectId);
  const sessionUuid = stringValue(row.sessionUuid);
  return {
    id: row.id,
    project_id: projectId,
    session_uuid: sessionUuid,
    status: row.status,
    phase: row.phase,
    active_run_id: nullableString(row.activeRunId),
    base_ref: nullableString(row.baseRef),
    base_sha: nullableString(row.baseSha),
    preparing_state_json: normalizePreparingState(parseJson(row.preparingStateJson), now),
    running_state_json: normalizeRunningState(parseJson(row.runningStateJson)),
    pr_state_json: normalizePrState(parseJson(row.prStateJson)),
    complete_state_json: normalizeCompleteState(parseJson(row.completeStateJson)),
    process_state_json: normalizeProcessState(parseJson(row.processStateJson), projectId, sessionUuid, now),
    kernel_trace_json: normalizeKernelTraceState(parseJson(row.kernelTraceJson), sessionUuid),
    created_at: stringValue(row.createdAt, now),
    updated_at: now,
    completed_at: nullableString(row.completedAt),
  };
}

export function insertProjectSession(db: Database, record: ProjectSessionRecord): ProjectSessionRecord {
  createOrchestratorStateOrm(db)
    .insert(projectSessions)
    .values({
      id: record.id,
      projectId: record.project_id,
      sessionUuid: record.session_uuid,
      status: record.status,
      phase: record.phase,
      activeRunId: record.active_run_id,
      baseRef: record.base_ref,
      baseSha: record.base_sha,
      preparingStateJson: record.preparing_state_json,
      runningStateJson: record.running_state_json,
      prStateJson: record.pr_state_json,
      completeStateJson: record.complete_state_json,
      processStateJson: record.process_state_json ?? {},
      kernelTraceJson: record.kernel_trace_json ?? defaultKernelTraceState(record.session_uuid),
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      completedAt: record.completed_at,
    })
    .run();
  return record;
}

export function createProjectSession(db: Database, input: CreateProjectSessionInput): ProjectSessionRecord {
  const at = input.now ?? currentTime();
  const sessionUuid = input.sessionUuid ?? newProjectSessionUuid();
  const id = input.id ?? newProjectSessionId(sessionUuid);
  const record = createProjectSessionRecord({
    ...input,
    id,
    now: at,
    sessionUuid,
  });
  return immediateTransaction(db, () => insertProjectSession(db, record));
}

export function getProjectSessionById(db: Database, id: string): ProjectSessionRecord | null {
  const row = createOrchestratorStateOrm(db).select().from(projectSessions).where(eq(projectSessions.id, id)).get();
  return row ? rowToProjectSession(row) : null;
}

export function getProjectSessionByUuid(db: Database, sessionUuid: string): ProjectSessionRecord | null {
  const row = createOrchestratorStateOrm(db).select().from(projectSessions).where(eq(projectSessions.sessionUuid, sessionUuid)).get();
  return row ? rowToProjectSession(row) : null;
}

export function getActiveProjectSession(db: Database, projectId: string): ProjectSessionRecord | null {
  const row = createOrchestratorStateOrm(db)
    .select()
    .from(projectSessions)
    .where(and(eq(projectSessions.projectId, projectId), inArray(projectSessions.status, ["active", "blocked"])))
    .orderBy(desc(projectSessions.createdAt))
    .limit(1)
    .get();
  return row ? rowToProjectSession(row) : null;
}

export function getOrCreateActiveProjectSession(db: Database, input: CreateProjectSessionInput): ProjectSessionRecord {
  const active = getActiveProjectSession(db, input.projectId);
  if (active) return active;
  return createProjectSession(db, input);
}

export function listProjectSessions(db: Database, projectId: string, limit = 20): ProjectSessionRecord[] {
  return createOrchestratorStateOrm(db)
    .select()
    .from(projectSessions)
    .where(eq(projectSessions.projectId, projectId))
    .orderBy(desc(projectSessions.createdAt))
    .limit(Math.max(1, Math.trunc(limit)))
    .all()
    .map(rowToProjectSession);
}

export function updateProjectSession(db: Database, id: string, patch: ProjectSessionPatch, at = currentTime()): ProjectSessionRecord {
  const current = getProjectSessionById(db, id);
  if (!current) throw new Error(`Project session not found: ${id}`);
  const next: ProjectSessionRecord = {
    ...current,
    status: patch.status ?? current.status,
    phase: patch.phase ?? current.phase,
    active_run_id: patch.active_run_id === undefined ? current.active_run_id : patch.active_run_id,
    base_ref: patch.base_ref === undefined ? current.base_ref : patch.base_ref,
    base_sha: patch.base_sha === undefined ? current.base_sha : patch.base_sha,
    preparing_state_json: patch.preparing_state_json ?? current.preparing_state_json,
    running_state_json: patch.running_state_json ?? current.running_state_json,
    pr_state_json: patch.pr_state_json ?? current.pr_state_json,
    complete_state_json: patch.complete_state_json ?? current.complete_state_json,
    process_state_json: patch.process_state_json === undefined ? current.process_state_json : patch.process_state_json,
    kernel_trace_json: patch.kernel_trace_json === undefined ? current.kernel_trace_json : patch.kernel_trace_json,
    completed_at: patch.completed_at === undefined ? current.completed_at : patch.completed_at,
    updated_at: at,
  };

  immediateTransaction(db, () => {
    createOrchestratorStateOrm(db)
      .update(projectSessions)
      .set({
        status: next.status,
        phase: next.phase,
        activeRunId: next.active_run_id,
        baseRef: next.base_ref,
        baseSha: next.base_sha,
        preparingStateJson: next.preparing_state_json,
        runningStateJson: next.running_state_json,
        prStateJson: next.pr_state_json,
        completeStateJson: next.complete_state_json,
        processStateJson: next.process_state_json ?? {},
        kernelTraceJson: next.kernel_trace_json ?? defaultKernelTraceState(next.session_uuid),
        updatedAt: next.updated_at,
        completedAt: next.completed_at,
      })
      .where(eq(projectSessions.id, next.id))
      .run();
  });
  const saved = getProjectSessionById(db, id);
  if (!saved) throw new Error(`Project session disappeared after update: ${id}`);
  return saved;
}

export function updateProjectSessionWith(db: Database, id: string, updater: (record: ProjectSessionRecord, now: string) => ProjectSessionPatch, at = currentTime()): ProjectSessionRecord {
  const current = getProjectSessionById(db, id);
  if (!current) throw new Error(`Project session not found: ${id}`);
  return updateProjectSession(db, id, updater(current, at), at);
}

export function projectSessionProjection(record: ProjectSessionRecord | null): ProjectSessionView | null {
  return record ? projectSessionView(record) : null;
}

export function activeProjectSessionProjection(db: Database, projectId: string): ProjectSessionView | null {
  return projectSessionProjection(getActiveProjectSession(db, projectId));
}

export function bindProjectSessionProcess(db: Database, sessionId: string, processState: ProjectSessionPatch["process_state_json"]): ProjectSessionRecord {
  return updateProjectSession(db, sessionId, { process_state_json: processState });
}

export function getProjectSessionBySelector(db: Database, selector: { id?: string | null; sessionUuid?: string | null; projectId?: string | null }): ProjectSessionRecord | null {
  if (selector.id) {
    const byId = getProjectSessionById(db, selector.id);
    if (byId) return byId;
  }
  if (selector.sessionUuid) {
    const byUuid = getProjectSessionByUuid(db, selector.sessionUuid);
    if (byUuid) return byUuid;
  }
  if (selector.projectId) return getActiveProjectSession(db, selector.projectId);
  return null;
}

export function assertNoTopLevelSubphase(row: ProjectSessionRecord | Row): void {
  if ("active_subphase" in row || "subphase" in row) {
    throw new Error("Project session storage must not use a top-level canonical subphase");
  }
}

export function sqlBindings(values: SqlValue[]): SqlValue[] {
  return values;
}
