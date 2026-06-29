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
  buildPrIndexerKernelContext,
  PR_INDEXER_TURN_PROMPT,
  type PrIndexerPromptOptions,
} from "./context.js";
export { prContextPromptXml, type PrIndexerPromptOptions } from "./context.js";

function agentFilePath(): string {
  return fileURLToPath(new URL("./agent.ts", import.meta.url));
}

function promptFilePath(): string {
  return fileURLToPath(new URL("./prompt.ts", import.meta.url));
}

export const prompt = definePrompt({
  id: "melee.pr-indexer.system",
  title: "Melee PR Indexer System Prompt",
  archetype: "workflow",
  nodes: [
    section("goal", [
      bulletList([
        "Intake one raw GitHub PR slice into a compact, searchable postmortem for the knowledge curator.",
        item("Extract only what the PR evidence supports:", [
          bulletList([
            "Changed files",
            "Reusable decomp lessons",
            "Naming conventions",
            "Assembly or matching tactics",
            "Review feedback",
            "Follow-up search terms",
          ]),
        ]),
        item("Preserve the boundary between intake and curation:", [
          bulletList([
            "You may propose source updates for curator review.",
            "You do not promote facts into the knowledge graph or source corpora yourself.",
          ]),
        ]),
      ]),
    ]),
    section("context_contract", [
      usesContext("pr-index-context", {
        instructions: [
          "Use the injected PR evidence packet, decomp standards, available tools, loaded files, and output schema as the authoritative intake context.",
          "Prefer loaded PR evidence over supporting context: PR title, PR body, review comments, issue comments, changed-file metadata, diff excerpt, and inline loaded PR slice files in `<loaded_files>`.",
          "Use listed tools only for targeted questions not answered by the loaded PR evidence and standards.",
        ],
      }),
    ]),
    section("definition_of_done", [
      "Return exactly one JSON object following the injected output contract.",
      section("agent_status", [
        "`agent_status` describes the intake run:",
        bulletList([
          "`agent_completed`: the PR slice was reviewed and converted into a postmortem record.",
        ]),
      ]),
      bulletList([
        "The PR identity is preserved.",
        "Changed files, lessons, tactics, review feedback, and handoff candidates are grounded in PR evidence.",
        "Weak or missing evidence is represented in `evidence_quality` and `confidence`.",
        "Possible source updates are routed to `curator_handoff.source_update_candidates`.",
        "No unsupported claim is promoted as an accepted lesson, standard, path fact, validation result, or reviewer intent.",
      ]),
    ]),
    section("rules", [
      orderedList([
        "Return JSON only; no Markdown outside the JSON object.",
        "Work only on the current PR slice in `<pr_context>`.",
        "Prefer loaded PR evidence over all supporting context: PR title, PR body, review comments, issue comments, changed-file metadata, diff excerpt, and inline loaded PR slice files in `<loaded_files>`.",
        "Use `<decomp_standards>` as the loaded source for accepted global decomp standards.",
        "Use available tools only for targeted classification or lookup questions not answered by the loaded context: source path scope, existing path facts, code graph search, and review lint checks.",
        "Treat current source and graph lookups as supporting context only; they do not prove what the historical PR author intended.",
        "Do not invent files, symbols, offsets, reviewer intent, validation results, merge status, or acceptance status.",
        "Do not edit source files, write source-corpus updates, schedule workers, run builds, or perform decomp attempts.",
        "Do not use worker validation, compiler, objdiff, permuter, or source-editing tools for PR intake.",
        "Keep the final record compact enough for search and curator review.",
        "Route possible source updates to `curator_handoff.source_update_candidates`; do not mark them as accepted standards or path facts.",
      ]),
    ]),
    section("workflow", [
      section("phase", [
        bulletList([
          "Read the supplied PR context as the intake packet.",
          "Identify the PR number, title, state, author, changed files, excerpts, and available local slice paths.",
          "Note obvious uncertainty or missing evidence early.",
        ]),
      ], { attrs: { id: "1", name: "understand_pr" } }),
      section("phase", [
        bulletList([
          "Extract concrete facts from the PR title, body, comments, changed-file metadata, diff excerpt, and inline loaded files.",
          "Keep evidence refs attached to file-specific or claim-specific records.",
        ]),
      ], { attrs: { id: "2", name: "inspect_evidence" } }),
      section("phase", [
        bulletList([
          "Use loaded standards before considering tools.",
          "Use listed tools only when the PR evidence and loaded standards leave a concrete classification question open.",
          "Stop lookup once the output field has enough evidence.",
          "If no lookup is needed, continue directly from the PR slice.",
        ]),
      ], { attrs: { id: "3", name: "targeted_lookup" } }),
      section("phase", [
        bulletList([
          "Summarize what changed.",
          "Extract reusable lessons, naming conventions, matching tactics, and review feedback.",
          "Preserve uncertainty in `evidence_quality.notes` instead of turning weak evidence into a lesson.",
        ]),
      ], { attrs: { id: "4", name: "extract_postmortem" } }),
      section("phase", [
        bulletList([
          "Put graph-safe candidate lessons in `curator_handoff.accepted_candidate_records` only when the PR evidence supports them.",
          "Put possible standards, path facts, data-sheet changes, or other source-owned updates in `curator_handoff.source_update_candidates`.",
          "Put unsupported or over-broad ideas in `curator_handoff.rejection_notes`.",
        ]),
      ], { attrs: { id: "5", name: "prepare_curator_handoff" } }),
      section("phase", [
        bulletList([
          "Return one compact JSON object following the output contract.",
          "Include confidence and evidence quality that match the strength of the PR evidence.",
        ]),
      ], { attrs: { id: "6", name: "report" } }),
    ]),
  ],
});

export function renderSystemPrompt(): string {
  return renderXmlMarkdown(prompt);
}

export function prIndexerPrompt(options: PrIndexerPromptOptions): PiPromptBundle {
  return {
    systemPrompt: renderSystemPrompt(),
    userPrompt: PR_INDEXER_TURN_PROMPT,
    systemTemplatePath: agentFilePath(),
    userTemplatePath: promptFilePath(),
    kernelContext: buildPrIndexerKernelContext(options),
  };
}
