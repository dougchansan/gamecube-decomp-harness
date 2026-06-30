import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { artifactTimestamp } from "@server/infrastructure/agent-runtime/runtime";
import {
  addSavePoint,
  ensureCampaign,
  listSavePoints,
  type SavePointTrigger,
} from "@server/core/session-runtime/phases/pr/state";
import { getLatestRun, openState } from "@server/core/session-runtime/run-state";
import { recordDashboardArtifact } from "@server/core/orchestrator-state";
import { loadTrustedReportFile } from "@server/core/validation/report";
import { booleanArg, numberArg, stringArg, type GlobalArgs } from "@server/core/project-registry/runtime-options.js";

const SAVE_POINT_TRIGGERS: SavePointTrigger[] = ["manual", "init", "pause", "checkpoint", "qa", "ship", "sync", "fresh", "epoch"];

/** Paths never staged by a save-point commit: the nested orchestrator repo and generated state. */
const COMMIT_EXCLUDES = ["decomp-orchestrator", ".decomp-orchestrator-state"];

interface GitResult {
  ok: boolean;
  text: string;
}

async function git(repoRoot: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", "-C", repoRoot, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { ok: exitCode === 0, text: exitCode === 0 ? stdout.trimEnd() : stderr.trim() };
}

function parseTrigger(value: string): SavePointTrigger {
  if ((SAVE_POINT_TRIGGERS as string[]).includes(value)) return value as SavePointTrigger;
  throw new Error(`--trigger must be one of: ${SAVE_POINT_TRIGGERS.join(", ")}`);
}

function excludedStatusLine(line: string, stateDirRelative: string | null): boolean {
  const path = line.slice(3).trim().replace(/^"|"$/g, "");
  if (COMMIT_EXCLUDES.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))) return true;
  if (stateDirRelative && (path === stateDirRelative || path.startsWith(`${stateDirRelative}/`))) return true;
  return false;
}

function stateDirRelativeToRepo(repoRoot: string, stateDir: string): string | null {
  const rel = relative(repoRoot, stateDir);
  return rel && !rel.startsWith("..") ? rel : null;
}

async function dirtyStatusLines(repoRoot: string, stateDirRelative: string | null): Promise<string[]> {
  const status = await git(repoRoot, ["status", "--short", "--ignore-submodules=all"]);
  if (!status.ok) return [];
  return status.text
    .split("\n")
    .filter(Boolean)
    .filter((line) => !excludedStatusLine(line, stateDirRelative));
}

async function commitWorktree(
  repoRoot: string,
  stateDirRelative: string | null,
  message: string,
): Promise<{ committed: boolean; warning: string | null }> {
  const excludes = [...COMMIT_EXCLUDES, ...(stateDirRelative ? [stateDirRelative] : [])];
  const addArgs = ["add", "-A", "--", ".", ...excludes.map((path) => `:(exclude)${path}`)];
  const add = await git(repoRoot, addArgs);
  if (!add.ok) return { committed: false, warning: `git add failed: ${add.text}` };
  const commit = await git(repoRoot, ["commit", "-m", message]);
  if (!commit.ok) {
    const skipped = /nothing to commit|nothing added to commit/.test(commit.text);
    return { committed: false, warning: skipped ? null : `git commit failed: ${commit.text}` };
  }
  return { committed: true, warning: null };
}

export async function savePoint(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const store = openState(globals.stateDir);
  try {
    if (booleanArg(args, "--list")) {
      const limit = Math.max(1, Math.floor(numberArg(args, "--limit", 50)));
      console.log(JSON.stringify({ savePoints: listSavePoints(store, limit) }, null, 2));
      return;
    }

    const triggerKind = parseTrigger(stringArg(args, "--trigger", "manual"));
    const label = stringArg(args, "--label", "") || null;
    const baseRef = stringArg(args, "--base-ref", globals.project?.baseRef ?? "origin/master");
    const allowCommit = !booleanArg(args, "--no-commit");
    const stateDirRelative = stateDirRelativeToRepo(globals.repoRoot, globals.stateDir);

    const branchResult = await git(globals.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchResult.ok ? branchResult.text : null;
    const campaign = ensureCampaign(store, { projectId: globals.project?.projectId ?? globals.projectId ?? null, branch, baseRef });

    let warning: string | null = null;
    let committed = false;
    const dirtyBefore = await dirtyStatusLines(globals.repoRoot, stateDirRelative);
    if (dirtyBefore.length > 0 && allowCommit) {
      const message = `savepoint(${triggerKind}): ${label ?? artifactTimestamp()}`;
      const result = await commitWorktree(globals.repoRoot, stateDirRelative, message);
      committed = result.committed;
      warning = result.warning;
    }
    const dirtyAfter = committed ? await dirtyStatusLines(globals.repoRoot, stateDirRelative) : dirtyBefore;

    const head = await git(globals.repoRoot, ["rev-parse", "HEAD"]);
    const base = await git(globals.repoRoot, ["rev-parse", baseRef]);
    const aheadOfBase = await git(globals.repoRoot, ["rev-list", "--count", `${baseRef}..HEAD`]);

    const artifactDir = resolve(globals.stateDir, "save_points", artifactTimestamp());
    await mkdir(artifactDir, { recursive: true });
    const reportSource = resolve(globals.repoRoot, "build/GC6E01/report.json");
    const baselineSource = resolve(globals.repoRoot, "build/GC6E01/baseline.json");
    const reportChangesSource = resolve(globals.repoRoot, "build/GC6E01/report_changes.json");
    let reportPath: string | null = null;
    let reportChangesPath: string | null = null;
    let measuresSource: string | null = null;
    if (existsSync(reportSource)) {
      reportPath = resolve(artifactDir, "report.json");
      copyFileSync(reportSource, reportPath);
      measuresSource = "report";
    } else if (existsSync(baselineSource)) {
      // No fresh report; anchor to the saved baseline so the save point still
      // records the real repo position instead of nothing.
      reportPath = resolve(artifactDir, "baseline.json");
      copyFileSync(baselineSource, reportPath);
      measuresSource = "baseline";
    }
    if (existsSync(reportChangesSource)) {
      reportChangesPath = resolve(artifactDir, "report_changes.json");
      copyFileSync(reportChangesSource, reportChangesPath);
    }

    let matchedCodePercent: number | null = null;
    let measures: Record<string, unknown> = {};
    if (reportPath) {
      try {
        const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
        const rawMeasures = parsed.measures;
        if (rawMeasures && typeof rawMeasures === "object" && !Array.isArray(rawMeasures)) {
          measures = rawMeasures as Record<string, unknown>;
          const value = Number(measures.matched_code_percent);
          matchedCodePercent = Number.isFinite(value) ? value : null;
        }
      } catch {
        matchedCodePercent = null;
      }
    }
    const boardSnapshotPath = resolve(artifactDir, "board_snapshot.json");
    await writeFile(
      boardSnapshotPath,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          commit_sha: head.ok ? head.text : null,
          branch,
          base_ref: baseRef,
          measures,
        },
        null,
        2,
      )}\n`,
    );

    const latestRun = getLatestRun(store);
    const record = addSavePoint(store, {
      campaignId: campaign.id,
      runId: latestRun?.id ?? null,
      triggerKind,
      label,
      commitSha: head.ok ? head.text : null,
      branch,
      baseRef,
      baseSha: base.ok ? base.text : null,
      worktreeDirty: dirtyAfter.length > 0,
      committed,
      matchedCodePercent,
      reportPath,
      reportChangesPath,
      boardSnapshotPath,
      artifactDir,
      payload: {
        ahead_of_base: aheadOfBase.ok ? Number(aheadOfBase.text) : null,
        dirty_paths: dirtyAfter.slice(0, 100),
        commit_warning: warning,
        measures,
        measures_source: measuresSource,
      },
    });
    if (Object.keys(measures).length > 0) {
      recordDashboardArtifact(store, {
        runId: record.runId,
        projectId: globals.project?.projectId ?? globals.projectId ?? null,
        artifactType: "board_snapshot",
        artifactKey: "current",
        sourcePath: reportPath,
        sourceLabel: measuresSource ?? "save_point",
        payload: {
          generatedAt: record.createdAt,
          measures,
          candidates: [],
          reportPath,
          source: measuresSource ?? "save_point",
          savePointId: record.id,
          savePointSha: record.commitSha,
        },
        createdAt: record.createdAt,
      });
    }
    if (reportChangesPath) {
      const trustedReport = await loadTrustedReportFile(reportChangesPath, "build/GC6E01/report_changes.json", 0);
      if (trustedReport.status === "ready") {
        recordDashboardArtifact(store, {
          runId: record.runId,
          projectId: globals.project?.projectId ?? globals.projectId ?? null,
          artifactType: "trusted_report",
          artifactKey: "current",
          sourcePath: reportChangesPath,
          sourceLabel: "build/GC6E01/report_changes.json",
          payload: trustedReport as unknown as Record<string, unknown>,
          createdAt: trustedReport.generatedAt ?? record.createdAt,
        });
      }
    }

    console.log(JSON.stringify({ savePoint: record, campaign, warning }, null, 2));
  } finally {
    store.db.close();
  }
}
