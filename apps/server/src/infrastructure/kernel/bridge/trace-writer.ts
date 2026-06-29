import {
  newEventId,
  SYSTEM_USER_ID,
  TraceLevel,
  TraceSource,
  type EventData,
  type EventType,
  type TraceEvent,
} from "@agent-kernel/protocol";

export type TraceEventBatchInsertPort = (events: TraceEvent[]) => Promise<number>;

export interface CreateMeleeTraceWriterOptions {
  insertBatch: TraceEventBatchInsertPort;
  userId?: string;
  now?: () => string;
  newEventId?: () => string;
}

export interface AppTraceEventInput {
  appSessionId: string;
  containerId?: string;
  type: EventType | string;
  eventData: EventData;
  traceLevel?: TraceLevel;
  agentId?: string;
  spanId?: string;
  parentEventId?: string;
  timestamp?: string;
  userId?: string;
}

export class MeleeTraceWriter {
  private readonly insertBatch: TraceEventBatchInsertPort;
  private readonly userId: string;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: CreateMeleeTraceWriterOptions) {
    this.insertBatch = options.insertBatch;
    this.userId = options.userId ?? SYSTEM_USER_ID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.newEventId ?? newEventId;
  }

  createAppEvent(input: AppTraceEventInput): TraceEvent {
    return {
      eventId: this.createId(),
      appSessionId: input.appSessionId,
      userId: input.userId ?? this.userId,
      type: input.type as TraceEvent["type"],
      source: TraceSource.APP,
      traceLevel: input.traceLevel ?? TraceLevel.PROCESSING,
      eventData: input.eventData,
      timestamp: input.timestamp ?? this.now(),
      ...(input.containerId !== undefined ? { containerId: input.containerId } : {}),
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.spanId !== undefined ? { spanId: input.spanId } : {}),
      ...(input.parentEventId !== undefined ? { parentEventId: input.parentEventId } : {}),
    };
  }

  async submit(events: TraceEvent | TraceEvent[]): Promise<number> {
    const batch = Array.isArray(events) ? events : [events];
    return this.insertBatch(batch);
  }

  async submitAppEvent(input: AppTraceEventInput): Promise<TraceEvent> {
    const event = this.createAppEvent(input);
    await this.submit(event);
    return event;
  }
}

export function createMeleeTraceWriter(
  options: CreateMeleeTraceWriterOptions,
): MeleeTraceWriter {
  return new MeleeTraceWriter(options);
}
