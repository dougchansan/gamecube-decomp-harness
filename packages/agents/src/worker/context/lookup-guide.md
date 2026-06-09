# Worker Lookup Guide

Use this opt-in context when the packet needs fact research, resource lookup,
scratch/history reconstruction, or type/symbol resolution.

## Search Order

1. File graph or file card for the target source: editability, known PR touches,
   related files, resource hits, and rank signals.
2. Local repo source: target file, sibling files, headers, macros, symbols,
   splits, glossary terms, report strings, assert strings, and nearby matched
   functions.
3. Past PRs: exact source path, symbol, subsystem, struct/field term, mismatch
   class, review warning, and tactic.
4. Data/resource sources: SSBM data sheet CSVs, PowerPC docs, external mirrors,
   Discord/reference docs, and normalized tool output.
5. Tool-specific lookups only when the local/resource evidence points to a
   concrete question.

## Tool Selection

| Tool | Use when the concrete question is | Worker value |
| --- | --- | --- |
| `code_graph_file_card` | "What does the graph already know about this leased source path?" | Editability, match status, PR history, related resources, and scheduling signals. |
| `code_graph_search` | "Which local symbols, units, source paths, or graph metadata mention this term?" | Current-checkout code facts before historical or external hints. |
| `past_prs_search` | "Has a prior accepted/rejected PR touched this file, subsystem, tactic, or review risk?" | Historical tactics and reviewer constraints with PR provenance. |
| `discord_knowledge_search` / `discord_knowledge_topics_for_terms` | "Does community/compiler discussion explain this loose compiler or workflow term?" | Supplemental compiler and review folklore; verify locally. |
| `ssbm_data_sheet_search` / `ssbm_data_sheet_lookup_address` / `ssbm_data_sheet_lookup_offset` | "Is this address, offset, ID, action state, hitbox, hurtbox, attribute, or resource row documented?" | Data-sheet facts with row provenance. |
| `powerpc_docs_search` / `powerpc_instruction_lookup` | "What does the PowerPC ABI or instruction documentation say?" | ABI, register, stack-frame, condition-register, branch, conversion, and instruction behavior. |
| `external_mirrors_search` / `external_symbol_lookup` | "Do mirrored external references name this symbol or concept?" | Supplemental names and hints that must lose to local source, symbols, splits, assembly, and objdiff. |
| `resource_guides_search` / `reference_docs_search` | "Which guide or local reference source should I trust for this kind of question?" | Source selection, trust rules, and repo-local docs. |
| `tool_outputs_search` / `tool_outputs_tool_lookup` | "I know the symbol, file, opcode, or mismatch term, but not which tool owns the evidence." | Cross-tool search before narrowing to one tool API. |
| `tool_outputs_similar_functions` / `opseq_similar_functions` | "Which functions have a similar instruction shape or distinctive opcode pattern?" | Matched analogs, duplicate-adaptation candidates, opcode fingerprints, and structural clues. |
| `tool_outputs_mismatch_patterns` / `mismatch_db_search` | "What known pattern explains this first mismatch?" | Known mismatch symptoms such as `stack`, `register`, `inline`, `literal`, `branch`, opcode names, source-shape tactics, and negative evidence. |
| `ghidra_lookup` | "What symbol, address, source path, string, name, caller, or callee context belongs to this target?" | Symbol/address sanity, string/name hints, call-context clues, and a second opinion. Decompiler-shaped output is only a hypothesis. |
| `mwcc_debug_lookup` | "Is this still a compiler/codegen problem after lighter evidence stopped explaining it?" | MWCC notes for register allocation, stack/frame, local lifetime, varargs/assert layout, coalescing, and scheduling. |
| `checkdiff_run` / `checkdiff_summary` / `direct_compile_tu` | "Does the current source compile and how does objdiff judge this concrete function or batch?" | Verifier proof, neighbor summaries, and compile/build separation without carrying raw shell commands in the prompt. |
| `mwcc_debug_dump_function` / `mwcc_debug_diagnose_stack` / `mwcc_debug_diagnose_regflow` / `mwcc_debug_diagnose_inlines` / `mwcc_debug_raw_dump` | "Which MWCC pcdump or diagnosis mode explains this late mismatch?" | Function-filtered pcdump, stack/frame movement, register-flow windows, and inline-boundary candidates. |
| `type_oracle_lookup` | "What clang type does this expression/span have in the current source file?" | Safer temp extraction, pointer/value confirmation, and source-state-specific type evidence. |
| `struct_infer_from_asm` | "What fields are accessed through this pointer register in generated asm?" | Candidate struct offsets, access sizes, and stride hints before field/type edits. |
| `m2c_decompile` | "Would an m2c scaffold help me read this function or TU?" | Control-flow and data-flow reading aid only; never paste scaffold output as final source. |
| `include_fixer_preview` / `item_state_table_preview` | "Can a harness utility propose includes or an item-state table without writing source?" | Non-mutating previews for include/header evidence or data-definition conversion. |
| `source_mutation_preview` / `source_permuter_run` / `source_permuter_replay` | "Is a last-resort source-shape search or replay justified?" | Candidate diffs and replay evidence with worker default `apply=never`; verify manually before retaining edits. |
| `objdiff_score_candidate` | "How does objdiff score this already-built candidate object?" | Candidate object score breakdown when a `.o` path already exists. |
| `review_lint_scan` | "Does this proposed source/text trip decomp-specific review anti-patterns?" | Type-erasing cast, `M2C_FIELD`, and inline-helper pointer-variable checks before handoff. |
| `decomp_standards_search` / `decomp_standards_context` | "Do the injected standards answer this, or do I need a focused standards search?" | Global source-quality and review policy; current source and verifier output still outrank standards. |
| `path_facts_resolve` / `path_facts_search` | "Are there accepted path-scoped facts for this source or directory?" | Scoped worker hints and known stale-check rules for the source slice. |

## Evidence Rules

- Local source, headers, symbols, splits, assembly, and objdiff outrank PR notes
  and external mirrors.
- A fact is useful only when it changes the next bounded hypothesis, verifies a
  name/type/layout, or explains why a target should cool down.
- Keep provenance in the report: source path, PR number, graph result, tool
  output path, or resource CSV/PDF row.
- For tool APIs, inspect top-level `available`, `operation_mode`,
  `runner_smoke_passed`, and `limitations`, then inspect each result's `kind`,
  `title`, `evidence_ref`, `payload`, and `index_file` when present.
- Treat live rows, fallback rows, and reference-note chunks differently. A
  fallback row from `build/GALE01/report.json` can prove symbol/source metadata,
  not a Ghidra xref. A note chunk can suggest a tactic, but still needs local
  source and objdiff/checkdiff validation.
- If sources disagree, preserve the disagreement as negative evidence instead
  of forcing a guessed fact.

## Fact Outputs

Good facts are small and reusable: field names, struct ownership, callback
relationships, duplicate source shapes, review constraints, verifier commands,
and named compiler-shape levers. Avoid broad summaries that cannot be checked.
