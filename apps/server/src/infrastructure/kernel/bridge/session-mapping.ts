import { createHash } from "node:crypto";

import type { NewContainer } from "@agent-kernel/db";

const COLOSSEUM_APP_SESSION_NAMESPACE = "0dbd5814-75c3-4dc8-9b3b-0f6277cc2b08";

export type ColosseumContainerKind =
  | "session"
  | "prepare"
  | "sync-intake"
  | "intake"
  | "intake-item"
  | "intake-postmortem"
  | "intake-knowledge"
  | "pr-index"
  | "knowledge-refresh"
  | "baseline"
  | "run"
  | "epoch"
  | "worker"
  | "worker-integration"
  | "postmortem"
  | "pr"
  | "pr-handoff"
  | "pr-qa"
  | "pr-split"
  | "pr-review"
  | "pr-repair"
  | "pr-publication";

export interface ColosseumProjectSessionRef {
  projectId: string;
  sessionId: string;
}

export interface ColosseumRunRef extends ColosseumProjectSessionRef {
  runId: string;
}

export interface ColosseumEpochRef extends ColosseumRunRef {
  epochId: string | number;
}

export interface ColosseumClaimRef extends ColosseumEpochRef {
  claimId: string;
  targetId?: string;
}

export interface ColosseumPrRef extends ColosseumProjectSessionRef {
  prId?: string;
}

export interface ColosseumIntakePrRef extends ColosseumProjectSessionRef {
  prId: string | number;
}

export interface ColosseumReviewRef extends ColosseumPrRef {
  reviewId: string;
}

export interface ColosseumRepairRef extends ColosseumPrRef {
  repairId: string;
}

export interface ColosseumContainerDescriptor {
  id: string;
  kind: ColosseumContainerKind;
  appSessionId: string;
  parentContainerId: string | null;
  label: string;
  phase: string;
  metadata: Record<string, unknown>;
}

export interface BuildColosseumContainerInput {
  kind: ColosseumContainerKind;
  ref: ColosseumProjectSessionRef;
  parentContainerId?: string | null;
  label?: string;
  phase?: string;
  workingDir?: string | null;
  worktreePath?: string | null;
  status?: NewContainer["status"];
  metadata?: Record<string, unknown>;
  startedAt?: string | null;
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

function cleanSegment(value: string | number | undefined): string {
  if (value === undefined) return "none";
  const raw = String(value).trim();
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = createHash("sha1").update(raw).digest("hex").slice(0, 10);
  return `${normalized || "id"}-${digest}`;
}

export function colosseumAppSessionId(ref: ColosseumProjectSessionRef): string {
  return stableUuid(
    COLOSSEUM_APP_SESSION_NAMESPACE,
    `project:${ref.projectId}\nsession:${ref.sessionId}`,
  );
}

export function colosseumRootContainerId(ref: ColosseumProjectSessionRef): string {
  return `colosseum:${colosseumAppSessionId(ref)}:session`;
}

export function colosseumPrepareContainerId(ref: ColosseumProjectSessionRef): string {
  return `${colosseumRootContainerId(ref)}:prepare`;
}

export function colosseumSyncIntakeContainerId(ref: ColosseumProjectSessionRef): string {
  return `${colosseumPrepareContainerId(ref)}:sync-intake`;
}

export function colosseumIntakeContainerId(ref: ColosseumProjectSessionRef): string {
  return `${colosseumPrepareContainerId(ref)}:intake`;
}

export function colosseumIntakeItemContainerId(ref: ColosseumIntakePrRef): string {
  return `${colosseumIntakeContainerId(ref)}:pr:${cleanSegment(ref.prId)}`;
}

export function colosseumIntakePostmortemContainerId(ref: ColosseumIntakePrRef): string {
  return `${colosseumIntakeItemContainerId(ref)}:postmortem`;
}

export function colosseumIntakeKnowledgeContainerId(ref: ColosseumIntakePrRef): string {
  return `${colosseumIntakeItemContainerId(ref)}:knowledge-intake`;
}

export function colosseumPrIndexContainerId(ref: ColosseumProjectSessionRef): string {
  return `${colosseumPrepareContainerId(ref)}:pr-index`;
}

export function colosseumKnowledgeRefreshContainerId(ref: ColosseumProjectSessionRef): string {
  return `${colosseumPrepareContainerId(ref)}:knowledge-refresh`;
}

export function colosseumBaselineContainerId(ref: ColosseumProjectSessionRef): string {
  return `${colosseumPrepareContainerId(ref)}:baseline`;
}

export function colosseumRunContainerId(ref: ColosseumRunRef): string {
  return `${colosseumRootContainerId(ref)}:run:${cleanSegment(ref.runId)}`;
}

export function colosseumEpochContainerId(ref: ColosseumEpochRef): string {
  return `${colosseumRunContainerId(ref)}:epoch:${cleanSegment(ref.epochId)}`;
}

export function colosseumWorkerContainerId(ref: ColosseumClaimRef): string {
  return `${colosseumEpochContainerId(ref)}:worker:${cleanSegment(ref.claimId)}`;
}

export function colosseumWorkerIntegrationContainerId(ref: ColosseumClaimRef): string {
  return `${colosseumEpochContainerId(ref)}:integration:${cleanSegment(ref.claimId)}`;
}

export function colosseumPostmortemContainerId(ref: ColosseumClaimRef): string {
  return `${colosseumEpochContainerId(ref)}:postmortem:${cleanSegment(ref.claimId)}`;
}

export function colosseumPrContainerId(ref: ColosseumPrRef): string {
  return `${colosseumRootContainerId(ref)}:pr:${cleanSegment(ref.prId ?? "session")}`;
}

export function colosseumPrHandoffContainerId(ref: ColosseumPrRef): string {
  return `${colosseumPrContainerId(ref)}:handoff`;
}

export function colosseumPrQaContainerId(ref: ColosseumPrRef): string {
  return `${colosseumPrContainerId(ref)}:qa`;
}

export function colosseumPrSplitContainerId(ref: ColosseumPrRef): string {
  return `${colosseumPrContainerId(ref)}:split`;
}

export function colosseumPrReviewContainerId(ref: ColosseumReviewRef): string {
  return `${colosseumPrContainerId(ref)}:review:${cleanSegment(ref.reviewId)}`;
}

export function colosseumPrRepairContainerId(ref: ColosseumRepairRef): string {
  return `${colosseumPrContainerId(ref)}:repair:${cleanSegment(ref.repairId)}`;
}

export function colosseumPrPublicationContainerId(ref: ColosseumPrRef): string {
  return `${colosseumPrContainerId(ref)}:publication`;
}

export function describeColosseumContainer(
  kind: ColosseumContainerKind,
  ref: ColosseumProjectSessionRef,
  metadata: Record<string, unknown> = {},
): ColosseumContainerDescriptor {
  const appSessionId = colosseumAppSessionId(ref);
  const rootId = colosseumRootContainerId(ref);

  switch (kind) {
    case "session":
      return {
        id: rootId,
        kind,
        appSessionId,
        parentContainerId: null,
        label: `Project session ${ref.sessionId}`,
        phase: "session",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "prepare":
      return {
        id: colosseumPrepareContainerId(ref),
        kind,
        appSessionId,
        parentContainerId: rootId,
        label: "Prepare",
        phase: "prepare",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "sync-intake":
      return {
        id: colosseumSyncIntakeContainerId(ref),
        kind,
        appSessionId,
        parentContainerId: colosseumPrepareContainerId(ref),
        label: "Sync Intake",
        phase: "setup",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "intake":
      return {
        id: colosseumIntakeContainerId(ref),
        kind,
        appSessionId,
        parentContainerId: colosseumPrepareContainerId(ref),
        label: "Intake",
        phase: "intake",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "intake-item": {
      const prId = typeof metadata.prId === "string" && metadata.prId ? metadata.prId : "item";
      const intakeRef = { ...ref, prId };
      return {
        id: colosseumIntakeItemContainerId(intakeRef),
        kind,
        appSessionId,
        parentContainerId: colosseumIntakeContainerId(ref),
        label: prId.startsWith("#") ? `${prId} intake` : `PR #${prId} intake`,
        phase: "intake-item",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, prId, ...metadata },
      };
    }
    case "intake-postmortem": {
      const prId = typeof metadata.prId === "string" && metadata.prId ? metadata.prId : "item";
      const intakeRef = { ...ref, prId };
      return {
        id: colosseumIntakePostmortemContainerId(intakeRef),
        kind,
        appSessionId,
        parentContainerId: colosseumIntakeItemContainerId(intakeRef),
        label: prId.startsWith("#") ? `${prId} postmortem` : `PR #${prId} postmortem`,
        phase: "postmortem",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, prId, ...metadata },
      };
    }
    case "intake-knowledge": {
      const prId = typeof metadata.prId === "string" && metadata.prId ? metadata.prId : "item";
      const intakeRef = { ...ref, prId };
      return {
        id: colosseumIntakeKnowledgeContainerId(intakeRef),
        kind,
        appSessionId,
        parentContainerId: colosseumIntakeItemContainerId(intakeRef),
        label: prId.startsWith("#") ? `${prId} knowledge intake` : `PR #${prId} knowledge intake`,
        phase: "knowledge-intake",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, prId, ...metadata },
      };
    }
    case "pr-index":
      return {
        id: colosseumPrIndexContainerId(ref),
        kind,
        appSessionId,
        parentContainerId: colosseumPrepareContainerId(ref),
        label: "PR index",
        phase: "pr-index",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "knowledge-refresh":
      return {
        id: colosseumKnowledgeRefreshContainerId(ref),
        kind,
        appSessionId,
        parentContainerId: colosseumPrepareContainerId(ref),
        label: "Knowledge refresh",
        phase: "knowledge-refresh",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "baseline":
      return {
        id: colosseumBaselineContainerId(ref),
        kind,
        appSessionId,
        parentContainerId: colosseumPrepareContainerId(ref),
        label: "Baseline and rebuild",
        phase: "baseline",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
    case "pr": {
      const prId = typeof metadata.prId === "string" && metadata.prId ? metadata.prId : "session";
      const prRef = { ...ref, prId };
      return {
        id: colosseumPrContainerId(prRef),
        kind,
        appSessionId,
        parentContainerId: rootId,
        label: "PR mode",
        phase: "pr",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, prId, ...metadata },
      };
    }
    case "pr-publication": {
      const prId = typeof metadata.prId === "string" && metadata.prId ? metadata.prId : "session";
      const prRef = { ...ref, prId };
      return {
        id: colosseumPrPublicationContainerId(prRef),
        kind,
        appSessionId,
        parentContainerId: colosseumPrContainerId(prRef),
        label: "PR publication",
        phase: "publication",
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, prId, ...metadata },
      };
    }
    default:
      return {
        id: `${rootId}:${kind}:${cleanSegment(metadata.id as string | undefined)}`,
        kind,
        appSessionId,
        parentContainerId: rootId,
        label: kind,
        phase: kind,
        metadata: { projectId: ref.projectId, sessionId: ref.sessionId, ...metadata },
      };
  }
}

export function buildColosseumContainer(input: BuildColosseumContainerInput): NewContainer {
  const descriptor = describeColosseumContainer(input.kind, input.ref, input.metadata);
  return {
    id: descriptor.id,
    parentContainerId: input.parentContainerId ?? descriptor.parentContainerId,
    label: input.label ?? descriptor.label,
    status: input.status ?? "running",
    workingDir: input.workingDir ?? null,
    worktreePath: input.worktreePath ?? null,
    phase: input.phase ?? descriptor.phase,
    phaseVocabulary: [
      "prepare",
      "intake",
      "intake-item",
      "setup",
      "pr-index",
      "knowledge-refresh",
      "knowledge-intake",
      "baseline",
      "run",
      "epoch",
      "worker",
      "postmortem",
      "pr",
      "review",
      "repair",
      "publication",
    ],
    metadata: {
      ...descriptor.metadata,
      appSessionId: descriptor.appSessionId,
      containerKind: descriptor.kind,
    },
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
}
