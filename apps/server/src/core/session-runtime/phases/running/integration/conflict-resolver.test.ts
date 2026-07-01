import { describe, expect, test } from "bun:test";
import { conflictItemArtifactPaths, selectConflictItemsToLaunch } from "./conflict-resolver.js";

describe("selectConflictItemsToLaunch", () => {
  test("fires once per queued conflict, up to the concurrency cap", () => {
    expect(selectConflictItemsToLaunch({ pendingItemIds: ["a", "b", "c"], runningItemIds: new Set(), cap: 2 })).toEqual(["a", "b"]);
  });

  test("skips an item whose resolver is already running (no double-launch)", () => {
    expect(selectConflictItemsToLaunch({ pendingItemIds: ["a", "b"], runningItemIds: new Set(["a"]), cap: 2 })).toEqual(["b"]);
  });

  test("launches nothing once running resolvers saturate the cap", () => {
    expect(selectConflictItemsToLaunch({ pendingItemIds: ["a", "b"], runningItemIds: new Set(["a"]), cap: 1 })).toEqual([]);
  });

  test("never launches resolved items (they are absent from the conflict-only pending list)", () => {
    // pendingConflictIntegrationIds returns only status='conflict' rows, so a resolved/
    // resolver_failed item never reaches this selector.
    expect(selectConflictItemsToLaunch({ pendingItemIds: ["only-conflict"], runningItemIds: new Set(), cap: 5 })).toEqual(["only-conflict"]);
  });

  test("skips items that exhausted their in-lifetime retry budget", () => {
    expect(
      selectConflictItemsToLaunch({ pendingItemIds: ["a", "b"], runningItemIds: new Set(), cap: 5, exhaustedItemIds: new Set(["a"]) }),
    ).toEqual(["b"]);
  });
});

describe("conflictItemArtifactPaths", () => {
  test("reconstructs the deterministic conflict item + queue-summary paths", () => {
    const paths = conflictItemArtifactPaths("/state", "run-1", "item-9");
    expect(paths.itemPath).toBe("/state/runs/run-1/worker_integrations/item-9/integration_conflict_item.json");
    expect(paths.queueSummaryPath).toBe("/state/runs/run-1/worker_integrations/item-9/integration_queue_summary.json");
  });
});
