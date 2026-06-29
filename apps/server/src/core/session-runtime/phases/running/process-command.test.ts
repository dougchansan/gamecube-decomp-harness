import { describe, expect, test } from "bun:test";
import { buildRunningProcessCommand, runningScheduling } from "./process-command.js";

describe("running process command", () => {
  test("derives worker scheduling from requested workers", () => {
    expect(runningScheduling(8)).toMatchObject({
      maxWorkers: 8,
      candidateLimit: 32,
      queueTargetSize: 32,
      queueLowWatermark: 8,
      epochReadyQueueSize: 32,
    });
  });

  test("builds the babysit command owned by the running phase", () => {
    const plan = buildRunningProcessCommand({
      body: {
        maxWorkers: 4,
        provider: "codex-lb",
        model: "gpt-5.5",
        thinkingLevel: "medium",
        workerThinkingLevel: "high",
        dryRunAgents: true,
      },
      graphDbPath: "/state/graph.sqlite",
      noRefillBatch: false,
      project: { projectId: "melee", processName: "melee-live", dashboard: { epochSize: "64" } },
      repoRoot: "/repo",
      runId: "run-1",
      serverJobPath: "/orch/apps/server/src/job-runner.ts",
      stateDir: "/state",
    });

    expect(plan.name).toBe("melee-live");
    expect(plan.maxWorkers).toBe(4);
    expect(plan.command).toContain("babysit");
    expect(plan.command).toContain("--dry-run-agents");
    expect(plan.command).toContain("--run-id");
    expect(plan.command).toContain("run-1");
    expect(plan.command).toContain("--epoch-size");
    expect(plan.command).toContain("64");
  });

  test("passes configured worker timeout to babysit", () => {
    const plan = buildRunningProcessCommand({
      body: {
        agentTimeoutSeconds: 3000,
        maxWorkers: 4,
      },
      graphDbPath: "/state/graph.sqlite",
      noRefillBatch: false,
      project: { projectId: "melee", processName: "melee-live" },
      repoRoot: "/repo",
      runId: "run-1",
      serverJobPath: "/orch/apps/server/src/job-runner.ts",
      stateDir: "/state",
    });

    const timeoutFlag = plan.command.indexOf("--agent-timeout-seconds");
    expect(plan.command.slice(timeoutFlag, timeoutFlag + 2)).toEqual(["--agent-timeout-seconds", "3000"]);
  });

  test("uses project dashboard worker timeout default", () => {
    const plan = buildRunningProcessCommand({
      body: {
        maxWorkers: 4,
      },
      graphDbPath: "/state/graph.sqlite",
      noRefillBatch: false,
      project: { projectId: "melee", processName: "melee-live", dashboard: { agentTimeoutSeconds: 2400 } },
      repoRoot: "/repo",
      runId: "run-1",
      serverJobPath: "/orch/apps/server/src/job-runner.ts",
      stateDir: "/state",
    });

    const timeoutFlag = plan.command.indexOf("--agent-timeout-seconds");
    expect(plan.command.slice(timeoutFlag, timeoutFlag + 2)).toEqual(["--agent-timeout-seconds", "2400"]);
  });

  test("uses no-refill mode for never-run repair batches", () => {
    const plan = buildRunningProcessCommand({
      body: { maxWorkers: 4 },
      graphDbPath: "/state/graph.sqlite",
      noRefillBatch: true,
      project: { projectId: "melee" },
      repoRoot: "/repo",
      runId: "run-1",
      serverJobPath: "/orch/apps/server/src/job-runner.ts",
      stateDir: "/state",
    });

    expect(plan.command).toContain("--no-epoch-cycle");
    expect(plan.command).toContain("--no-blocked-queue-replan");
    expect(plan.command).toContain("--agent-timeout-seconds");
    expect(plan.command).toContain("3000");
  });
});
