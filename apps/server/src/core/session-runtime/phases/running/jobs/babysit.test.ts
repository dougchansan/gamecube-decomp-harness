import { describe, expect, test } from "bun:test";
import { babysitSystemArgs, classifyChild } from "./babysit.js";

describe("babysitSystemArgs", () => {
  test("forwards and absolutizes target key manifests for the run-loop child", () => {
    const args = new Map<string, string | true>([
      ["--target-keys-file", "manifests/small.tsv"],
      ["--exclude-sources", "src/game/fight_range_80211A00.c"],
      ["--force-recover-claims", true],
    ]);

    expect(babysitSystemArgs(args, "/operator")).toEqual([
      "--target-keys-file",
      "/operator/manifests/small.tsv",
      "--exclude-sources",
      "src/game/fight_range_80211A00.c",
    ]);
  });
});

describe("classifyChild", () => {
  test("keeps a requested drain clean despite historical worker errors", () => {
    expect(
      classifyChild(0, {
        stoppedReason: "drained",
        workerErrors: [{ workerId: "worker-1", error: "earlier ladder rung failed" }],
        finalStatus: { activeWorkers: 0 },
      }),
    ).toEqual({
      classification: "clean",
      reason: "drained",
      workerErrors: [{ workerId: "worker-1", error: "earlier ladder rung failed" }],
    });
  });

  test("still rejects a drain that leaves an active worker", () => {
    expect(
      classifyChild(0, {
        stoppedReason: "drained",
        workerErrors: [{ workerId: "worker-1", error: "worker failed" }],
        finalStatus: { activeWorkers: 1 },
      }),
    ).toMatchObject({
      classification: "incident",
      reason: "active_workers_after_child_exit",
    });
  });

  test("still treats a worker-error stop as an incident", () => {
    expect(
      classifyChild(0, {
        stoppedReason: "worker_error",
        workerErrors: [{ workerId: "worker-1", error: "worker failed" }],
        finalStatus: { activeWorkers: 0 },
      }),
    ).toMatchObject({ classification: "incident", reason: "worker_error" });
  });
});
