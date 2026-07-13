import { describe, expect, test } from "bun:test";
import {
  evaluateFastKnowledgeMaintenanceDecision,
  integrationResolveCommand,
  PENDING_CLAIM_TIMEOUT_MS,
  reapStuckPendingWorkers,
  runLoopWorkerCommand,
  shouldRefreshSchedulerBoard,
  workerOpenSlots,
} from "./run-loop.js";
import type { GlobalArgs } from "@server/core/project-registry/runtime-options.js";

type WorkerProcRegistry = Map<string, { proc: { kill: (signal?: number) => void; exited: Promise<number> }; spawnedAtMs: number }>;

function makeRegistry(now: number, entries: Array<{ id: string; ageMs: number }>): { map: WorkerProcRegistry; kills: string[] } {
  const kills: string[] = [];
  const map: WorkerProcRegistry = new Map();
  for (const entry of entries) {
    map.set(entry.id, {
      proc: {
        kill: (_signal?: number) => {
          kills.push(entry.id);
        },
        exited: Promise.resolve(0),
      },
      spawnedAtMs: now - entry.ageMs,
    });
  }
  return { map, kills };
}

describe("evaluateFastKnowledgeMaintenanceDecision", () => {
  test("does nothing before interval or report count triggers are due", () => {
    expect(
      evaluateFastKnowledgeMaintenanceDecision({
        intervalMs: 180_000,
        lastMaintenanceMs: 1_000,
        nowMs: 120_000,
        reportCountTrigger: 16,
        reportsSinceRefresh: 4,
        running: false,
      }),
    ).toMatchObject({ action: "none", reportDue: false, timeDue: false });
  });

  test("skips due fast refreshes when no worker states changed", () => {
    expect(
      evaluateFastKnowledgeMaintenanceDecision({
        intervalMs: 180_000,
        lastMaintenanceMs: 0,
        nowMs: 180_000,
        reportCountTrigger: 16,
        reportsSinceRefresh: 0,
        running: false,
      }),
    ).toMatchObject({ action: "skip_no_new_reports", reason: "no_new_reports", reportDue: false, timeDue: true });
  });

  test("starts on coalesced report count even before the interval", () => {
    expect(
      evaluateFastKnowledgeMaintenanceDecision({
        intervalMs: 180_000,
        lastMaintenanceMs: 0,
        nowMs: 60_000,
        reportCountTrigger: 16,
        reportsSinceRefresh: 16,
        running: false,
      }),
    ).toMatchObject({ action: "start", reason: "report_count", reportDue: true, timeDue: false });
  });

  test("defers due fast refreshes while one is already running", () => {
    expect(
      evaluateFastKnowledgeMaintenanceDecision({
        intervalMs: 180_000,
        lastMaintenanceMs: 0,
        nowMs: 180_000,
        reportCountTrigger: 16,
        reportsSinceRefresh: 20,
        running: true,
      }),
    ).toMatchObject({ action: "defer", reason: "report_count", reportDue: true, timeDue: true });
  });
});

describe("reapStuckPendingWorkers (pending-claim watchdog)", () => {
  const now = 1_000_000_000;

  test("reaps a spawned worker with no active claim past the timeout", () => {
    const { map, kills } = makeRegistry(now, [{ id: "w-stuck", ageMs: PENDING_CLAIM_TIMEOUT_MS + 1 }]);
    const reaped = reapStuckPendingWorkers({ workerProcs: map, claimedWorkerIds: new Set(), nowMs: now, timeoutMs: PENDING_CLAIM_TIMEOUT_MS });
    expect(reaped).toEqual(["w-stuck"]);
    expect(kills).toEqual(["w-stuck"]);
  });

  test("NEVER reaps a worker holding an active claim, even a 3-minute build", () => {
    const { map, kills } = makeRegistry(now, [{ id: "w-building", ageMs: 3 * 60_000 }]);
    const reaped = reapStuckPendingWorkers({ workerProcs: map, claimedWorkerIds: new Set(["w-building"]), nowMs: now, timeoutMs: PENDING_CLAIM_TIMEOUT_MS });
    expect(reaped).toEqual([]);
    expect(kills).toEqual([]);
  });

  test("does not reap a pending worker still within the timeout", () => {
    const { map, kills } = makeRegistry(now, [{ id: "w-young", ageMs: PENDING_CLAIM_TIMEOUT_MS - 1 }]);
    const reaped = reapStuckPendingWorkers({ workerProcs: map, claimedWorkerIds: new Set(), nowMs: now, timeoutMs: PENDING_CLAIM_TIMEOUT_MS });
    expect(reaped).toEqual([]);
    expect(kills).toEqual([]);
  });

  test("mixed: reaps only the stuck pre-claim worker; claimed + young survive; onReap fires with age", () => {
    const { map, kills } = makeRegistry(now, [
      { id: "w-stuck", ageMs: PENDING_CLAIM_TIMEOUT_MS + 5_000 },
      { id: "w-building", ageMs: 5 * 60_000 },
      { id: "w-young", ageMs: 10_000 },
    ]);
    const reapedEvents: Array<{ id: string; age: number }> = [];
    const reaped = reapStuckPendingWorkers({
      workerProcs: map,
      claimedWorkerIds: new Set(["w-building"]),
      nowMs: now,
      timeoutMs: PENDING_CLAIM_TIMEOUT_MS,
      onReap: (id, age) => reapedEvents.push({ id, age }),
    });
    expect(reaped).toEqual(["w-stuck"]);
    expect(kills).toEqual(["w-stuck"]);
    expect(reapedEvents).toEqual([{ id: "w-stuck", age: PENDING_CLAIM_TIMEOUT_MS + 5_000 }]);
  });

  test("shutdown loop kills every registered proc via the keyed Map", () => {
    const { map, kills } = makeRegistry(now, [{ id: "a", ageMs: 1 }, { id: "b", ageMs: 2 }, { id: "c", ageMs: 3 }]);
    for (const { proc } of map.values()) proc.kill(9);
    expect(kills.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("workerOpenSlots retains pending workers in the cap (no over-spawn)", () => {
  test("pending (spawned-but-unclaimed) workers still reduce open slots", () => {
    // 4 max, 1 active claim, 3 spawned promises => 2 pending => 4 - 1 - 2 = 1 open slot.
    expect(workerOpenSlots({ maxWorkers: 4, activeWorkers: 1, runningWorkers: 3, activeLocalWorkers: 1 })).toBe(1);
  });
});

describe("integrationResolveCommand (auto conflict-resolver child)", () => {
  const globals: GlobalArgs = {
    repoRoot: "/repo",
    stateDir: "/state",
    projectId: "pkmn-colosseum",
    dryRunAgents: false,
    provider: "openai-codex",
    model: "gpt-5.5",
    thinkingLevel: "medium",
  };

  test("forwards the resolver model + item/queue/run flags to integration-resolve", () => {
    const cmd = integrationResolveCommand(globals, {
      runId: "run-1",
      itemPath: "/state/i/item.json",
      queueSummaryPath: "/state/i/queue.json",
      resolverProvider: "zai",
      resolverModel: "glm-5.2",
      resolverThinkingLevel: "low",
    });
    const joined = cmd.join(" ");
    expect(cmd).toContain("integration-resolve");
    expect(joined).toContain("--run-id run-1");
    expect(joined).toContain("--item-file /state/i/item.json");
    expect(joined).toContain("--queue-summary-file /state/i/queue.json");
    expect(joined).toContain("--resolver-provider zai");
    expect(joined).toContain("--resolver-model glm-5.2");
    expect(joined).toContain("--resolver-thinking-level low");
    expect(joined).toContain("--project pkmn-colosseum");
    expect(joined).not.toContain("--dry-run-agents");
  });

  test("respects dryRunAgents by forwarding --dry-run-agents", () => {
    const cmd = integrationResolveCommand(
      { ...globals, dryRunAgents: true },
      { runId: "r", itemPath: "a.json", queueSummaryPath: "b.json", resolverProvider: "zai", resolverModel: "glm-5.2", resolverThinkingLevel: "low" },
    );
    expect(cmd).toContain("--dry-run-agents");
  });
});

describe("runLoopWorkerCommand", () => {
  test("forwards the exact target manifest to each worker child", () => {
    const command = runLoopWorkerCommand(
      {
        repoRoot: "/repo",
        stateDir: "/state",
        projectId: "pkmn-colosseum",
        dryRunAgents: true,
        provider: "openai-codex",
        model: "gpt-5.6",
        thinkingLevel: "xhigh",
      },
      {
        runId: "run-1",
        workerId: "worker-1",
        baseRev: "origin/master",
        ttlSeconds: 3000,
        thinkingLevel: "xhigh",
        postReturnCheckCommand: "",
        workerConfigureCommand: "python3 configure.py --no-progress",
        graphDbPath: "/state/graph.sqlite",
        targetFilter: {
          targetKeys: ["unit/a::fn_a"],
          targetKeysFile: "/manifests/small.tsv",
        },
      },
    );

    expect(command).toContain("worker");
    expect(command).toContain("--dry-run-agents");
    expect(command.slice(command.indexOf("--target-keys-file"), command.indexOf("--target-keys-file") + 2)).toEqual([
      "--target-keys-file",
      "/manifests/small.tsv",
    ]);
  });
});

describe("shouldRefreshSchedulerBoard (board-throttle)", () => {
  test("always runs on the first iteration so the first epoch admits (even if the timer is in the future)", () => {
    expect(shouldRefreshSchedulerBoard({ iterationsCompleted: 0, nowMs: 1_000, nextRefreshMs: 999_999 })).toBe(true);
  });

  test("after the first iteration, is throttled until the refresh interval elapses", () => {
    expect(shouldRefreshSchedulerBoard({ iterationsCompleted: 5, nowMs: 1_000, nextRefreshMs: 16_000 })).toBe(false);
  });

  test("after the first iteration, runs once the refresh interval has elapsed", () => {
    expect(shouldRefreshSchedulerBoard({ iterationsCompleted: 5, nowMs: 16_000, nextRefreshMs: 16_000 })).toBe(true);
  });
});
