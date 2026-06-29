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
  past_prs_search: {
    provider: "past_prs",
    type: "history",
    useWhen: "Find prior accepted or rejected PR evidence for a file, subsystem, tactic, or review risk.",
  },
  discord_knowledge_search: {
    provider: "discord_knowledge",
    type: "community_knowledge",
    useWhen: "Search community/compiler notes for concrete decomp or review terms.",
  },
  discord_knowledge_topics_for_terms: {
    provider: "discord_knowledge",
    type: "community_knowledge",
    useWhen: "Expand several loose compiler, review, or workflow terms into topic-style hits.",
  },
  ssbm_data_sheet_search: {
    provider: "ssbm_data_sheet",
    type: "reference_data",
    useWhen: "Search data-sheet rows for addresses, offsets, IDs, action states, hitboxes, attributes, or resources.",
  },
  ssbm_data_sheet_lookup_address: {
    provider: "ssbm_data_sheet",
    type: "reference_data",
    useWhen: "Look up one concrete address in normalized SSBM data-sheet rows.",
  },
  ssbm_data_sheet_lookup_offset: {
    provider: "ssbm_data_sheet",
    type: "reference_data",
    useWhen: "Look up one concrete typed or untyped offset in normalized SSBM data-sheet rows.",
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
  external_mirrors_search: {
    provider: "external_mirrors",
    type: "external_reference",
    useWhen: "Search supplemental external mirrors for names, symbols, headers, or reference hints.",
  },
  external_symbol_lookup: {
    provider: "external_mirrors",
    type: "external_reference",
    useWhen: "Look up one specific external symbol or name, then verify locally.",
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
