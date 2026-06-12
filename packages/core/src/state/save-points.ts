import { randomUUID } from "node:crypto";
import { immediateTransaction, now, withBusyRetry, type StateStore } from "./db.js";

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
  reportPath?: string | null;
  reportChangesPath?: string | null;
  boardSnapshotPath?: string | null;
  artifactDir?: string | null;
  payload?: Record<string, unknown>;
}

function campaignFromRow(row: Record<string, unknown>): CampaignRecord {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    branch: row.branch ? String(row.branch) : null,
    baseRef: String(row.base_ref),
    createdAt: String(row.created_at),
  };
}

function savePointFromRow(row: Record<string, unknown>): SavePointRecord {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    runId: row.run_id ? String(row.run_id) : null,
    triggerKind: String(row.trigger_kind) as SavePointTrigger,
    label: row.label ? String(row.label) : null,
    commitSha: row.commit_sha ? String(row.commit_sha) : null,
    branch: row.branch ? String(row.branch) : null,
    baseRef: row.base_ref ? String(row.base_ref) : null,
    baseSha: row.base_sha ? String(row.base_sha) : null,
    worktreeDirty: Boolean(row.worktree_dirty),
    committed: Boolean(row.committed),
    matchedCodePercent: row.matched_code_percent === null || row.matched_code_percent === undefined ? null : Number(row.matched_code_percent),
    reportPath: row.report_path ? String(row.report_path) : null,
    reportChangesPath: row.report_changes_path ? String(row.report_changes_path) : null,
    boardSnapshotPath: row.board_snapshot_path ? String(row.board_snapshot_path) : null,
    artifactDir: row.artifact_dir ? String(row.artifact_dir) : null,
    payload,
    createdAt: String(row.created_at),
  };
}

/**
 * One campaign per state dir: the long-lived canonical timeline a project's
 * runs, save points, and ledger all hang off. Returns the existing campaign
 * when present so repeated calls are idempotent.
 */
export function ensureCampaign(store: StateStore, input: { projectId?: string | null; branch?: string | null; baseRef?: string }): CampaignRecord {
  const existing = withBusyRetry(
    () => store.db.query("SELECT * FROM campaigns ORDER BY created_at ASC LIMIT 1").get() as Record<string, unknown> | undefined,
  );
  if (existing) {
    if (input.branch && !existing.branch) {
      store.db.query("UPDATE campaigns SET branch = ? WHERE id = ?").run(input.branch, String(existing.id));
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
    store.db
      .query("INSERT INTO campaigns (id, project_id, branch, base_ref, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(campaign.id, campaign.projectId, campaign.branch, campaign.baseRef, campaign.createdAt);
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
    reportPath: input.reportPath ?? null,
    reportChangesPath: input.reportChangesPath ?? null,
    boardSnapshotPath: input.boardSnapshotPath ?? null,
    artifactDir: input.artifactDir ?? null,
    payload: input.payload ?? {},
    createdAt: now(),
  };
  immediateTransaction(store.db, () => {
    store.db
      .query(
        `
          INSERT INTO save_points (
            id, campaign_id, run_id, trigger_kind, label,
            commit_sha, branch, base_ref, base_sha,
            worktree_dirty, committed, matched_code_percent,
            report_path, report_changes_path, board_snapshot_path, artifact_dir,
            payload_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.id,
        record.campaignId,
        record.runId,
        record.triggerKind,
        record.label,
        record.commitSha,
        record.branch,
        record.baseRef,
        record.baseSha,
        record.worktreeDirty ? 1 : 0,
        record.committed ? 1 : 0,
        record.matchedCodePercent,
        record.reportPath,
        record.reportChangesPath,
        record.boardSnapshotPath,
        record.artifactDir,
        JSON.stringify(record.payload),
        record.createdAt,
      );
  });
  return record;
}

export function latestSavePoint(store: StateStore): SavePointRecord | null {
  const row = withBusyRetry(
    () => store.db.query("SELECT * FROM save_points ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined,
  );
  return row ? savePointFromRow(row) : null;
}

export function listSavePoints(store: StateStore, limit = 50): SavePointRecord[] {
  const rows = withBusyRetry(
    () => store.db.query("SELECT * FROM save_points ORDER BY created_at DESC LIMIT ?").all(Math.max(1, limit)) as Array<Record<string, unknown>>,
  );
  return rows.map(savePointFromRow);
}
