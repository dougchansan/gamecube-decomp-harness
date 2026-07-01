/**
 * Role-level tool bundles.
 *
 * The wrapper metadata lives beside each wrapper family; this file only decides
 * which stable tool ids each agent role receives by default.
 */

/**
 * Default worker Pi tools attached to worker launches.
 *
 * Colosseum default profiles only advertise sources active in the project
 * registry plus reusable GameCube decomp toolpack APIs.
 */
export const defaultWorkerToolProfile = [
  "code_graph_file_card",
  "code_graph_search",
  "legacy_lever_search",
  "path_facts_resolve",
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
  "source_permuter_run",
  "source_permuter_replay",
  "source_mutation_preview",
  "type_oracle_lookup",
  "m2c_decompile",
  "review_lint_scan",
] as const;

/** Default integration resolver tools attached to worker-output conflict queue launches. */
export const defaultIntegrationResolverToolProfile = [
  "code_graph_file_card",
  "code_graph_search",
  "path_facts_resolve",
  "mismatch_db_search",
  "checkdiff_run",
  "checkdiff_summary",
  "direct_compile_tu",
  "objdiff_score_candidate",
  "source_mutation_preview",
  "type_oracle_lookup",
  "include_fixer_preview",
  "review_lint_scan",
] as const;

/** Default PR indexer tools attached to PR postmortem launches. */
export const defaultPrIndexerToolProfile = [
  "code_graph_search",
  "path_facts_resolve",
  "review_lint_scan",
] as const;

/** Default PR splitter tools attached to handoff planning launches. */
export const defaultPrSplitterToolProfile = [
  "code_graph_search",
  "path_facts_resolve",
  "review_lint_scan",
] as const;

/** Default PR fixer tools attached to opened-PR feedback repair launches. */
export const defaultPrFixerToolProfile = [
  "code_graph_file_card",
  "code_graph_search",
  "path_facts_resolve",
  "mismatch_db_search",
  "checkdiff_run",
  "checkdiff_summary",
  "direct_compile_tu",
  "objdiff_score_candidate",
  "source_mutation_preview",
  "type_oracle_lookup",
  "include_fixer_preview",
  "review_lint_scan",
] as const;

/** Default reconcile tools attached to ship-validate / sync-merge launches. */
export const defaultReconcileToolProfile = [
  "code_graph_file_card",
  "code_graph_search",
  "path_facts_resolve",
  "mismatch_db_search",
  "checkdiff_run",
  "checkdiff_summary",
  "direct_compile_tu",
  "objdiff_score_candidate",
  "type_oracle_lookup",
  "include_fixer_preview",
  "review_lint_scan",
] as const;

/** Default QA repair tools attached to candidate-file repair launches. */
export const defaultQaRepairToolProfile = [
  "code_graph_file_card",
  "code_graph_search",
  "path_facts_resolve",
  "mismatch_db_search",
  "checkdiff_run",
  "checkdiff_summary",
  "direct_compile_tu",
  "objdiff_score_candidate",
  "source_mutation_preview",
  "type_oracle_lookup",
  "review_lint_scan",
] as const;

/** Default knowledge-curator tools attached to curator launches. */
export const defaultKnowledgeCuratorToolProfile = [
  "code_graph_search",
  "legacy_lever_search",
  "decomp_standards_context",
  "decomp_standards_proposals",
  "path_facts_resolve",
  "path_facts_proposals",
] as const;
