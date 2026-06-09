---
covers: Top-level reusable worker tool suites, capability inventory, and optional attempt evaluation recipes
concepts: [tools, worker-tools, pi-extensions, validation, research, attempt-evaluation]
code-ref: tools, packages/knowledge/src/graph/sources.ts, packages/agents/src/tools
---

# Worker Tool Suites

The orchestrator keeps callable tool capabilities in the top-level `tools/`
tree. This separates process automation from `knowledge/`: knowledge sources
store searchable facts, while tools run lookups, validation checks, compiler
diagnostics, source-shape exploration, and data conversion helpers.

`tools/registry.json` is the routing contract. Stable ids such as
`checkdiff`, `mwcc_debug`, and `type_oracle` remain the Pi extension ids; the
registry supplies category, path, triggers, mutability, and agent guidance.
Runtime code resolves tool paths through
`resolveToolRoot(toolId)`.

## Layout

| Folder | Purpose |
| --- | --- |
| `tools/research` | Lookup evidence before editing or when a hypothesis is weak. |
| `tools/validation` | Compile, checkdiff, and objdiff proof after source changes. |
| `tools/compiler` | MWCC and type-analysis diagnosis. |
| `tools/source_editing` | Candidate source-shape helpers and review guardrails. |
| `tools/data_conversion` | Assembly/data conversion previews. |
| `tools/operations` | Human/operator scripts that are not Pi suite ids. |
| `tools/recipes` | Optional bundles, such as attempt evaluation feedback. |

## Suite Roles

| Tool | Role | Default use |
| --- | --- | --- |
| `checkdiff` | Focused compile/checkdiff validation. | Attempt evaluation feedback. |
| `review_lint` | Source review anti-pattern scan. | Attempt evaluation feedback. |
| `include_fixer` | Missing include preview. | Conditional feedback after declaration diagnostics. |
| `objdiff_score` | Candidate object scoring. | Conditional feedback when a candidate object exists. |
| `mwcc_debug` | Compiler stack/regflow/inline diagnosis. | Conditional feedback after shape-specific validation symptoms. |
| `ghidra` | Binary symbol/address lookup. | On-demand research. |
| `opseq` | Similar function lookup. | On-demand research before inventing source shape. |
| `mismatch_db` | Known mismatch tactic lookup. | On-demand after first mismatch evidence. |
| `m2c_decomp` | Control-flow scaffold generation. | On-demand for understanding asm only. |
| `type_oracle` | Expression type lookup. | On-demand before type-sensitive rewrites. |
| `source_permuter` | Source-shape search and preview. | On-demand; non-mutating worker defaults. |
| `struct_infer` | Pointer-register layout inference. | On-demand when offsets need grounding. |
| `item_state_table` | Item state table conversion preview. | On-demand for asm data labels. |

## Contract

Workers should not need prompt text listing command paths or a mandatory
post-edit checklist. They should be given a compact tool inventory and trusted
to choose the relevant capability for the concrete question.

Validation tools are available as an optional attempt-evaluation recipe:
`tools/recipes/attempt-evaluation.json`. That recipe bundles review lint,
compile/checkdiff, and conditional follow-up suggestions into feedback about
what is right, wrong, or still unknown about a specific source-edit attempt.
Research tools are not workflow steps; they are affordances the agent can pull
when its hypothesis needs more evidence.

The graph still indexes generated `indexes/*.jsonl` rows through the
`tool_outputs` source. That gives agents searchable cached evidence without
making the cache location part of the prompt.
