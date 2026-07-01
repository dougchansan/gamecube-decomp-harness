import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  campaigns,
  immediateTransaction,
  now,
  reportSnapshots,
  savePoints,
  type CampaignRow,
  type SavePointRow,
  type StateStore,
} from "@server/core/orchestrator-state";

export type SavePointTrigger = "manual" | "init" | "pause" | "checkpoint" | "qa" | "ship" | "sync" | "fresh" | "epoch";

export interface CampaignRecord {
  id: string;
  projectId: string | null;
  branch: string | null;
  baseRef: string;
  createdAt: string;
}

export interface SavePointRecord {
  id: string;
  campaignId: string;
  runId: string | null;
  triggerKind: SavePointTrigger;
  label: string | null;
  commitSha: string | null;
  branch: string | null;
  baseRef: string | null;
  baseSha: string | null;
  worktreeDirty: boolean;
  committed: boolean;
  matchedCodePercent: number | null;
  matchedDataPercent: number | null;
  matchedFunctionsPercent: number | null;
  reportPath: string | null;
  reportChangesPath: string | null;
  boardSnapshotPath: string | null;
  artifactDir: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SavePointInput {
  campaignId: string;
  runId?: string | null;
  triggerKind: SavePointTrigger;
  label?: string | null;
  commitSha?: string | null;
  branch?: string | null;
  baseRef?: string | null;
  baseSha?: string | null;
  worktreeDirty?: boolean;
  committed?: boolean;
  matchedCodePercent?: number | null;
  matchedDataPercent?: number | null;
  matchedFunctionsPercent?: number | null;
  reportPath?: string | null;
  reportChangesPath?: string | null;
  boardSnapshotPath?: string | null;
  artifactDir?: string | null;
  payload?: Record<string, unknown>;
}

function campaignFromRow(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    branch: row.branch ? String(row.branch) : null,
    baseRef: row.baseRef,
    createdAt: row.createdAt,
  };
}

function savePointFromRow(row: SavePointRow): SavePointRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    runId: row.runId,
    triggerKind: row.triggerKind as SavePointTrigger,
    label: row.label ? String(row.label) : null,
    commitSha: row.commitSha ? String(row.commitSha) : null,
    branch: row.branch ? String(row.branch) : null,
    baseRef: row.baseRef ? String(row.baseRef) : null,
    baseSha: row.baseSha ? String(row.baseSha) : null,
    worktreeDirty: row.worktreeDirty,
    committed: row.committed,
    matchedCodePercent: row.matchedCodePercent,
    matchedDataPercent: row.matchedDataPercent,
    matchedFunctionsPercent: row.matchedFunctionsPercent,
    reportPath: row.reportPath ? String(row.reportPath) : null,
    reportChangesPath: row.reportChangesPath ? String(row.reportChangesPath) : null,
    boardSnapshotPath: row.boardSnapshotPath ? String(row.boardSnapshotPath) : null,
    artifactDir: row.artifactDir ? String(row.artifactDir) : null,
    payload: row.payloadJson,
    createdAt: row.createdAt,
  };
}

/**
 * One campaign per state dir: the long-lived canonical timeline a project's
 * runs, save points, and ledger all hang off. Returns the existing campaign
 * when present so repeated calls are idempotent.
 */
export function ensureCampaign(store: StateStore, input: { projectId?: string | null; branch?: string | null; baseRef?: string }): CampaignRecord {
  const existing = store.orm.select().from(campaigns).orderBy(campaigns.createdAt).limit(1).get();
  if (existing) {
    if (input.branch && !existing.branch) {
      store.orm.update(campaigns).set({ branch: input.branch }).where(eq(campaigns.id, existing.id)).run();
      existing.branch = input.branch;
    }
    return campaignFromRow(existing);
  }
  const campaign: CampaignRecord = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    branch: input.branch ?? null,
    baseRef: input.baseRef ?? "origin/master",
    createdAt: now(),
  };
  immediateTransaction(store.db, () => {
    store.orm
      .insert(campaigns)
      .values({
        id: campaign.id,
        projectId: campaign.projectId,
        branch: campaign.branch,
        baseRef: campaign.baseRef,
        createdAt: campaign.createdAt,
      })
      .run();
  });
  return campaign;
}

export function addSavePoint(store: StateStore, input: SavePointInput): SavePointRecord {
  const record: SavePointRecord = {
    id: randomUUID(),
    campaignId: input.campaignId,
    runId: input.runId ?? null,
    triggerKind: input.triggerKind,
    label: input.label ?? null,
    commitSha: input.commitSha ?? null,
    branch: input.branch ?? null,
    baseRef: input.baseRef ?? null,
    baseSha: input.baseSha ?? null,
    worktreeDirty: input.worktreeDirty ?? false,
    committed: input.committed ?? false,
    matchedCodePercent: input.matchedCodePercent ?? null,
    matchedDataPercent: input.matchedDataPercent ?? null,
    matchedFunctionsPercent: input.matchedFunctionsPercent ?? null,
    reportPath: input.reportPath ?? null,
    reportChangesPath: input.reportChangesPath ?? null,
    boardSnapshotPath: input.boardSnapshotPath ?? null,
    artifactDir: input.artifactDir ?? null,
    payload: input.payload ?? {},
    createdAt: now(),
  };
  immediateTransaction(store.db, () => {
    store.orm
      .insert(savePoints)
      .values({
        id: record.id,
        campaignId: record.campaignId,
        runId: record.runId,
        triggerKind: record.triggerKind,
        label: record.label,
        commitSha: record.commitSha,
        branch: record.branch,
        baseRef: record.baseRef,
        baseSha: record.baseSha,
        worktreeDirty: record.worktreeDirty,
        committed: record.committed,
        matchedCodePercent: record.matchedCodePercent,
        matchedDataPercent: record.matchedDataPercent,
        matchedFunctionsPercent: record.matchedFunctionsPercent,
        reportPath: record.reportPath,
        reportChangesPath: record.reportChangesPath,
        boardSnapshotPath: record.boardSnapshotPath,
        artifactDir: record.artifactDir,
        payloadJson: record.payload,
        createdAt: record.createdAt,
      })
      .run();
  });
  return record;
}

export type ReportSnapshotSource = "epoch" | "save_point" | "periodic";

export interface ReportSnapshotInput {
  runId: string;
  source: ReportSnapshotSource;
  fuzzyMatchPercent?: number | null;
  matchedCodePercent?: number | null;
  completeCodePercent?: number | null;
  matchedDataPercent?: number | null;
  matchedFunctionsPercent?: number | null;
  completeUnits?: number | null;
  totalUnits?: number | null;
  reportPath?: string | null;
  at?: string;
}

/**
 * Telemetry (Track B): append-only dense match-over-time row. Written alongside
 * each epoch save point from the same report `measures` block so the dashboard
 * can plot code/data/function progress between the sparse epoch checkpoints.
 */
export function addReportSnapshot(store: StateStore, input: ReportSnapshotInput): string {
  const id = randomUUID();
  const at = input.at ?? now();
  immediateTransaction(store.db, () => {
    store.orm
      .insert(reportSnapshots)
      .values({
        id,
        runId: input.runId,
        at,
        source: input.source,
        fuzzyMatchPercent: input.fuzzyMatchPercent ?? null,
        matchedCodePercent: input.matchedCodePercent ?? null,
        completeCodePercent: input.completeCodePercent ?? null,
        matchedDataPercent: input.matchedDataPercent ?? null,
        matchedFunctionsPercent: input.matchedFunctionsPercent ?? null,
        completeUnits: input.completeUnits ?? null,
        totalUnits: input.totalUnits ?? null,
        reportPath: input.reportPath ?? null,
      })
      .run();
  });
  return id;
}

export function latestSavePoint(store: StateStore): SavePointRecord | null {
  const row = store.orm.select().from(savePoints).orderBy(desc(savePoints.createdAt)).limit(1).get();
  return row ? savePointFromRow(row) : null;
}

export function listSavePoints(store: StateStore, limit = 50): SavePointRecord[] {
  return store.orm
    .select()
    .from(savePoints)
    .orderBy(desc(savePoints.createdAt))
    .limit(Math.max(1, limit))
    .all()
    .map(savePointFromRow);
}
