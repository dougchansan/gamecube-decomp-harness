import { describe, expect, test } from "bun:test";
import { evaluateFastKnowledgeMaintenanceDecision, PENDING_CLAIM_TIMEOUT_MS, reapStuckPendingWorkers, shouldRefreshSchedulerBoard, workerOpenSlots } from "./run-loop.js";

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
