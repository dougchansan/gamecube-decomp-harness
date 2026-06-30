import { createHash } from "node:crypto";

import {
  insertTraceEventsBatch as defaultInsertTraceEventsBatch,
  upsertAgentRun as defaultUpsertAgentRun,
  upsertPiAgentSession as defaultUpsertPiAgentSession,
  type AgentRun,
  type NewAgentRun,
  type NewPiAgentSession,
  type PiAgentSession,
} from "@agent-kernel/db";
import type { TraceEvent } from "@agent-kernel/protocol";
import {
  createTailerConfig,
  CursorStore,
  DirectoryWatcher,
  EventMapper,
  EventQueue,
  type EventMapperOptions,
  type MapperResult,
  type PiEvent,
  type TailerConfig,
  type TailerConfigInput,
} from "@agent-kernel/tailer";

import {
  createColosseumKernelBridgeConfig,
  type CreateColosseumKernelBridgeConfigInput,
  type ColosseumKernelBridgeConfig,
} from "./config.js";

export interface CreateColosseumTailerConfigOptions
  extends Partial<Omit<TailerConfigInput, "watchDir" | "snapshotPath">> {
  watchDir?: string;
  snapshotPath?: string;
}

export type TailerTraceEventsInsertPort = (
  db: unknown,
  events: TraceEvent[],
) => Promise<number>;

export type TailerPiAgentSessionUpsertPort = (
  db: unknown,
  data: NewPiAgentSession,
) => Promise<PiAgentSession | NewPiAgentSession>;

export type TailerAgentRunUpsertPort = (
  db: unknown,
  data: NewAgentRun,
) => Promise<AgentRun | NewAgentRun>;

export interface CreateColosseumTraceTailerOptions {
  db: unknown;
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig;
  tailer?: CreateColosseumTailerConfigOptions;
  insertTraceEvents?: TailerTraceEventsInsertPort;
  upsertPiAgentSession?: TailerPiAgentSessionUpsertPort;
  upsertAgentRun?: TailerAgentRunUpsertPort;
  sleep?: (ms: number) => Promise<void>;
}

export interface ColosseumTraceTailerStatus {
  started: boolean;
  watchDir: string;
  snapshotPath: string;
  queueSize: number;
  pressured: boolean;
  readerCount: number;
  cursorCount: number;
  fileCount: number;
  piSessionCount: number;
  mappedEventCount: number;
  insertedEventCount: number;
}

type TailerAgentStatus = NonNullable<NewPiAgentSession["status"]>;

interface TailerFileState {
  filePath: string;
  appSessionId?: string;
  appSessionSlug?: string;
  appSessionDir?: string;
  piSessionUuid?: string;
  parentPiSessionId?: string;
  parentRunId?: string;
  parentToolUseId?: string;
  agentRunId?: string;
  agentName?: string;
  containerId?: string;
  phase?: string;
  displayLabel?: string;
  model?: string;
  runNumber?: number;
  status?: TailerAgentStatus;
  startedAt?: string;
  completedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  kernelManagedRun?: boolean;
}

const COLOSSEUM_AGENT_RUN_NAMESPACE = "56de4ed7-1d44-47ff-8f3b-c5e1b9071f25";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveBridgeConfig(
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig,
): ColosseumKernelBridgeConfig {
  return createColosseumKernelBridgeConfig(config);
}

export function createColosseumTailerConfig(
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig,
  overrides: CreateColosseumTailerConfigOptions = {},
): Readonly<TailerConfig> {
  const resolved = resolveBridgeConfig(config);
  return createTailerConfig({
    ...overrides,
    watchDir: overrides.watchDir ?? resolved.piSessionsDir,
    snapshotPath: overrides.snapshotPath ?? resolved.cursorSnapshotPath,
  });
}

export function createColosseumEventMapperOptions(
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig,
): EventMapperOptions {
  const resolved = resolveBridgeConfig(config);
  return {
    sessionBinding: {
      customType: resolved.markerConfig.sessionBinding,
      appSessionIdField: "appSessionId",
      slugField: "appSessionSlug",
      dirField: "appSessionDir",
    },
    lifecycleCustomType: resolved.markerConfig.lifecycle,
    subagentLinkCustomType: resolved.markerConfig.subagentLink,
  };
}

export function createColosseumEventMapper(
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig,
): EventMapper {
  return new EventMapper(createColosseumEventMapperOptions(config));
}

function stableUuid(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(namespaceBytes).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function rawString(raw: Record<string, unknown>, key: string): string | undefined {
  return stringValue(raw[key]) ?? stringValue(asRecord(raw.metadata)[key]);
}

function rawNumber(raw: Record<string, unknown>, key: string): number | undefined {
  return numberValue(raw[key]) ?? numberValue(asRecord(raw.metadata)[key]);
}

function rawBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  return booleanValue(raw[key]) ?? booleanValue(asRecord(raw.metadata)[key]);
}

function uuidString(value: unknown): string | undefined {
  const text = stringValue(value);
  return text && UUID_RE.test(text) ? text : undefined;
}

function statusFromLifecyclePhase(phase: string | undefined): TailerAgentStatus | undefined {
  if (phase === "agent_end") return "completed";
  if (phase === "agent_start" || phase === "turn_start" || phase === "turn_end") return "running";
  return undefined;
}

function agentNameFor(state: TailerFileState): string {
  return state.agentName ?? state.phase ?? "pi-agent";
}

function agentRunIdFor(state: TailerFileState): string {
  return (
    uuidString(state.agentRunId) ??
    stableUuid(
      COLOSSEUM_AGENT_RUN_NAMESPACE,
      `pi-session:${state.piSessionUuid ?? "unknown"}\nrun:${state.runNumber ?? 1}`,
    )
  );
}

export class ColosseumTraceTailer {
  readonly config: ColosseumKernelBridgeConfig;
  readonly tailerConfig: TailerConfig;

  private readonly db: unknown;
  private readonly insertTraceEvents: TailerTraceEventsInsertPort;
  private readonly upsertPiAgentSession: TailerPiAgentSessionUpsertPort;
  private readonly upsertAgentRun: TailerAgentRunUpsertPort;
  private readonly cursorStore: CursorStore;
  private readonly watcher: DirectoryWatcher;
  private readonly queue: EventQueue;
  private readonly mappers = new Map<string, EventMapper>();
  private readonly statesByFile = new Map<string, TailerFileState>();
  private readonly statesByPiSession = new Map<string, TailerFileState>();
  private started = false;
  private mappedEventCount = 0;
  private insertedEventCount = 0;

  constructor(options: CreateColosseumTraceTailerOptions) {
    this.db = options.db;
    this.config = resolveBridgeConfig(options.config);
    this.tailerConfig = createColosseumTailerConfig(this.config, options.tailer);
    this.insertTraceEvents = options.insertTraceEvents ?? defaultInsertTraceEventsBatch;
    this.upsertPiAgentSession = options.upsertPiAgentSession ?? defaultUpsertPiAgentSession;
    this.upsertAgentRun = options.upsertAgentRun ?? defaultUpsertAgentRun;
    this.cursorStore = new CursorStore(this.tailerConfig);
    this.queue = new EventQueue({
      config: this.tailerConfig,
      insertEvents: async (events) => {
        await this.insertMappedEvents(events);
      },
      callbacks: {
        onPressure: () => this.watcher.pause(),
        onRelease: () => this.watcher.resume(),
      },
      sleep: options.sleep,
    });
    this.watcher = new DirectoryWatcher(
      (filePath, events) => {
        this.ingestEvents(filePath, events);
      },
      this.cursorStore,
      this.tailerConfig,
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.cursorStore.loadSnapshot();
    this.cursorStore.startPeriodicSave();
    this.queue.start();
    try {
      this.watcher.start();
      this.started = true;
    } catch (error) {
      await this.queue.stop();
      await this.cursorStore.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.watcher.stop();
    try {
      await this.queue.stop();
    } finally {
      await this.cursorStore.stop();
      this.started = false;
    }
  }

  async flush(): Promise<void> {
    await this.queue.flush();
    await this.cursorStore.saveSnapshot();
  }

  ingestEvents(filePath: string, events: PiEvent[]): void {
    const mapper = this.mapperFor(filePath);
    for (const event of events) {
      const result = mapper.map(event);
      const state = this.updateState(filePath, mapper, event, result);
      if (result.traceEvents.length === 0) continue;
      const enriched = result.traceEvents.map((traceEvent) => ({
        ...traceEvent,
        containerId: traceEvent.containerId ?? state.containerId,
        piSessionUuid: traceEvent.piSessionUuid ?? state.piSessionUuid,
      }));
      this.mappedEventCount += enriched.length;
      this.queue.push(enriched);
    }
  }

  status(): ColosseumTraceTailerStatus {
    return {
      started: this.started,
      watchDir: this.tailerConfig.watchDir,
      snapshotPath: this.tailerConfig.snapshotPath,
      queueSize: this.queue.queueSize,
      pressured: this.queue.isPressured,
      readerCount: this.watcher.getReaderCount(),
      cursorCount: this.cursorStore.getCount(),
      fileCount: this.statesByFile.size,
      piSessionCount: this.statesByPiSession.size,
      mappedEventCount: this.mappedEventCount,
      insertedEventCount: this.insertedEventCount,
    };
  }

  private mapperFor(filePath: string): EventMapper {
    let mapper = this.mappers.get(filePath);
    if (!mapper) {
      mapper = createColosseumEventMapper(this.config);
      this.mappers.set(filePath, mapper);
    }
    return mapper;
  }

  private stateFor(filePath: string): TailerFileState {
    let state = this.statesByFile.get(filePath);
    if (!state) {
      state = {
        filePath,
        agentName: "pi-agent",
        status: "running",
        runNumber: 1,
      };
      this.statesByFile.set(filePath, state);
    }
    return state;
  }

  private bindPiSession(state: TailerFileState, piSessionUuid: string | null | undefined): void {
    if (!piSessionUuid) return;
    state.piSessionUuid = piSessionUuid;
    this.statesByPiSession.set(piSessionUuid, state);
  }

  private updateState(
    filePath: string,
    mapper: EventMapper,
    event: PiEvent,
    result: MapperResult,
  ): TailerFileState {
    const state = this.stateFor(filePath);
    if (event.type === "session") {
      this.bindPiSession(state, event.id);
      state.startedAt ??= event.timestamp;
    }
    if (event.type === "model_change") {
      state.model = event.modelId;
    }
    if (result.metadata?.piSessionUuid) {
      this.bindPiSession(state, result.metadata.piSessionUuid);
    }
    if (result.metadata?.appSession) {
      const appSession = result.metadata.appSession;
      const raw = appSession.raw;
      state.appSessionId = appSession.appSessionId ?? mapper.getAppSessionId() ?? state.appSessionId;
      state.appSessionSlug = appSession.slug ?? rawString(raw, "appSessionSlug") ?? state.appSessionSlug;
      state.appSessionDir = appSession.dir ?? rawString(raw, "appSessionDir") ?? state.appSessionDir;
      state.containerId = rawString(raw, "containerId") ?? state.containerId;
      state.phase = rawString(raw, "phase") ?? state.phase;
      state.agentName = rawString(raw, "agentName") ?? rawString(raw, "role") ?? state.agentName;
      state.displayLabel = rawString(raw, "displayLabel") ?? state.displayLabel;
      state.agentRunId = rawString(raw, "agentRunId") ?? state.agentRunId;
      state.parentRunId = uuidString(rawString(raw, "parentRunId")) ?? state.parentRunId;
      state.parentToolUseId = rawString(raw, "parentToolUseId") ?? state.parentToolUseId;
      state.runNumber = rawNumber(raw, "runNumber") ?? state.runNumber;
      state.kernelManagedRun = rawBoolean(raw, "kernelManagedRun") ?? state.kernelManagedRun;
    }
    if (result.metadata?.subagentLink) {
      const link = result.metadata.subagentLink;
      const child = this.statesByPiSession.get(link.childPiSessionId);
      if (child) {
        child.parentPiSessionId = link.parentPiSessionId;
        child.parentToolUseId = link.toolCallId;
        child.agentName = link.agentType || child.agentName;
        child.displayLabel = link.description || child.displayLabel;
      }
    }
    if (event.type === "custom" && event.customType === this.config.markerConfig.lifecycle) {
      const phase = stringValue(event.data.phase);
      state.status = statusFromLifecyclePhase(phase) ?? state.status;
      if (phase === "agent_start") state.startedAt ??= event.timestamp;
      if (phase === "agent_end") {
        state.completedAt = event.timestamp;
        state.inputTokens = numberValue(event.data.inputTokens) ?? state.inputTokens;
        state.outputTokens = numberValue(event.data.outputTokens) ?? state.outputTokens;
      }
    }
    state.model = mapper.getModel() !== "unknown" ? mapper.getModel() : state.model;
    this.bindPiSession(state, mapper.getPiSessionUuid());
    return state;
  }

  private async insertMappedEvents(events: TraceEvent[]): Promise<void> {
    const piSessionIds = new Set(
      events.map((event) => event.piSessionUuid).filter((id): id is string => Boolean(id)),
    );
    for (const piSessionUuid of piSessionIds) {
      const sample = events.find((event) => event.piSessionUuid === piSessionUuid);
      await this.ensurePiSession(piSessionUuid, sample);
    }
    const inserted = await this.insertTraceEvents(this.db, events);
    this.insertedEventCount += inserted;
  }

  private async ensurePiSession(
    piSessionUuid: string,
    sample?: TraceEvent,
  ): Promise<void> {
    let state = this.statesByPiSession.get(piSessionUuid);
    if (!state) {
      state = {
        filePath: "",
        piSessionUuid,
        appSessionId: sample?.appSessionId,
        agentName: "pi-agent",
        status: "running",
        runNumber: 1,
        startedAt: sample?.timestamp,
      };
      this.statesByPiSession.set(piSessionUuid, state);
    }
    state.appSessionId ??= sample?.appSessionId;
    state.startedAt ??= sample?.timestamp;

    const agentName = agentNameFor(state);
    const sessionPayload: NewPiAgentSession = {
      id: piSessionUuid,
      agentName,
      appSessionId: state.appSessionId,
      parentId: state.parentPiSessionId,
      containerId: state.containerId,
      phase: state.phase,
      displayLabel: state.displayLabel ?? agentName,
      status: state.status ?? "running",
      model: state.model ?? "unknown",
      startedAt: state.startedAt,
      completedAt: state.completedAt,
    };
    await this.upsertPiAgentSession(this.db, sessionPayload);

    if (!state.kernelManagedRun) {
      const runPayload: NewAgentRun = {
        id: agentRunIdFor(state),
        piSessionId: piSessionUuid,
        agentName,
        containerId: state.containerId,
        phase: state.phase,
        parentRunId: state.parentRunId,
        displayLabel: state.displayLabel ?? agentName,
        parentToolUseId: state.parentToolUseId,
        runNumber: state.runNumber ?? 1,
        status: state.status ?? "running",
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      };
      await this.upsertAgentRun(this.db, runPayload);
    }
  }
}

export function createColosseumTraceTailer(
  options: CreateColosseumTraceTailerOptions,
): ColosseumTraceTailer {
  return new ColosseumTraceTailer(options);
}
