import { describe, expect, test } from "bun:test";
import {
  INTEGRATION_RESOLVER_SCHEMA_VERSION,
  integrationResolverPrompt,
  validateIntegrationResolverAgentResult,
} from "./prompt.js";

const unresolvedPlaceholderPattern = /\{\{[A-Z0-9_]+\}\}/;

function sampleItem(): Record<string, unknown> {
  return {
    schema_version: "integration_conflict_item_v1",
    id: "integration-conflict-1",
    conflict_group_id: "src-colosseum-ft-demo",
    run_id: "run-1",
    epoch_id: "epoch-1",
    failed_apply: {
      command: "git apply --check worker.patch",
      stderr: "patch failed: src/colosseum/ft/chara/ftDemo.c:24",
    },
    worker_outputs: [
      {
        worker_state_id: "worker-state-1",
        checkpoint_id: "checkpoint-1",
        target: "GC6E01:ftDemo::ftDemo_Target",
        source_paths: ["src/colosseum/ft/chara/ftDemo.c"],
        patch_path: "state/workers/worker-state-1/attempt-1.write_set.diff",
        validation: { exact: true, hard_gates_passed: true },
      },
    ],
    conflict_paths: ["src/colosseum/ft/chara/ftDemo.c"],
    explicit_write_set: ["src/colosseum/ft/chara/ftDemo.c"],
  };
}

describe("validateIntegrationResolverAgentResult", () => {
  test("accepts a valid integration-resolver result", () => {
    const validated = validateIntegrationResolverAgentResult({
      schema_version: INTEGRATION_RESOLVER_SCHEMA_VERSION,
      queue_item_id: "integration-conflict-1",
      conflict_group_id: "src-colosseum-ft-demo",
      outcome: "resolved",
      summary: "Merged the worker hunk into session-current source.",
      applied_worker_outputs: [
        {
          worker_state_id: "worker-state-1",
          checkpoint_id: "checkpoint-1",
          target: "GC6E01:ftDemo::ftDemo_Target",
          source_paths: ["src/colosseum/ft/chara/ftDemo.c"],
          disposition: "applied",
          evidence: "Exact checkpoint hunk retained after manual merge.",
        },
      ],
      conflict_resolutions: [
        {
          path: "src/colosseum/ft/chara/ftDemo.c",
          symbols: ["ftDemo_Target"],
          resolution: "manual_merge",
          evidence: "Removed conflict markers and validated the target.",
        },
      ],
      edits: ["Merged the selected worker hunk."],
      validation: [{ command: "checkdiff_summary --functions ftDemo_Target", status: "passed", artifact_path: null, notes: "exact" }],
      remaining_conflicts: [],
      carry_forward_notes: [],
      risks: [],
    });

    expect(validated.errors).toEqual([]);
    expect(validated.result?.outcome).toBe("resolved");
  });

  test("rejects malformed result objects", () => {
    const validated = validateIntegrationResolverAgentResult({
      schema_version: "wrong",
      queue_item_id: "",
      outcome: "clean",
      summary: "",
      applied_worker_outputs: "none",
      conflict_resolutions: {},
      edits: {},
      validation: [{ command: "x", status: "maybe" }],
      remaining_conflicts: {},
      carry_forward_notes: {},
      risks: {},
    });

    expect(validated.result).toBeNull();
    expect(validated.errors.join("; ")).toContain("schema_version");
    expect(validated.errors.join("; ")).toContain("outcome");
    expect(validated.errors.join("; ")).toContain("queue_item_id");
  });
});

describe("integrationResolverPrompt", () => {
  test("renders conflict item, tools, standards, and schema without raw placeholders", () => {
    const bundle = integrationResolverPrompt({
      integrationItem: sampleItem(),
      queueSummary: { queued_items: 1, conflict_groups: 1 },
      repoRoot: "/repo",
      stateDir: "/state",
    });
    const combined = `${bundle.systemPrompt}\n${bundle.userPrompt}`;
    const injectedContext = bundle.kernelContext?.renderedContext ?? "";

    expect(combined).toContain("running-phase worker-output integration conflict");
    expect(combined).not.toContain("integration-conflict-1");
    expect(injectedContext).toContain("integration-conflict-1");
    expect(injectedContext).toContain("src/colosseum/ft/chara/ftDemo.c");
    expect(injectedContext).toContain("<available_tools>");
    expect(injectedContext).toContain("<decomp_standards>");
    expect(injectedContext).toContain(INTEGRATION_RESOLVER_SCHEMA_VERSION);
    expect(combined).not.toMatch(unresolvedPlaceholderPattern);
    expect(injectedContext).not.toMatch(unresolvedPlaceholderPattern);
    expect(bundle.kernelContext?.inputs.map((input) => input.loaderKind)).toEqual([
      "integration-conflict-item",
      "integration-queue-summary",
    ]);
  });
});
