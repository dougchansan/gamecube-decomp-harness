import { describe, expect, test } from "bun:test";
import { workerPrompt } from "./prompt.js";

describe("workerPrompt", () => {
  test("injects active standards without standard examples", () => {
    const bundle = workerPrompt({
      packet: {
        target: {
          unit: "GALE01:test",
          symbol: "test_symbol",
          source_path: "src/melee/test/missing.c",
        },
        baseline: {
          fuzzy_match_percent: 91.25,
        },
      },
      repoRoot: "/repo",
      stateDir: "/state",
      initialBoardPath: "/state/board.json",
      workerLogDir: "/state/workers",
    });
    const combined = `${bundle.systemPrompt}\n${bundle.userPrompt}`;

    expect(combined).toContain("<decomp_standards>");
    expect(combined).not.toContain("<standard_examples");
    expect(combined).not.toContain("<bad_pattern>");
    expect(combined).not.toContain("<preferred_shape>");
    expect(combined).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
  });
});
