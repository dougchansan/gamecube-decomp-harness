import type { NewContainer } from "@agent-kernel/db";

import type { MeleeKernelSpawnContext } from "./kernel.js";
import {
  meleeAppSessionId,
  meleeEpochContainerId,
  meleeIntakeContainerId,
  meleeIntakeItemContainerId,
  meleeIntakeKnowledgeContainerId,
  meleeIntakePostmortemContainerId,
  meleePrepareContainerId,
  meleePrContainerId,
  meleePrRepairContainerId,
  meleePrReviewContainerId,
  meleePrSplitContainerId,
  meleePostmortemContainerId,
  meleeRunContainerId,
  meleeWorkerIntegrationContainerId,
  meleeWorkerContainerId,
  type MeleeProjectSessionRef,
} from "./session-mapping.js";

export type MeleeKernelSpawnContainerKind =
  | "run"
  | "worker"
  | "worker-integration"
  | "postmortem"
  | "intake-postmortem"
  | "intake-knowledge"
  | "knowledge-curation"
  | "pr"
  | "pr-split"
  | "pr-review"
  | "pr-repair"
  | "reconcile";

export interface MeleeKernelSpawnContextInput {
  kind: MeleeKernelSpawnContainerKind;
  projectId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  epochId?: string | number | null;
  claimId?: string | null;
  itemId?: string | null;
  targetId?: string | null;
  prId?: string | null;
  reviewId?: string | null;
  repairId?: string | null;
  phase?: string | null;
  workingDir?: string | null;
  metadata?: Record<string, unknown>;
}

const DEFAULT_PROJECT_ID = "melee";
const MANUAL_SESSION_ID = "manual";
const MELEE_PHASE_VOCABULARY = [
  "setup",
  "prepare",
  "intake",
  "intake-item",
  "baseline",
  "run",
  "epoch",
  "worker",
  "integration",
  "postmortem",
  "knowledge-intake",
  "knowledge-curation",
  "pr",
  "pr-split",
  "pr-review",
  "repair",
  "reconcile",
  "publication",
];

function nonEmpty(value: string | number | null | undefined): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function baseRef(input: MeleeKernelSpawnContextInput): MeleeProjectSessionRef {
  const projectId = nonEmpty(input.projectId) ?? DEFAULT_PROJECT_ID;
  const sessionId =
    nonEmpty(input.sessionId) ??
    nonEmpty(input.runId) ??
    nonEmpty(input.prId) ??
    MANUAL_SESSION_ID;
  return { projectId, sessionId };
}

function containerId(input: MeleeKernelSpawnContextInput, ref: MeleeProjectSessionRef): string {
  const runId = nonEmpty(input.runId) ?? ref.sessionId;
  switch (input.kind) {
    case "worker":
      return meleeWorkerContainerId({
        ...ref,
        runId,
        epochId: nonEmpty(input.epochId) ?? "active",
        claimId: nonEmpty(input.claimId) ?? "none",
        targetId: nonEmpty(input.targetId),
      });
    case "worker-integration":
      return meleeWorkerIntegrationContainerId({
        ...ref,
        runId,
        epochId: nonEmpty(input.epochId) ?? "active",
        claimId: nonEmpty(input.claimId) ?? nonEmpty(input.itemId) ?? "none",
        targetId: nonEmpty(input.targetId),
      });
    case "postmortem":
      return meleePostmortemContainerId({
        ...ref,
        runId,
        epochId: nonEmpty(input.epochId) ?? "active",
        claimId: nonEmpty(input.claimId) ?? nonEmpty(input.itemId) ?? "none",
        targetId: nonEmpty(input.targetId),
      });
    case "intake-postmortem":
      return meleeIntakePostmortemContainerId({
        ...ref,
        prId: nonEmpty(input.prId) ?? nonEmpty(input.targetId) ?? nonEmpty(input.itemId) ?? runId,
      });
    case "intake-knowledge":
      return meleeIntakeKnowledgeContainerId({
        ...ref,
        prId: nonEmpty(input.prId) ?? nonEmpty(input.targetId) ?? nonEmpty(input.itemId) ?? runId,
      });
    case "knowledge-curation":
    case "run":
      return meleeRunContainerId({ ...ref, runId });
    case "pr-split":
      return meleePrSplitContainerId({ ...ref, prId: nonEmpty(input.prId) ?? runId });
    case "pr-review":
      return meleePrReviewContainerId({
        ...ref,
        prId: nonEmpty(input.prId) ?? runId,
        reviewId: nonEmpty(input.reviewId) ?? "review",
      });
    case "pr-repair":
      return meleePrRepairContainerId({
        ...ref,
        prId: nonEmpty(input.prId) ?? runId,
        repairId: nonEmpty(input.repairId) ?? "repair",
      });
    case "reconcile":
      return meleePrRepairContainerId({
        ...ref,
        prId: nonEmpty(input.prId) ?? runId,
        repairId: nonEmpty(input.repairId) ?? "reconcile",
      });
    case "pr":
      return meleePrContainerId({ ...ref, prId: nonEmpty(input.prId) ?? runId });
  }
}

function defaultPhase(kind: MeleeKernelSpawnContainerKind): string {
  switch (kind) {
    case "intake-postmortem":
      return "postmortem";
    case "intake-knowledge":
      return "knowledge-intake";
    case "knowledge-curation":
      return "knowledge-curation";
    case "pr-repair":
      return "repair";
    case "reconcile":
      return "reconcile";
    case "worker-integration":
      return "integration";
    default:
      return kind;
  }
}

function containerRecord(input: {
  id: string;
  parentContainerId: string | null;
  label: string;
  phase: string;
  ref: MeleeProjectSessionRef;
  appSessionId: string;
  kind: string;
  workingDir?: string;
  metadata?: Record<string, unknown>;
}): NewContainer {
  return {
    id: input.id,
    parentContainerId: input.parentContainerId,
    label: input.label,
    status: "running",
    workingDir: input.workingDir ?? null,
    worktreePath: null,
    phase: input.phase,
    phaseVocabulary: MELEE_PHASE_VOCABULARY,
    metadata: {
      appSessionId: input.appSessionId,
      appSessionSlug: input.ref.sessionId,
      appSessionType: "melee-project-session",
      containerKind: input.kind,
      projectId: input.ref.projectId,
      sessionId: input.ref.sessionId,
      topic: `Melee ${input.ref.projectId} session ${input.ref.sessionId}`,
      ...(input.metadata ?? {}),
    },
  };
}

function rootContainer(
  ref: MeleeProjectSessionRef,
  appSessionId: string,
  workingDir?: string,
): NewContainer {
  return containerRecord({
    id: `melee:${appSessionId}:session`,
    parentContainerId: null,
    label: `Project session ${ref.sessionId}`,
    phase: "session",
    ref,
    appSessionId,
    kind: "session",
    workingDir,
  });
}

function containerLineage(
  input: MeleeKernelSpawnContextInput,
  ref: MeleeProjectSessionRef,
  appSessionId: string,
): NewContainer[] {
  const workingDir = nonEmpty(input.workingDir);
  const runId = nonEmpty(input.runId) ?? ref.sessionId;
  const prId = nonEmpty(input.prId) ?? runId;
  const epochId = nonEmpty(input.epochId) ?? "active";
  const claimId = nonEmpty(input.claimId);
  const itemId = nonEmpty(input.itemId) ?? nonEmpty(input.prId) ?? nonEmpty(input.targetId) ?? claimId ?? runId;
  const claimSegment = claimId ?? nonEmpty(input.itemId) ?? "none";
  const root = rootContainer(ref, appSessionId, workingDir);
  const run = containerRecord({
    id: meleeRunContainerId({ ...ref, runId }),
    parentContainerId: root.id,
    label: `Run ${runId}`,
    phase: "run",
    ref,
    appSessionId,
    kind: "run",
    workingDir,
    metadata: { runId },
  });
  const pr = containerRecord({
    id: meleePrContainerId({ ...ref, prId }),
    parentContainerId: root.id,
    label: `PR ${prId}`,
    phase: "pr",
    ref,
    appSessionId,
    kind: "pr",
    workingDir,
    metadata: { runId, prId },
  });
  const prepare = containerRecord({
    id: meleePrepareContainerId(ref),
    parentContainerId: root.id,
    label: "Prepare",
    phase: "prepare",
    ref,
    appSessionId,
    kind: "prepare",
    workingDir,
  });
  const intake = containerRecord({
    id: meleeIntakeContainerId(ref),
    parentContainerId: prepare.id,
    label: "Intake",
    phase: "intake",
    ref,
    appSessionId,
    kind: "intake",
    workingDir,
  });
  const intakeItemPrId = nonEmpty(input.prId) ?? nonEmpty(input.targetId) ?? itemId;
  const intakeItem = containerRecord({
    id: meleeIntakeItemContainerId({ ...ref, prId: intakeItemPrId }),
    parentContainerId: intake.id,
    label: intakeItemPrId.startsWith("#") ? `${intakeItemPrId} intake` : `PR #${intakeItemPrId} intake`,
    phase: "intake-item",
    ref,
    appSessionId,
    kind: "intake-item",
    workingDir,
    metadata: {
      runId,
      prId: intakeItemPrId,
      itemId,
      ...(nonEmpty(input.targetId) ? { targetId: nonEmpty(input.targetId) } : {}),
    },
  });

  switch (input.kind) {
    case "run":
      return [root, run];
    case "knowledge-curation":
      return [
        root,
        {
          ...run,
          label: `Knowledge curation ${runId}`,
          phase: "knowledge-curation",
          metadata: {
            ...run.metadata,
            containerKind: "knowledge-curation",
          },
        },
      ];
    case "worker": {
      const epoch = containerRecord({
        id: meleeEpochContainerId({ ...ref, runId, epochId }),
        parentContainerId: run.id,
        label: `Epoch ${epochId}`,
        phase: "epoch",
        ref,
        appSessionId,
        kind: "epoch",
        workingDir,
        metadata: { runId, epochId },
      });
      const worker = containerRecord({
        id: meleeWorkerContainerId({ ...ref, runId, epochId, claimId: claimSegment }),
        parentContainerId: epoch.id,
        label: `Worker claim ${claimSegment}`,
        phase: "worker",
        ref,
        appSessionId,
        kind: "worker",
        workingDir,
        metadata: {
          runId,
          epochId,
          claimId: claimSegment,
          ...(nonEmpty(input.targetId) ? { targetId: nonEmpty(input.targetId) } : {}),
        },
      });
      return [root, run, epoch, worker];
    }
    case "worker-integration": {
      const epoch = containerRecord({
        id: meleeEpochContainerId({ ...ref, runId, epochId }),
        parentContainerId: run.id,
        label: `Epoch ${epochId}`,
        phase: "epoch",
        ref,
        appSessionId,
        kind: "epoch",
        workingDir,
        metadata: { runId, epochId },
      });
      const integration = containerRecord({
        id: meleeWorkerIntegrationContainerId({ ...ref, runId, epochId, claimId: claimSegment }),
        parentContainerId: epoch.id,
        label: `Worker integration ${claimSegment}`,
        phase: "integration",
        ref,
        appSessionId,
        kind: "worker-integration",
        workingDir,
        metadata: {
          runId,
          epochId,
          claimId: claimSegment,
          itemId,
          ...(nonEmpty(input.targetId) ? { targetId: nonEmpty(input.targetId) } : {}),
        },
      });
      return [root, run, epoch, integration];
    }
    case "postmortem": {
      const epoch = containerRecord({
        id: meleeEpochContainerId({ ...ref, runId, epochId }),
        parentContainerId: run.id,
        label: `Epoch ${epochId}`,
        phase: "epoch",
        ref,
        appSessionId,
        kind: "epoch",
        workingDir,
        metadata: { runId, epochId },
      });
      const postmortem = containerRecord({
        id: meleePostmortemContainerId({ ...ref, runId, epochId, claimId: claimSegment }),
        parentContainerId: epoch.id,
        label: claimId ? `Postmortem claim ${claimSegment}` : `Postmortem ${claimSegment}`,
        phase: "postmortem",
        ref,
        appSessionId,
        kind: "postmortem",
        workingDir,
        metadata: {
          runId,
          epochId,
          ...(claimId ? { claimId } : {}),
          ...(nonEmpty(input.itemId) ? { itemId: nonEmpty(input.itemId) } : {}),
          ...(nonEmpty(input.targetId) ? { targetId: nonEmpty(input.targetId) } : {}),
        },
      });
      return [root, run, epoch, postmortem];
    }
    case "intake-postmortem":
      return [
        root,
        prepare,
        intake,
        intakeItem,
        containerRecord({
          id: meleeIntakePostmortemContainerId({ ...ref, prId: intakeItemPrId }),
          parentContainerId: intakeItem.id,
          label: intakeItemPrId.startsWith("#") ? `${intakeItemPrId} postmortem` : `PR #${intakeItemPrId} postmortem`,
          phase: "postmortem",
          ref,
          appSessionId,
          kind: "intake-postmortem",
          workingDir,
          metadata: {
            runId,
            prId: intakeItemPrId,
            itemId,
            ...(nonEmpty(input.targetId) ? { targetId: nonEmpty(input.targetId) } : {}),
          },
        }),
      ];
    case "intake-knowledge":
      return [
        root,
        prepare,
        intake,
        intakeItem,
        containerRecord({
          id: meleeIntakeKnowledgeContainerId({ ...ref, prId: intakeItemPrId }),
          parentContainerId: intakeItem.id,
          label: intakeItemPrId.startsWith("#") ? `${intakeItemPrId} knowledge intake` : `PR #${intakeItemPrId} knowledge intake`,
          phase: "knowledge-intake",
          ref,
          appSessionId,
          kind: "intake-knowledge",
          workingDir,
          metadata: {
            runId,
            prId: intakeItemPrId,
            itemId,
            ...(nonEmpty(input.targetId) ? { targetId: nonEmpty(input.targetId) } : {}),
          },
        }),
      ];
    case "pr":
      return [root, pr];
    case "pr-split":
      return [
        root,
        pr,
        containerRecord({
          id: meleePrSplitContainerId({ ...ref, prId }),
          parentContainerId: pr.id,
          label: `PR split ${prId}`,
          phase: "pr-split",
          ref,
          appSessionId,
          kind: "pr-split",
          workingDir,
          metadata: { runId, prId },
        }),
      ];
    case "pr-review": {
      const reviewId = nonEmpty(input.reviewId) ?? "review";
      return [
        root,
        pr,
        containerRecord({
          id: meleePrReviewContainerId({ ...ref, prId, reviewId }),
          parentContainerId: pr.id,
          label: `PR review ${reviewId}`,
          phase: "pr-review",
          ref,
          appSessionId,
          kind: "pr-review",
          workingDir,
          metadata: { runId, prId, reviewId },
        }),
      ];
    }
    case "pr-repair":
    case "reconcile": {
      const repairId = nonEmpty(input.repairId) ?? (input.kind === "reconcile" ? "reconcile" : "repair");
      return [
        root,
        pr,
        containerRecord({
          id: meleePrRepairContainerId({ ...ref, prId, repairId }),
          parentContainerId: pr.id,
          label: input.kind === "reconcile" ? `Reconcile ${repairId}` : `PR repair ${repairId}`,
          phase: input.kind === "reconcile" ? "reconcile" : "repair",
          ref,
          appSessionId,
          kind: input.kind,
          workingDir,
          metadata: { runId, prId, repairId },
        }),
      ];
    }
  }
}

export function createMeleeKernelSpawnContext(
  input: MeleeKernelSpawnContextInput,
): MeleeKernelSpawnContext {
  const ref = baseRef(input);
  const appSessionId = meleeAppSessionId(ref);
  const runId = nonEmpty(input.runId);
  const prId = nonEmpty(input.prId);
  const epochId = nonEmpty(input.epochId);
  const claimId = nonEmpty(input.claimId);
  const itemId = nonEmpty(input.itemId);
  const targetId = nonEmpty(input.targetId);

  return {
    appSessionId,
    containerId: containerId(input, ref),
    containerLineage: containerLineage(input, ref, appSessionId),
    phase: nonEmpty(input.phase) ?? defaultPhase(input.kind),
    workingDir: nonEmpty(input.workingDir),
    metadata: {
      containerKind: input.kind,
      projectId: ref.projectId,
      sessionId: ref.sessionId,
      ...(runId ? { runId } : {}),
      ...(epochId ? { epochId } : {}),
      ...(claimId ? { claimId } : {}),
      ...(itemId ? { itemId } : {}),
      ...(targetId ? { targetId } : {}),
      ...(prId ? { prId } : {}),
      ...(nonEmpty(input.reviewId) ? { reviewId: nonEmpty(input.reviewId) } : {}),
      ...(nonEmpty(input.repairId) ? { repairId: nonEmpty(input.repairId) } : {}),
      ...(input.metadata ?? {}),
    },
  };
}
