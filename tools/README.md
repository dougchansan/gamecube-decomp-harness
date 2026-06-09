# Worker Tool Suites

This directory owns callable tool capabilities for agents. The tools are kept
outside `knowledge/` because they are process automation and lookup surfaces;
the knowledge graph may index their cached outputs through `tool_outputs`, but
the tools themselves are reusable extensions.

`tools/registry.json` is the source of truth for stable tool ids, physical
paths, categories, and lightweight usage metadata. Agent prompts should present
tool ids as available capabilities; code should resolve suite paths through the
registry rather than hardcoding category folders.

```text
tools/
+-- registry.json
+-- recipes/
+-- research/
+-- validation/
+-- compiler/
+-- source_editing/
+-- data_conversion/
+-- operations/
+-- _shared/
```

Each registered suite keeps the same shape:

```text
<category>/<tool_id>/
+-- tool.json
+-- README.md
+-- api/
+-- runners/
+-- cache/
+-- indexes/
+-- tests/
```

## Capability Roles

| Tool | Category | Role | Default use |
| --- | --- | --- | --- |
| `checkdiff` | validation | compile/checkdiff feedback | attempt evaluation |
| `review_lint` | source_editing | source review guardrail | attempt evaluation |
| `include_fixer` | source_editing | missing include preview | conditional feedback |
| `objdiff_score` | validation | candidate object scoring | conditional feedback |
| `mwcc_debug` | compiler | compiler-shape diagnosis | conditional feedback |
| `ghidra` | research | binary lookup | on demand |
| `opseq` | research | similar function lookup | on demand |
| `mismatch_db` | research | mismatch tactic lookup | on demand |
| `m2c_decomp` | research | control-flow scaffold | on demand |
| `type_oracle` | compiler | expression type lookup | on demand |
| `source_permuter` | source_editing | source-shape exploration | on demand |
| `struct_infer` | data_conversion | asm layout inference | on demand |
| `item_state_table` | data_conversion | asm data conversion preview | on demand |

## Recipes

Recipes are optional bundles, not schedulers. The baseline contract is:
the agent sees the available tools, chooses the relevant research or validation
capability, and calls it when it needs evidence.

- `tools/recipes/attempt-evaluation.json` describes the validation feedback
  bundle for a concrete source-edit attempt: review lint, compile/checkdiff,
  and conditional follow-up suggestions. It is useful when the agent wants a
  structured answer to "what is right, wrong, or still unknown about this
  attempt?"

## Maintenance Commands

- `python3 tools/build_tool_indexes.py --repo-root <repo_root>` creates
  lightweight JSONL indexes for registered lookup suites.
- `bun run kg:tool-runner:ghidra` runs the Ghidra headless probe.
- `bun run kg:tool-runner:opseq` refreshes opcode fingerprints.
- `bun run kg:tool-runner:mismatch-db` refreshes mismatch evidence.
- `bun run kg:tool-runner:mwcc-debug` refreshes MWCC/Wine probe evidence.

Workers usually call Pi extensions or suite `api/*.py` scripts, not runners.
Runners and caches are operator surfaces for refreshing shared evidence.
