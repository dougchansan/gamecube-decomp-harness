import { describe, expect, test } from "bun:test";
import { workerPrompt } from "./prompt.js";

function sampleWorkerPrompt() {
  return workerPrompt({
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
}

describe("workerPrompt", () => {
  test("keeps dynamic packet in kernel context instead of system or turn prompt", () => {
    const bundle = sampleWorkerPrompt();

    expect(bundle.systemPrompt).toContain('<context_usage context_id="worker-packet">');
    expect(bundle.systemPrompt).toContain('<context_usage context_id="knowledge-graph-file-card">');
    expect(bundle.systemPrompt).not.toContain("<decomp_standards>");
    expect(bundle.systemPrompt).not.toContain("<target_file");
    const turnPrompt = bundle.kernelContext?.turnPrompt ?? "";
    expect(turnPrompt).not.toBe("");
    if (!turnPrompt) throw new Error("worker prompt should define a short turn prompt");
    expect(bundle.userPrompt).toBe(turnPrompt);
    expect(bundle.userPrompt).not.toContain("<decomp_standards>");
    expect(bundle.userPrompt).not.toContain("<target_file");
    const renderedContext = bundle.kernelContext?.renderedContext ?? "";

    expect(bundle.kernelContext?.inputs.map((input) => input.loaderKind)).toEqual([
      "worker-packet",
      "knowledge-graph-file-card",
    ]);
	    expect(renderedContext).toContain("<decomp_standards>");
	    expect(renderedContext).toContain("<target_file");
	    expect(renderedContext).toContain("<canonical_tool_paths>");
	    expect(renderedContext).toContain('relative_path="build/binutils/powerpc-eabi-objdump"');
	    expect(renderedContext).toContain("Broad find roots");
	    expect(renderedContext).toContain("<target_graph_file_card");
    expect(renderedContext).not.toContain("<standard_examples");
    expect(renderedContext).not.toContain("<bad_pattern>");
    expect(renderedContext).not.toContain("<preferred_shape>");
    expect(`${bundle.systemPrompt}\n${bundle.userPrompt}\n${renderedContext}`).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
  });

  test("describes solved-reference research before deeper analysis", () => {
    const systemPrompt = sampleWorkerPrompt().systemPrompt;
    const referencePass = systemPrompt.indexOf("Search graph/history for 100% matched functions/files");
    const deeperPass = systemPrompt.indexOf("After the reference pass yields competing hypotheses or stalls");

    expect(systemPrompt).toContain("Use already-solved references as the first pass:");
    expect(systemPrompt).toContain("Solved sibling squares can constrain what belongs in this square.");
    expect(systemPrompt).toContain("Assume a small original author pool left repeatable idioms");
	    expect(systemPrompt).toContain(
	      "`source_permuter_run` is expensive and opportunistic. Use it only as a last resort",
	    );
	    expect(systemPrompt).toContain("Use the injected `canonical_tool_paths` block");
	    expect(systemPrompt).toContain("Do not run broad filesystem `find` sweeps");
	    expect(systemPrompt).toContain("Do not rerun it for the same function unless source/header/context/asm inputs or m2c args changed");
	    expect(systemPrompt).toContain(
	      "If `source_permuter_run` returns `queue_busy`, do not retry or wait on it",
    );
    expect(systemPrompt).toContain(
      "When a target is near exact, use mismatch-specific probes and source mutation previews first",
    );
    expect(referencePass).toBeGreaterThanOrEqual(0);
    expect(deeperPass).toBeGreaterThan(referencePass);
  });
});
