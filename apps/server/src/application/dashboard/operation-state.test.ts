import { describe, expect, test } from "bun:test";

import { createOperationStateService } from "./operation-state.js";

describe("operation state service", () => {
  test("begins an operation with pending steps and timestamps", () => {
    const state = createOperationStateService();

    state.beginOperation("prepare", "Prepare Handoff", ["stop worker scheduling", "verify ship set"]);

    const operation = state.getOperation();
    expect(operation?.name).toBe("prepare");
    expect(operation?.label).toBe("Prepare Handoff");
    expect(operation?.status).toBe("running");
    expect(Date.parse(operation?.startedAt ?? "")).not.toBeNaN();
    expect(operation?.steps).toEqual([
      { name: "stop worker scheduling", status: "pending" },
      { name: "verify ship set", status: "pending" },
    ]);
  });

  test("tracks the active step by rolling running steps to done", () => {
    const state = createOperationStateService();
    state.beginOperation("prepare", "Prepare Handoff", ["first", "second"]);

    state.operationStep("first", "starting");
    state.operationStep("second");

    const operation = state.getOperation();
    expect(operation?.steps[0]?.status).toBe("done");
    expect(operation?.steps[0]?.detail).toBe("starting");
    expect(Date.parse(operation?.steps[0]?.startedAt ?? "")).not.toBeNaN();
    expect(Date.parse(operation?.steps[0]?.endedAt ?? "")).not.toBeNaN();
    expect(operation?.steps[1]?.status).toBe("running");
    expect(Date.parse(operation?.steps[1]?.startedAt ?? "")).not.toBeNaN();
  });

  test("adds late-discovered steps without changing the record shape", () => {
    const state = createOperationStateService();
    state.beginOperation("qa", "QA Gate", ["build"]);

    state.operationStep("lint", "upstream check-issues lint");

    expect(state.getOperation()?.steps).toMatchObject([
      { name: "build", status: "pending" },
      { name: "lint", status: "running", detail: "upstream check-issues lint" },
    ]);
  });

  test("updates details and next hints while a record exists", () => {
    const state = createOperationStateService();
    state.beginOperation("open-pr", "Open PR", ["verify"]);

    state.operationStepDetail("verify", "0 regressions");
    state.operationNextHint("Open the shared slice first.");

    expect(state.getOperation()?.steps[0]?.detail).toBe("0 regressions");
    expect(state.getOperation()?.next).toBe("Open the shared slice first.");
  });

  test("attributes failures to an explicit step", () => {
    const state = createOperationStateService();
    state.beginOperation("open-pr", "Open PR", ["prepare", "verify"]);

    state.operationStep("prepare");
    state.failOperationStep("verify");

    const operation = state.getOperation();
    expect(operation?.steps[0]?.status).toBe("done");
    expect(operation?.steps[1]?.status).toBe("failed");
    expect(Date.parse(operation?.steps[1]?.endedAt ?? "")).not.toBeNaN();
  });

  test("ends successful operations by completing running steps and skipping pending steps", () => {
    const state = createOperationStateService();
    state.beginOperation("prepare", "Prepare Handoff", ["verify", "sync"]);
    state.operationStep("verify");

    state.endOperation();

    const operation = state.getOperation();
    expect(operation?.status).toBe("done");
    expect(Date.parse(operation?.endedAt ?? "")).not.toBeNaN();
    expect(operation?.steps.map((step) => step.status)).toEqual(["done", "skipped"]);
  });

  test("ends failed operations with the original error message", () => {
    const state = createOperationStateService();
    state.beginOperation("qa", "QA Gate", ["build", "report"]);
    state.operationStep("build");

    state.endOperation(new Error("ninja failed"));

    const operation = state.getOperation();
    expect(operation?.status).toBe("failed");
    expect(operation?.error).toBe("ninja failed");
    expect(operation?.steps.map((step) => step.status)).toEqual(["failed", "skipped"]);
  });

  test("only the outer withOperation owns a running operation", async () => {
    const state = createOperationStateService();

    const result = await state.withOperation("outer", "Outer", ["outer step"], async () => {
      state.operationStep("outer step");
      return state.withOperation("inner", "Inner", ["inner step"], async () => "ok");
    });

    expect(result).toBe("ok");
    const operation = state.getOperation();
    expect(operation?.name).toBe("outer");
    expect(operation?.status).toBe("done");
    expect(operation?.steps).toHaveLength(1);
    expect(operation?.steps[0]?.status).toBe("done");
  });

  test("withOperation records errors from owned operations and rethrows", async () => {
    const state = createOperationStateService();

    await expect(
      state.withOperation("qa", "QA Gate", ["build"], async () => {
        state.operationStep("build");
        throw new Error("qa failed");
      }),
    ).rejects.toThrow("qa failed");

    expect(state.getOperation()).toMatchObject({
      name: "qa",
      status: "failed",
      error: "qa failed",
      steps: [{ name: "build", status: "failed" }],
    });
  });

  test("returns a cloned snapshot for dashboard read models", () => {
    const state = createOperationStateService();
    state.beginOperation("sync", "Sync Merged PRs", ["pull"]);

    const snapshot = state.getOperationSnapshot();
    snapshot!.steps[0]!.status = "failed";

    expect(state.getOperation()?.steps[0]?.status).toBe("pending");
  });
});
