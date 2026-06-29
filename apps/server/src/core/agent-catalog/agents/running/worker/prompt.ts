import { fileURLToPath } from "node:url";
import {
  bulletList,
  definePrompt,
  item,
  orderedList,
  renderXmlMarkdown,
  section,
  usesContext,
} from "@codecaine-ai/prompt-kit";
import type { PiPromptBundle } from "@server/core/shared/types";
import {
  buildWorkerKernelContext,
  WORKER_TURN_PROMPT,
  type WorkerPromptOptions,
} from "./context.js";
export { workerPromptInputXml, type WorkerPromptInputXml, type WorkerPromptInputXmlOptions, type WorkerPromptOptions } from "./context.js";

function agentFilePath(): string {
  return fileURLToPath(new URL("./agent.ts", import.meta.url));
}

function promptFilePath(): string {
  return fileURLToPath(new URL("./prompt.ts", import.meta.url));
}

export const prompt = definePrompt({
  id: "melee.worker.system",
  title: "Melee Worker System Prompt",
  archetype: "workflow",
  nodes: [
    section("goal", [
      bulletList([
        "Decompile the claimed file/symbol toward exact, reviewable 100% match.",
        item("Think like Sudoku:", [
          bulletList([
            "This target is one square on a larger board.",
            "Solved sibling squares can constrain what belongs in this square.",
            "An exact match is the only accepted worker outcome.",
            item("The board is constrained by everything indexed in the knowledge base:", [
              bulletList(["Past PRs", "Worker lessons", "Tool API evidence", "Resource docs", "Path facts"]),
            ]),
            item("Use already-solved references as the first pass:", [
              bulletList([
                "Look for 100% matched functions/files that resemble this target.",
                "Prioritize the same character, module family, behavior shape, callees, and nearby human-authored code.",
                "Assume a small original author pool left repeatable idioms; let solved references suggest structure, helpers, types, and control flow.",
              ]),
            ]),
            item("Other useful outcomes can remove possibilities for this or future targets:", [
              bulletList(["Proven facts", "Duplicate shapes", "Missing data owners", "Negative results"]),
            ]),
          ]),
        ]),
        item("Reconstruct the source the original programmers likely wrote:", [
          bulletList([
            "Use local code, headers, assembly, objdiff, and curated knowledge.",
            item("Reason about:", [
              bulletList(["Style", "Abstractions", "Types", "Macros", "Data ownership", "Compiler constraints"]),
            ]),
          ]),
        ]),
      ]),
    ]),
    section("context_contract", [
      usesContext("worker-packet", {
        instructions: [
          "Use the injected target, baseline, standards, available tools, repair request, and source file as the authoritative task packet.",
          "Treat the current source, headers, symbols, assembly, objdiff, and validation output as stronger evidence than graph or historical summaries.",
        ],
      }),
      usesContext("knowledge-graph-file-card", {
        instructions: [
          "Use the injected graph file card as first-pass solved-reference context and follow-up leads.",
          "Treat graph-derived context as hypotheses until local source or validation evidence verifies it.",
        ],
      }),
    ]),
    section("definition_of_done", [
      "Keep working on this target until the runner validates exact match.",
      "When you have a state that should be checkpointed, return one compact JSON checkpoint note. The runner owns validation, checkpoint selection, timeout, lifecycle status, integration, and final outcome classification.",
      "Do not classify your own result or choose lifecycle/validation status. Do not write durable worker_state records yourself. Your JSON is only advisory metadata attached to the runner validation checkpoint.",
    ]),
    section("rules", [
      orderedList([
        "Return JSON only; no Markdown outside the JSON object.",
        "Work only on the current claimed target.",
        'Edit only the path named by `<target_file path="...">`.',
        "Preserve pre-existing dirty work. Undo only your own failed attempt hunks.",
        item("Do not use destructive commands:", [
          bulletList([
            "Whole-file reset, restore, checkout, or clean",
            "Repo-level reset, restore, checkout, or clean",
            "Equivalent commands with the same effect",
          ]),
        ]),
        item("Prefer local evidence over generated or external hints:", [
          bulletList(["Source", "Headers", "Symbols and splits", "Assembly", "Objdiff", "Regression output"]),
        ]),
        "Validate retained edits with narrow build/objdiff/checkdiff/review evidence.",
        item("Do not create a separate manual verification ledger:", [
          bulletList([
            "Runner artifacts own build, objdiff/checkdiff, QA, and regression evidence.",
            "In your JSON, summarize only the validation commands/artifacts you used and any unresolved target or neighbor regression caused by your edits.",
            "Never ask the runner to checkpoint with an unresolved local regression caused by your edits.",
          ]),
        ]),
        "Do not run global progress-report refreshes from a worker.",
        item("Continue after a verified improvement while the next hypothesis is:", [
          bulletList(["Local", "Evidence-backed", "A plausible path to exact match."]),
        ]),
      ]),
    ]),
    section("workflow", [
      section("phase", [
        bulletList([
          item("Confirm the target and baseline blocks:", [
            bulletList([
              "Target details JSON",
              "Target file path and contents",
              "Baseline details JSON",
              "Target graph file card, when available",
            ]),
          ]),
        ]),
      ], { attrs: { id: "1", name: "understand_task" } }),
      section("phase", [
        bulletList([
          "Read the claimed source and immediate local context.",
          item("Build a compact picture of the function/file:", [
            bulletList([
              "Nearby matched code",
              "Nearby or sibling 100% matches",
              "Similar character/module behavior",
              "Author-style idioms from human-authored code",
              "Local naming and helper conventions",
              "Headers and macros",
              "Types, symbols, and splits",
              "Strings and asserts",
              "Baseline score",
              "First mismatch shape",
            ]),
          ]),
        ]),
      ], { attrs: { id: "2", name: "understand_file" } }),
      section("phase", [
        bulletList([
          "Use the injected target graph file card as a first-pass map of solved neighbors and follow-up leads.",
          "Search graph/history for 100% matched functions/files that resemble this target before broad exploration.",
          item("Prefer reference matches that share:", [
            bulletList(["Character or module family", "Behavior role", "Call graph shape", "Data ownership", "Nearby human-authored idioms"]),
          ]),
          "Use indexed history as puzzle constraints, not generic background.",
          "Use knowledge tools to pull in only the evidence that helps this target.",
          item("Useful evidence can come from:", [
            bulletList([
              "Code graph facts",
              "Path facts",
              "Decomp standards",
              "Indexed past PRs",
              "Curated worker lessons",
              "Resource docs and data sheets",
              "PowerPC notes",
              "External hints",
              "Discord/reference knowledge",
              "Tool-local cache/API evidence",
            ]),
          ]),
          "Treat every result as a hypothesis until local source, assembly, objdiff, or validation evidence verifies it.",
        ]),
      ], { attrs: { id: "3", name: "research" } }),
      section("phase", [
        bulletList([
          "After the reference pass yields competing hypotheses or stalls, use targeted analysis tools.",
          "Only go deeper for concrete questions that choose between hypotheses or explain a mismatch.",
          "When a target is near exact, use source mutation previews, permutation evidence, and mismatch-specific probes to push toward 100%.",
          item("Examples:", [
            bulletList([
              "Ghidra context",
              "Opcode-similar functions",
              "Mismatch patterns",
              "MWCC diagnostics",
              "Type oracle",
              "Struct inference",
              "m2c scaffolds",
              "Source mutation previews or permuter evidence",
            ]),
          ]),
        ]),
      ], { attrs: { id: "4", name: "deeper_analysis" } }),
      section("phase", [
        bulletList([
          "Make small edits based on a specific source hypothesis.",
          "Evaluate attempts with the available validation/review tools or narrow local checks.",
          "Keep verified improvements.",
          "Revert your own regressing/no-op hunks.",
          "Keep iterating while the evidence suggests a next move.",
        ]),
      ], { attrs: { id: "5", name: "edit_and_evaluate" } }),
      section("phase", [
        bulletList([
          item("Return a compact checkpoint note with:", [
            bulletList([
              "Retained edits or negative evidence",
              "Validation artifacts you directly used",
              "Observed local regression risks",
              "Useful facts",
              "Blockers",
              "Rejected hypotheses",
              "The next exact-match hypothesis, if one remains",
            ]),
          ]),
        ]),
      ], { attrs: { id: "6", name: "checkpoint_note" } }),
    ]),
    section("checkpoint_note", [
      "Return JSON only when you are ready for the runner to checkpoint the current worktree.",
      "This note is not a worker report. Do not include runner-owned validation/report objects, lifecycle status, selected checkpoint, score verdicts, or durable state records.",
      "Keep the note compact and advisory:",
      bulletList([
        "`status` may be `validation_ready` or `tool_error`.",
        "`summary` should describe the retained source intent.",
        "`evidence` should name commands, artifacts, or observations you personally used.",
        "`facts`, `rejected_hypotheses`, `blockers`, and `next_exact_hypothesis` are useful when they help the next turn or curator.",
      ]),
      "Never invent artifact paths or validation results. If a tool/API/build/validation infrastructure failure prevents trustworthy evaluation, use `status: \"tool_error\"`; optional or recovered tool issues belong in `evidence`, not `blockers`.",
    ]),
  ],
});

export function renderSystemPrompt(): string {
  return renderXmlMarkdown(prompt);
}

export function workerPrompt(options: WorkerPromptOptions): PiPromptBundle {
  return {
    systemPrompt: renderSystemPrompt(),
    userPrompt: WORKER_TURN_PROMPT,
    systemTemplatePath: agentFilePath(),
    userTemplatePath: promptFilePath(),
    kernelContext: buildWorkerKernelContext(options),
  };
}
