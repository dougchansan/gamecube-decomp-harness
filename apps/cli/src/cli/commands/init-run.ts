import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadKnowledgeBoardSnapshot, resourceGraphDbPath } from "@decomp-orchestrator/knowledge";
import { createRun, openState, refillQueuedTargets } from "@decomp-orchestrator/core/state";
import { numberArg, projectMetadata, stringArg, type GlobalArgs } from "../args.js";

export async function initRun(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const store = openState(globals.stateDir);
  const goalKind = stringArg(args, "--goal-kind", "matched_code_percent");
  const goalValue = numberArg(args, "--goal-value", globals.project?.dashboard.goalValue ?? 70);
  const desiredWorkers = numberArg(args, "--desired-workers", 16);
  const candidateLimit = numberArg(args, "--candidate-limit", globals.project?.dashboard.candidateLimit ?? Math.max(32, desiredWorkers * 2));
  const graphDbPath = stringArg(args, "--graph-db", globals.graphDbPath ?? resourceGraphDbPath());
  const project = projectMetadata(globals, { graphDbPath });
  const run = createRun(store, goalKind, goalValue, desiredWorkers, project);

  // Worker parallelism is capped by the number of distinct source files in the
  // queue (one write lock per file), so keep widening the candidate window
  // until the queue holds at least desiredWorkers schedulable files or the
  // board runs out of candidates.
  let candidateWindow = Math.max(
    candidateLimit,
    numberArg(args, "--candidate-window", globals.project?.dashboard.candidateWindow ?? candidateLimit * 8),
  );
  let snapshot = loadKnowledgeBoardSnapshot(globals.repoRoot, candidateWindow, { graphDbPath });
  let refill = refillQueuedTargets(store, run.id, snapshot.candidates, {
    targetSize: candidateLimit,
    minSchedulableSources: desiredWorkers,
  });
  while ((refill.queuedAfter < candidateLimit || refill.schedulableAfter < desiredWorkers) && snapshot.candidates.length >= candidateWindow) {
    candidateWindow *= 2;
    snapshot = loadKnowledgeBoardSnapshot(globals.repoRoot, candidateWindow, { graphDbPath });
    refill = refillQueuedTargets(store, run.id, snapshot.candidates, {
      targetSize: candidateLimit,
      minSchedulableSources: desiredWorkers,
    });
  }

  await mkdir(resolve(globals.stateDir, "runs", run.id, "snapshots"), { recursive: true });
  await writeFile(resolve(globals.stateDir, "runs", run.id, "snapshots", "initial_board.json"), JSON.stringify(snapshot, null, 2));
  console.log(
    JSON.stringify(
      {
        run,
        project: project ?? null,
        targetCount: refill.queuedAfter,
        schedulableSources: refill.schedulableAfter,
        candidateWindow,
        stateDir: globals.stateDir,
        graphDbPath,
        measures: snapshot.measures,
      },
      null,
      2,
    ),
  );
}
