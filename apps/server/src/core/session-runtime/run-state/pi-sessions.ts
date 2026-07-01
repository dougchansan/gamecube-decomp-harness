import { randomUUID } from "node:crypto";
import type { PiSessionStatus, RuntimeAgentRole } from "@server/core/shared/types/index.js";
import { immediateTransaction, now, piSessions, type StateStore } from "@server/core/orchestrator-state";

export function addPiSession(params: {
  store: StateStore;
  runId: string;
  claimId?: string;
  role: RuntimeAgentRole;
  sessionId: string;
  sessionFile?: string;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  status: PiSessionStatus;
  outputPath: string;
  // Telemetry (Track B): token/cost usage + rung/attempt bookkeeping.
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  attemptIndex?: number;
  escalationLevel?: number;
  endedAt?: string;
}): string {
  const id = randomUUID();
  immediateTransaction(params.store.db, () => {
    params.store.orm
      .insert(piSessions)
      .values({
        id,
        runId: params.runId,
        targetClaimId: params.claimId ?? null,
        role: params.role,
        sessionId: params.sessionId,
        sessionFile: params.sessionFile ?? null,
        provider: params.provider ?? null,
        model: params.model ?? null,
        thinkingLevel: params.thinkingLevel ?? null,
        status: params.status,
        outputPath: params.outputPath,
        createdAt: now(),
        inputTokens: params.inputTokens ?? null,
        outputTokens: params.outputTokens ?? null,
        cacheReadTokens: params.cacheReadTokens ?? null,
        cacheWriteTokens: params.cacheWriteTokens ?? null,
        costUsd: params.costUsd ?? null,
        attemptIndex: params.attemptIndex ?? null,
        escalationLevel: params.escalationLevel ?? null,
        endedAt: params.endedAt ?? null,
      })
      .run();
  });
  return id;
}
