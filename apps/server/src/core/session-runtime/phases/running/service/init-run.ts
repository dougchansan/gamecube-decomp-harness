import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadKnowledgeBoardSnapshot, resourceGraphDbPath } from "@server/core/knowledge";
import { createRun, openState } from "@server/core/session-runtime/run-state";
import { recordDashboardArtifact } from "@server/core/orchestrator-state";
import { numberArg, projectMetadata, stringArg, type GlobalArgs } from "@server/core/project-registry/runtime-options.js";

export async function initRun(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const store = openState(globals.stateDir);
  try {
    const goalKind = stringArg(args, "--goal-kind", "matched_code_percent");
    const goalValue = numberArg(args, "--goal-value", globals.project?.dashboard.goalValue ?? 70);
    const desiredWorkers = numberArg(args, "--desired-workers", 16);
    const candidateLimit = numberArg(args, "--candidate-limit", globals.project?.dashboard.candidateLimit ?? Math.max(32, desiredWorkers * 2));
    const graphDbPath = stringArg(args, "--graph-db", globals.graphDbPath ?? resourceGraphDbPath());
    const project = projectMetadata(globals, { graphDbPath });
    const run = createRun(store, goalKind, goalValue, desiredWorkers, project);

    const candidateWindow = Math.max(
      candidateLimit,
      numberArg(args, "--candidate-window", globals.project?.dashboard.candidateWindow ?? candidateLimit * 8),
    );
    const snapshot = loadKnowledgeBoardSnapshot(globals.repoRoot, candidateWindow, {
      graphDbPath,
      objdiffPath: globals.project?.validation.objdiffPath,
      projectId: globals.project?.projectId ?? globals.projectId,
      reportPath: globals.project?.validation.reportPath,
    });
    const schedulableSources = new Set(snapshot.candidates.map((candidate) => candidate.sourcePath).filter(Boolean)).size;

    await mkdir(resolve(globals.stateDir, "runs", run.id, "snapshots"), { recursive: true });
    await writeFile(resolve(globals.stateDir, "runs", run.id, "snapshots", "initial_board.json"), JSON.stringify(snapshot, null, 2));
    recordDashboardArtifact(store, {
      runId: run.id,
      projectId: project?.projectId ?? globals.projectId ?? null,
      artifactType: "board_snapshot",
      artifactKey: "initial",
      sourcePath: snapshot.reportPath,
      sourceLabel: "initial_board",
      payload: snapshot as unknown as Record<string, unknown>,
      createdAt: snapshot.generatedAt,
    });
    console.log(
      JSON.stringify(
        {
          run,
          project: project ?? null,
          targetCount: snapshot.candidates.length,
          schedulableSources,
          candidateWindow,
          stateDir: globals.stateDir,
          graphDbPath,
          measures: snapshot.measures,
        },
        null,
        2,
      ),
    );
  } finally {
    store.db.close();
  }
}
