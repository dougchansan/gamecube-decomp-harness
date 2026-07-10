import type { AgentToolPromptMetadata } from "../types.js";

/** Prompt metadata for wrappers over project-owned knowledge sources. */
export const knowledgeToolPromptMetadata: Record<string, AgentToolPromptMetadata> = {
  code_graph_file_card: {
    provider: "code_graph",
    type: "target_context",
    useWhen: "Get the file card for a specific source file.",
  },
  code_graph_search: {
    provider: "code_graph",
    type: "local_search",
    useWhen: "Search local source paths, symbols, functions, units, and graph metadata.",
  },
  legacy_lever_search: {
    provider: "legacy_colosseum_kg",
    type: "historical_lever_search",
    useWhen: "Search historical Colosseum crack levers and cracked-by records for a symbol or source path.",
  },
  powerpc_docs_search: {
    provider: "powerpc_docs",
    type: "reference_data",
    useWhen: "Search PowerPC ABI, register, stack-frame, branch, conversion, or condition-register docs.",
  },
  powerpc_instruction_lookup: {
    provider: "powerpc_docs",
    type: "reference_data",
    useWhen: "Look up documentation for one concrete PowerPC instruction mnemonic.",
  },
  path_facts_resolve: {
    provider: "path_facts",
    type: "path_context",
    useWhen: "Resolve accepted path-scoped facts and directory-slice hints for a source path.",
  },
  path_facts_proposals: {
    provider: "path_facts",
    type: "proposal_review",
    useWhen: "Inspect pending path-fact proposals before creating another scoped proposal.",
  },
  decomp_standards_context: {
    provider: "decomp_standards",
    type: "standards_context",
    useWhen: "Inspect compact accepted decomp standards when classifying a PR or curator proposal.",
  },
  decomp_standards_proposals: {
    provider: "decomp_standards",
    type: "proposal_review",
    useWhen: "Inspect pending standards proposals before creating another global rule proposal.",
  },
};
