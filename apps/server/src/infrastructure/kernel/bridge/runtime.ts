import {
  getKernelTraceReadRows,
  upsertAgentRun as defaultUpsertAgentRun,
  insertTraceEventsBatch as defaultInsertTraceEventsBatch,
  upsertPiAgentSession as defaultUpsertPiAgentSession,
  upsertContainer as defaultUpsertContainer,
  type AgentRun,
  type Container,
  type KernelRegistration,
  type KernelTraceReadIdentity,
  type KernelTraceReadRows,
  type NewAgentRun,
  type NewContainer,
  type NewPiAgentSession,
  type PiAgentSession,
} from "@agent-kernel/db";
import * as schema from "@agent-kernel/db/schema";
import { createKernelTraceReadApi } from "@agent-kernel/kernel/read-api";
import type { TraceEvent } from "@agent-kernel/protocol";
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";

import {
  createColosseumKernelBridgeConfig,
  type CreateColosseumKernelBridgeConfigInput,
  type ColosseumKernelBridgeConfig,
} from "./config.js";
import {
  ensureKernelObservabilitySchema,
  DEFAULT_AGENT_KERNEL_DATABASE_URL,
  colosseumKernelDatabaseUrlFromEnv,
  colosseumKernelRuntimeRequiredFromEnv,
  openColosseumKernelDatabase,
  type ColosseumKernelDatabaseHandle,
  type OpenColosseumKernelDatabaseOptions,
} from "./database.js";
import type { ColosseumKernelSpawnContext } from "./kernel.js";
import {
  createDbKernelTraceRowsReader,
  createColosseumKernelTraceReadService,
  type KernelTraceRowsLister,
  type KernelTraceRowsReader,
  type KernelTraceIdentityResolver,
} from "./read-api.js";
import {
  upsertColosseumKernelRegistration,
  type KernelRegistrationUpsertPort,
} from "./registration.js";
import {
  createColosseumTraceTailer,
  type CreateColosseumTraceTailerOptions,
  type ColosseumTraceTailer,
  type ColosseumTraceTailerStatus,
} from "./tailer.js";
import {
  createColosseumTraceWriter,
  type ColosseumTraceWriter,
} from "./trace-writer.js";

export type ContainerUpsertPort = (
  db: unknown,
  data: NewContainer,
) => Promise<Container | NewContainer>;

export type TraceEventsInsertPort = (
  db: unknown,
  events: TraceEvent[],
) => Promise<number>;

export type PiAgentSessionUpsertPort = (
  db: unknown,
  data: NewPiAgentSession,
) => Promise<PiAgentSession | NewPiAgentSession>;

export type AgentRunUpsertPort = (
  db: unknown,
  data: NewAgentRun,
) => Promise<AgentRun | NewAgentRun>;

export interface ColosseumKernelRuntime {
  config: ColosseumKernelBridgeConfig;
  databaseUrl: string | null;
  db: unknown;
  registration: KernelRegistration | null;
  readApi: ReturnType<typeof createKernelTraceReadApi>;
  readRows: KernelTraceRowsReader;
  traceWriter: ColosseumTraceWriter;
  upsertSpawnContainers: (context: ColosseumKernelSpawnContext) => Promise<void>;
  startTraceTailer: () => Promise<void>;
  flushTraceTailer: () => Promise<void>;
  stopTraceTailer: () => Promise<void>;
  traceTailerStatus: () => ColosseumTraceTailerStatus | null;
  close: () => Promise<void>;
}

export interface CreateColosseumKernelRuntimeOptions {
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig;
  database?: OpenColosseumKernelDatabaseOptions;
  db?: unknown;
  closeDatabase?: () => Promise<void>;
  ensureSchema?: boolean;
  ensureSchemaWith?: (db: unknown) => Promise<void>;
  register?: boolean;
  upsertRegistration?: KernelRegistrationUpsertPort;
  upsertContainer?: ContainerUpsertPort;
  insertTraceEvents?: TraceEventsInsertPort;
  upsertPiAgentSession?: PiAgentSessionUpsertPort;
  upsertAgentRun?: AgentRunUpsertPort;
  tailer?: Omit<
    CreateColosseumTraceTailerOptions,
    "db" | "config" | "insertTraceEvents" | "upsertPiAgentSession" | "upsertAgentRun"
  > | false;
  readRows?: KernelTraceRowsReader;
  listRows?: KernelTraceRowsLister;
  resolveIdentity?: KernelTraceIdentityResolver;
}

export interface GetDefaultColosseumKernelRuntimeOptions
  extends Omit<CreateColosseumKernelRuntimeOptions, "database"> {
  database?: OpenColosseumKernelDatabaseOptions & {
    env?: Record<string, string | undefined>;
  };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dedupeContainers(containers: NewContainer[]): NewContainer[] {
  const byId = new Map<string, NewContainer>();
  for (const container of containers) byId.set(container.id, container);
  return [...byId.values()];
}

export async function upsertColosseumSpawnContextContainers({
  context,
  db,
  upsert = defaultUpsertContainer,
}: {
  context: ColosseumKernelSpawnContext;
  db: unknown;
  upsert?: ContainerUpsertPort;
}): Promise<void> {
  const lineage = dedupeContainers(context.containerLineage ?? []);
  if (lineage.length === 0 && context.containerId) {
    lineage.push({
      id: context.containerId,
      parentContainerId: null,
      label: context.containerId,
      status: "running",
      workingDir: context.workingDir ?? null,
      worktreePath: null,
      phase: context.phase ?? null,
      phaseVocabulary: [],
      metadata: {
        appSessionId: context.appSessionId,
        ...(context.metadata ?? {}),
      },
    });
  }

  for (const container of lineage) {
    await upsert(db, {
      ...container,
      workingDir: container.workingDir ?? context.workingDir ?? null,
    });
  }
}

export async function resolveColosseumKernelTraceIdentity(
  db: unknown,
  id: string,
): Promise<KernelTraceReadIdentity> {
  const [direct] = await (db as any)
    .select({ id: schema.containers.id, metadata: schema.containers.metadata })
    .from(schema.containers)
    .where(eq(schema.containers.id, id))
    .limit(1);
  if (direct?.id) {
    return {
      containerId: direct.id,
      legacySessionId: metadataString(direct.metadata, "appSessionId") ?? id,
    };
  }

  const metadataIdentity = or(
    sql`${schema.containers.metadata}->>'appSessionId' = ${id}`,
    sql`${schema.containers.metadata}->>'appSessionSlug' = ${id}`,
    sql`${schema.containers.metadata}->>'sessionId' = ${id}`,
  );

  const [rootByMetadata] = await (db as any)
    .select({ id: schema.containers.id, metadata: schema.containers.metadata })
    .from(schema.containers)
    .where(and(isNull(schema.containers.parentContainerId), metadataIdentity))
    .limit(1);
  if (rootByMetadata?.id) {
    return {
      containerId: rootByMetadata.id,
      legacySessionId: metadataString(rootByMetadata.metadata, "appSessionId") ?? id,
    };
  }

  const [byMetadata] = await (db as any)
    .select({ id: schema.containers.id, metadata: schema.containers.metadata })
    .from(schema.containers)
    .where(metadataIdentity)
    .limit(1);

  return {
    containerId: byMetadata?.id ?? id,
    legacySessionId: metadataString(byMetadata?.metadata, "appSessionId") ?? id,
  };
}

export function createDbColosseumKernelTraceRowsLister(
  db: unknown,
  _config: ColosseumKernelBridgeConfig,
): KernelTraceRowsLister {
  return async (query) => {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const roots: Array<{ id: string; metadata: Record<string, unknown> }> = await (db as any)
      .select({ id: schema.containers.id, metadata: schema.containers.metadata })
      .from(schema.containers)
      .where(
        and(
          isNull(schema.containers.parentContainerId),
          like(schema.containers.id, "colosseum:%:session"),
          sql`${schema.containers.metadata}->>'projectId' IS NOT NULL`,
        ),
      )
      .orderBy(desc(schema.containers.updatedAt), desc(schema.containers.createdAt))
      .limit(limit);

    const rows: KernelTraceReadRows[] = [];
    for (const root of roots) {
      const readRows = await getKernelTraceReadRows(
        db,
        {
          containerId: root.id,
          legacySessionId: metadataString(root.metadata, "appSessionId"),
        },
        {
          after: query.after,
          limit: query.limit,
        },
      );
      if (readRows) rows.push(readRows);
    }

    return rows;
  };
}

export async function createColosseumKernelRuntime(
  options: CreateColosseumKernelRuntimeOptions = {},
): Promise<ColosseumKernelRuntime> {
  const config = createColosseumKernelBridgeConfig(options.config);
  const handle: ColosseumKernelDatabaseHandle = options.db
    ? {
        db: options.db,
        databaseUrl: options.database?.databaseUrl ?? null,
        close: options.closeDatabase ?? (async () => {}),
      }
    : await openColosseumKernelDatabase(options.database);
  const db = handle.db;

  if (options.ensureSchema !== false) {
    await (options.ensureSchemaWith ?? ensureKernelObservabilitySchema)(db as any);
  }

  const registration =
    options.register === false
      ? null
      : await upsertColosseumKernelRegistration({
          db,
          config,
          upsert: options.upsertRegistration,
        });
  const insertTraceEvents = options.insertTraceEvents ?? defaultInsertTraceEventsBatch;
  const traceWriter = createColosseumTraceWriter({
    insertBatch: (events) => insertTraceEvents(db, events),
  });
  const readRows = options.readRows ?? createDbKernelTraceRowsReader({ db });
  const listRows = options.listRows ?? createDbColosseumKernelTraceRowsLister(db, config);
  const resolveIdentity =
    options.resolveIdentity ?? ((id) => resolveColosseumKernelTraceIdentity(db, id));
  const readService = createColosseumKernelTraceReadService({
    readRows,
    listRows,
    resolveIdentity,
  });
  const readApi = createKernelTraceReadApi(readService);
  const upsertContainer = options.upsertContainer ?? defaultUpsertContainer;
  const upsertPiAgentSession = options.upsertPiAgentSession ?? defaultUpsertPiAgentSession;
  const upsertAgentRun = options.upsertAgentRun ?? defaultUpsertAgentRun;
  let traceTailer: ColosseumTraceTailer | null = null;
  let traceTailerStartPromise: Promise<void> | null = null;

  const getTraceTailer = (): ColosseumTraceTailer | null => {
    if (options.tailer === false) return null;
    if (!traceTailer) {
      traceTailer = createColosseumTraceTailer({
        db,
        config,
        insertTraceEvents,
        upsertPiAgentSession,
        upsertAgentRun,
        ...(options.tailer ?? {}),
      });
    }
    return traceTailer;
  };

  return {
    config,
    databaseUrl: handle.databaseUrl,
    db,
    registration,
    readApi,
    readRows,
    traceWriter,
    upsertSpawnContainers: (context) =>
      upsertColosseumSpawnContextContainers({ context, db, upsert: upsertContainer }),
    startTraceTailer: async () => {
      const tailer = getTraceTailer();
      if (!tailer) return;
      traceTailerStartPromise ??= tailer.start().finally(() => {
        traceTailerStartPromise = null;
      });
      await traceTailerStartPromise;
    },
    flushTraceTailer: async () => {
      await traceTailerStartPromise?.catch(() => {});
      await traceTailer?.flush();
    },
    stopTraceTailer: async () => {
      await traceTailerStartPromise?.catch(() => {});
      await traceTailer?.stop();
    },
    traceTailerStatus: () => traceTailer?.status() ?? null,
    close: async () => {
      await traceTailerStartPromise?.catch(() => {});
      await traceTailer?.stop();
      await handle.close();
    },
  };
}

let defaultRuntimePromise: Promise<ColosseumKernelRuntime | null> | null = null;
let defaultRuntimeWarningShown = false;

export async function getDefaultColosseumKernelRuntime(
  options: GetDefaultColosseumKernelRuntimeOptions = {},
): Promise<ColosseumKernelRuntime | null> {
  if (options.db) return createColosseumKernelRuntime(options);

  const env = options.database?.env ?? process.env;
  const databaseUrl =
    options.database?.databaseUrl ?? colosseumKernelDatabaseUrlFromEnv(env) ?? DEFAULT_AGENT_KERNEL_DATABASE_URL;
  if (!databaseUrl) return null;

  if (!defaultRuntimePromise) {
    defaultRuntimePromise = createColosseumKernelRuntime({
      ...options,
      database: {
        ...options.database,
        databaseUrl,
      },
    }).catch((error) => {
      defaultRuntimePromise = null;
      if (colosseumKernelRuntimeRequiredFromEnv(env)) throw error;
      if (!defaultRuntimeWarningShown) {
        defaultRuntimeWarningShown = true;
        console.warn(
          `Agent Kernel runtime disabled after DB initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    });
  }

  return defaultRuntimePromise;
}

export function resetDefaultColosseumKernelRuntimeForTests(): void {
  defaultRuntimePromise = null;
  defaultRuntimeWarningShown = false;
}

export async function closeDefaultColosseumKernelRuntime(): Promise<void> {
  const runtimePromise = defaultRuntimePromise;
  defaultRuntimePromise = null;
  defaultRuntimeWarningShown = false;
  const runtime = await runtimePromise?.catch(() => null);
  await runtime?.close();
}
