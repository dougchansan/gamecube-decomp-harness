import { describe, expect, test } from "bun:test";
import {
  PR_SPLITTER_SCHEMA_VERSION,
  prSplitterPrompt,
  validatePrSplitterPlan,
} from "./prompt.js";

function validPlan(): Record<string, unknown> {
  return {
    schema_version: PR_SPLITTER_SCHEMA_VERSION,
    slices: [
      {
        id: "shared-prep",
        display_name: "Shared Prep",
        title: "Melee decomp: shared prep",
        lane: "match",
        scope: "src/melee/shared",
        files: ["src/melee/shared/types.h"],
        depends_on: [],
        independence_kind: "shared-prep",
        review_focus: "Shared declaration needed by later subsystem matches.",
        pr_body_summary: "Adds shared declarations required by the matched subsystem slices.",
        risks: ["Cross-subsystem declaration surface."],
        validation_notes: ["Apply first and run the isolation command."],
      },
    ],
    warnings: [],
    rationale: "Shared prep must precede dependent subsystem slices.",
    confidence: 0.82,
  };
}

describe("validatePrSplitterPlan", () => {
  test("accepts a valid splitter plan", () => {
    const { plan, errors } = validatePrSplitterPlan(validPlan());
    expect(errors).toEqual([]);
    expect(plan?.schema_version).toBe(PR_SPLITTER_SCHEMA_VERSION);
    expect(plan?.slices[0]?.independence_kind).toBe("shared-prep");
  });

  test("rejects malformed splitter plans", () => {
    const { plan, errors } = validatePrSplitterPlan({
      schema_version: "wrong",
      slices: [
        {
          id: "",
          display_name: "",
          title: "",
          lane: "ship",
          scope: "",
          files: [],
          depends_on: "none",
          independence_kind: "maybe",
          review_focus: 42,
          pr_body_summary: null,
          risks: {},
          validation_notes: {},
        },
      ],
      warnings: "none",
      rationale: 1,
      confidence: 9,
    });
    expect(plan).toBeNull();
    expect(errors.join("; ")).toContain("schema_version");
    expect(errors.join("; ")).toContain("slices[0].lane");
    expect(errors.join("; ")).toContain("confidence");
  });
});

describe("prSplitterPrompt", () => {
  test("renders context, tools, standards, and schema without raw placeholders", () => {
    const splitContext = {
      plan_inputs: {
        base_ref: "origin/master",
        max_files_per_pr: 30,
      },
      changed_files: [
        {
          path: "src/melee/gm/gm_1601.c",
          deterministic_lane: "match",
        },
      ],
      seed_slices: [
        {
          id: "gm",
          lane: "match",
          files: ["src/melee/gm/gm_1601.c"],
        },
      ],
    };
    const prompt = prSplitterPrompt({ splitContext, repoRoot: "/repo", stateDir: "/state" });
    const combined = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
    expect(combined).toContain("PR splitter agent");
    expect(combined).toContain("src/melee/gm/gm_1601.c");
    expect(combined).toContain(PR_SPLITTER_SCHEMA_VERSION);
    expect(combined).toContain("<available_tools>");
    expect(combined).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
  });
});
