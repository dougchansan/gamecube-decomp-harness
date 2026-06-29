import type {
  AgentRun as KernelAgentRun,
  Container as KernelContainer,
  KernelTraceReadIdentity,
  KernelTraceReadOptions,
  KernelTraceReadRows,
  PiAgentSessionWithEventCount,
  TraceEventRow as KernelTraceEventRow,
} from "@agent-kernel/db";
import { getKernelTraceReadRows } from "@agent-kernel/db";
import type {
  KernelTraceReadQuery,
  KernelTraceReadService,
} from "@agent-kernel/kernel/read-api";
import type {
  AgentRun,
  JsonObject,
  KernelContainerSummary,
  KernelTraceSessionDetail,
  KernelTraceSessionListResponse,
  KernelTraceSessionSummary,
  PiSessionWithCount,
  TraceEventRow,
  TraceSessionMeta,
} from "@agent-kernel/viewer-core";

export type KernelTraceRowsReader = (
  identity: KernelTraceReadIdentity,
  options: KernelTraceReadOptions,
) => Promise<KernelTraceReadRows | undefined>;

export type KernelTraceRowsLister = (
  query: KernelTraceReadQuery,
) => Promise<KernelTraceReadRows[]>;

export type KernelTraceIdentityResolver = (
  id: string,
) => KernelTraceReadIdentity | Promise<KernelTraceReadIdentity>;

export interface CreateDbKernelTraceRowsReaderOptions {
  db: unknown;
  readRows?: typeof getKernelTraceReadRows;
}

export interface CreateMeleeKernelTraceReadServiceOptions {
  readRows: KernelTraceRowsReader;
  listRows?: KernelTraceRowsLister;
  resolveIdentity?: KernelTraceIdentityResolver;
}

function asJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function stringMeta(metadata: JsonObject, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function latestTimestamp(rows: Array<{ timestamp?: string | null }>): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (!row.timestamp) continue;
    if (latest === null || row.timestamp > latest) latest = row.timestamp;
  }
  return latest;
}

export function createDbKernelTraceRowsReader({
  db,
  readRows = getKernelTraceReadRows,
}: CreateDbKernelTraceRowsReaderOptions): KernelTraceRowsReader {
  return (identity, options) => readRows(db, identity, options);
}

export function defaultKernelTraceIdentityResolver(id: string): KernelTraceReadIdentity {
  return { containerId: id };
}

export function toKernelContainerSummary(container: KernelContainer): KernelContainerSummary {
  return {
    id: container.id,
    parentContainerId: container.parentContainerId,
    label: container.label,
    status: container.status,
    workingDir: container.workingDir,
    worktreePath: container.worktreePath,
    phase: container.phase,
    phaseVocabulary: container.phaseVocabulary,
    metadata: asJsonObject(container.metadata),
    startedAt: container.startedAt,
    completedAt: container.completedAt,
    createdAt: container.createdAt,
    updatedAt: container.updatedAt,
  };
}

export function toPiSessionWithCount(session: PiAgentSessionWithEventCount): PiSessionWithCount {
  return {
    id: session.id,
    appSessionId: session.appSessionId,
    parentId: session.parentId,
    agentName: session.agentName,
    model: session.model ?? "unknown",
    status: session.status,
    phase: session.phase,
    containerId: session.containerId,
    displayLabel: session.displayLabel,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    eventCount: session.eventCount,
  };
}

export function toAgentRun(run: KernelAgentRun): AgentRun {
  return {
    id: run.id,
    piSessionId: run.piSessionId,
    runNumber: run.runNumber,
    agentName: run.agentName,
    status: run.status,
    parentRunId: run.parentRunId,
    containerId: run.containerId,
    phase: run.phase,
    displayLabel: run.displayLabel,
    parentToolUseId: run.parentToolUseId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function toTraceEventRow(row: KernelTraceEventRow): TraceEventRow {
  return {
    id: row.id,
    eventId: row.id,
    appSessionId: row.appSessionId,
    containerId: row.containerId,
    userId: row.userId,
    type: row.type,
    source: row.source,
    traceLevel: row.traceLevel,
    eventData: row.eventData as TraceEventRow["eventData"],
    spanId: row.spanId,
    parentEventId: row.parentEventId,
    timestamp: row.timestamp,
    piSessionId: row.piSessionId,
    agentId: null,
  };
}

export function toTraceSessionMeta(rows: KernelTraceReadRows): TraceSessionMeta {
  const root = rows.rootContainer;
  const metadata = asJsonObject(root.metadata);
  const appSessionId =
    stringMeta(metadata, "appSessionId") ??
    rows.events[0]?.appSessionId ??
    rows.piSessions[0]?.appSessionId ??
    root.id;

  return {
    id: appSessionId,
    containerId: root.id,
    appSessionSlug:
      stringMeta(metadata, "appSessionSlug") ??
      stringMeta(metadata, "sessionId") ??
      root.id,
    topic: stringMeta(metadata, "topic") ?? root.label,
    status: root.status,
    appSessionType: stringMeta(metadata, "appSessionType") ?? "melee-project-session",
    createdAt: root.createdAt,
    updatedAt: root.updatedAt,
  };
}

export function toKernelTraceSessionDetail(
  rows: KernelTraceReadRows,
): KernelTraceSessionDetail {
  return {
    session: toTraceSessionMeta(rows),
    container: toKernelContainerSummary(rows.rootContainer),
    containers: rows.containers.map(toKernelContainerSummary),
    pi_sessions: rows.piSessions.map(toPiSessionWithCount),
    agent_runs: rows.agentRuns.map(toAgentRun),
    events: rows.events.map(toTraceEventRow),
  };
}

export function toKernelTraceSessionSummary(
  rows: KernelTraceReadRows,
): KernelTraceSessionSummary {
  const detail = toKernelTraceSessionDetail(rows);
  const root = detail.container ?? toKernelContainerSummary(rows.rootContainer);
  return {
    id: detail.session.id,
    containerId: root.id,
    label: root.label,
    appSessionSlug: detail.session.appSessionSlug,
    topic: detail.session.topic,
    status: detail.session.status,
    appSessionType: detail.session.appSessionType,
    phase: root.phase ?? null,
    createdAt: detail.session.createdAt,
    updatedAt: detail.session.updatedAt,
    piSessionCount: detail.pi_sessions.length,
    eventCount: detail.events.length,
    latestEventAt: latestTimestamp(detail.events),
    metadata: root.metadata,
  };
}

export function createMeleeKernelTraceReadService({
  readRows,
  listRows,
  resolveIdentity = defaultKernelTraceIdentityResolver,
}: CreateMeleeKernelTraceReadServiceOptions): KernelTraceReadService {
  return {
    ...(listRows
      ? {
          async listTraceSessions(query): Promise<KernelTraceSessionListResponse> {
            const rows = await listRows(query);
            return {
              trace_sessions: rows.map(toKernelTraceSessionSummary),
              unlinked: null,
            };
          },
        }
      : {}),
    async getTraceSessionDetail(id, query) {
      const identity = await resolveIdentity(id);
      const rows = await readRows(identity, {
        after: query.after,
        limit: query.limit,
      });
      return rows ? toKernelTraceSessionDetail(rows) : null;
    },
    async getContainerTrace(containerId, query) {
      const rows = await readRows(
        { containerId },
        {
          after: query.after,
          limit: query.limit,
        },
      );
      return rows ? toKernelTraceSessionDetail(rows) : null;
    },
  };
}
