import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createRun, openState } from "@server/core/session-runtime/run-state";
import type { ResolvedProject } from "@server/core/project-registry";
import type { ManagedProcessController, StartManagedInput } from "@server/infrastructure/process-control/managed-process-controller";
import { createProcessControlRuntime } from "./runtime.js";

describe("process control runtime", () => {
  test("starts a run from the run's recorded session worktree", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "process-control-runtime-"));
    const sessionRepoRoot = "/tmp/colosseum-session-worktree/source";
    const sessionGraphDb = "/tmp/colosseum-session-worktree/graph.sqlite";
    const store = openState(stateDir);
    const run = createRun(store, "matched_code_percent", 100, 2, {
      projectId: "colosseum",
      projectKind: "dtk-pokemon-colosseum",
      repoRoot: sessionRepoRoot,
      stateDir,
      graphDbPath: sessionGraphDb,
      descriptorPath: "/tmp/colosseum/project.json",
    });
    store.db.close();

    let spawned: StartManagedInput | null = null;
    const processController = {
      hasActiveProcess: () => ({ active: false }),
      spawn: (input: StartManagedInput) => {
        spawned = input;
      },
    } as unknown as ManagedProcessController;

    const project = {
      projectId: "colosseum",
      processName: "colosseum-live",
      dashboard: {},
      repoRoot: "/tmp/colosseum-default-checkout",
      stateDir,
      graphDbPath: "/tmp/colosseum-default-graph.sqlite",
    } as unknown as ResolvedProject;

    const runtime = createProcessControlRuntime({
      appendLog: () => undefined,
      json: (data, init) => new Response(JSON.stringify(data), init),
      processController,
      processStatus: () => ({}),
      projectToSummary: () => ({
        id: "colosseum",
        displayName: "Colosseum",
        kind: "dtk-pokemon-colosseum",
        repoRoot: project.repoRoot,
        stateDir,
        graphDbPath: project.graphDbPath,
        processName: "colosseum-live",
        baseRef: "origin/master",
        descriptorPath: "/tmp/colosseum/project.json",
        repoRootExists: true,
        stateDirExists: true,
        graphDbExists: true,
      }),
      resolveDashboardProject: () => ({
        project,
        repoRoot: project.repoRoot,
        stateDir,
        graphDbPath: project.graphDbPath,
        usePathOverrides: false,
      }),
      runCli: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      serverJobPath: "/tmp/orchestrator/apps/server/src/job-runner.ts",
    });

    const response = await runtime.startManagedProcess({ projectId: "colosseum", runId: run.id, maxWorkers: 2 });
    const payload = (await response.json()) as { command: string[] };
    const repoRootFlag = payload.command.indexOf("--repo-root");
    const graphDbFlag = payload.command.indexOf("--graph-db");

    expect(response.status).toBe(200);
    expect(payload.command.slice(repoRootFlag, repoRootFlag + 2)).toEqual(["--repo-root", sessionRepoRoot]);
    expect(payload.command.slice(graphDbFlag, graphDbFlag + 2)).toEqual(["--graph-db", sessionGraphDb]);
    expect((spawned as StartManagedInput | null)?.command.slice(repoRootFlag, repoRootFlag + 2)).toEqual(["--repo-root", sessionRepoRoot]);
  });
});
