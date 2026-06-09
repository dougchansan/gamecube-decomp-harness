/**
 * Agent tool profiles and override resolution.
 *
 * Defaults live here, while project or run configuration can pass enable,
 * disable, or replace overrides through the runtime without changing prompt
 * templates. This keeps agent/tool composition explicit and testable.
 */
import type { RuntimeAgentRole } from "@decomp-orchestrator/core/types";
import { agentToolSummary, createAgentTools } from "./registry.js";
import type { AgentToolProfileInput, AgentToolRuntimeContext, PiToolDefinition } from "./types.js";

/** Default worker Pi tools: one compact context tool plus source/tool-specific knowledge affordances. */
export const defaultWorkerToolProfile = [
  "worker_context_get",
  "code_graph_file_card",
  "code_graph_search",
  "past_prs_search",
  "discord_knowledge_search",
  "discord_knowledge_topics_for_terms",
  "ssbm_data_sheet_search",
  "ssbm_data_sheet_lookup_address",
  "ssbm_data_sheet_lookup_offset",
  "powerpc_docs_search",
  "powerpc_instruction_lookup",
  "external_mirrors_search",
  "external_symbol_lookup",
  "resource_guides_search",
  "reference_docs_search",
  "tool_outputs_search",
  "tool_outputs_similar_functions",
  "tool_outputs_mismatch_patterns",
  "tool_outputs_tool_lookup",
  "decomp_standards_search",
  "decomp_standards_context",
  "path_facts_resolve",
  "path_facts_search",
  "ghidra_lookup",
  "opseq_similar_functions",
  "mismatch_db_search",
  "mwcc_debug_lookup",
  "checkdiff_run",
  "checkdiff_summary",
  "direct_compile_tu",
  "objdiff_score_candidate",
  "mwcc_debug_dump_function",
  "mwcc_debug_diagnose_stack",
  "mwcc_debug_diagnose_regflow",
  "mwcc_debug_diagnose_inlines",
  "mwcc_debug_raw_dump",
  "source_permuter_run",
  "source_permuter_replay",
  "source_mutation_preview",
  "type_oracle_lookup",
  "struct_infer_from_asm",
  "m2c_decompile",
  "include_fixer_preview",
  "item_state_table_preview",
  "review_lint_scan",
] as const;

export const defaultAgentToolProfiles: Record<RuntimeAgentRole, string[]> = {
  director: [],
  worker: [...defaultWorkerToolProfile],
  "pr-review": [],
  "knowledge-curator": [],
};

/** Resolve built-in defaults plus optional replace/enable/disable overrides. */
export function resolveAgentToolIds(role: RuntimeAgentRole, profile?: AgentToolProfileInput): string[] {
  const base = profile?.replace ? [...profile.replace] : [...(defaultAgentToolProfiles[role] ?? [])];
  const enabled = [...base, ...(profile?.enable ?? [])];
  const disabled = new Set(profile?.disable ?? []);
  return [...new Set(enabled)].filter((toolId) => !disabled.has(toolId));
}

/** Build concrete Pi custom tools for the role and runtime context. */
export function buildAgentTools(context: AgentToolRuntimeContext, profile?: AgentToolProfileInput): PiToolDefinition[] {
  return createAgentTools(resolveAgentToolIds(context.role, profile), context);
}

/** Return a compact, prompt-safe summary of tools available to an agent role. */
export function agentToolProfileSummary(role: RuntimeAgentRole, profile?: AgentToolProfileInput): Record<string, unknown>[] {
  return agentToolSummary(resolveAgentToolIds(role, profile), role);
}
