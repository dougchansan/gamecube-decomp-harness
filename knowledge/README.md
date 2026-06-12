# Decomp Orchestrator Knowledge

This directory is the runtime evidence surface for the orchestrator. Source
folders live under section folders such as
`knowledge/sources/code_context/past_prs`, and `knowledge/sources/registry.json`
maps stable source IDs to those paths.

## Access Sections

| Section | Sources | Access model |
| --- | --- | --- |
| Injected context | `decomp_standards`, `path_facts` | Compact context selected for worker boot. Standards are global; path facts resolve only for the target path or directory. |
| Searchable knowledge bases | `discord_knowledge`, `powerpc_docs` | Standalone RAG-style lookup through source-local APIs and graph search. |
| Code-connected evidence | `code_graph`, `past_prs`, `ssbm_data_sheet`, `external_mirrors` | Evidence that links to source paths, symbols, file cards, PR history, data rows, or mirrored names. |

Graph-owned mutable state is separate from source slices:

- `knowledge/resource_graph/enrichments/agent_shared_state_lessons.jsonl`
  contains durable lessons imported from the legacy shared agent-state DB.
- `knowledge/resource_graph/enrichments/knowledge_curator_updates.jsonl`
  contains generated worker/PR lessons plus proposal-only source updates.
- `mismatch_patterns` is a graph-owned derived source built during graph
  rebuild. It turns accepted curator records and imported historical lessons
  into linked pattern entities for recurring stack, register, inline,
  control-flow, literal/data-layout, type, split, loop, struct-layout, and
  negative-evidence mismatch knowledge.

These enrichment files are ingestion artifacts for the resource graph. Workers
do not search them as ordinary source corpora; they use `kg:file-card` and
`kg:search -- --source mismatch_patterns` for graph-connected mismatch
knowledge.

## Worker Flow

At worker start, the orchestrator can attach compact context: global decomp
standards, path facts for the target path, and graph/file-card evidence such as
editability, PR history, resource hits, and ranking signals. During research,
the worker should use source-specific tools for concrete questions:

- `code_graph_file_card` or `kg:file-card` for source-path context.
- `past_prs_search` for historical PR tactics, review risks, and file edges.
- `discord_knowledge_search` for community/compiler discussion.
- `powerpc_docs_search` or `powerpc_instruction_lookup` for ABI and instruction
  documentation.
- `ssbm_data_sheet_*` and `external_mirrors_*` for code-connected resource
  facts.
- `kg:search -- --source mismatch_patterns` for durable mismatch-pattern
  lessons linked into the graph.
- First-class tool APIs such as `ghidra_lookup`, `opseq_similar_functions`,
  `mismatch_db_search`, and `mwcc_debug_lookup` for tool-local cache or runner
  evidence.

Current source, headers, symbols, splits, assembly, objdiff/checkdiff, and
regression output outrank all historical or external knowledge.

## Physical Layout

```text
knowledge/
+-- README.md
+-- sources/
|   +-- registry.json       # active sections, source paths, access modes
|   +-- injectable/
|   |   +-- <source_id>/
|   +-- rag_search/
|   |   +-- <source_id>/
|   +-- code_context/
|       +-- <source_id>/
|           +-- source.json
|           +-- README.md
|           +-- data/
|           +-- indexes/
|           +-- api/
|           +-- commands/
|           +-- tests/
+-- resource_graph/
    +-- README.md
    +-- graph.sqlite        # compatibility/default DB when no project is selected
    +-- commands/
    +-- enrichments/
    +-- indexes/
    +-- schemas/
```

Callable tool suites live in the top-level `tools/` tree. Agent role behavior
and prompt context live beside the agents under `packages/agents/src/*/context/`.
Historical role/workflow docs live under `docs/archive/`, not here.

## Corpus Locations

| Source | Primary data |
| --- | --- |
| `decomp_standards` | `knowledge/sources/injectable/decomp_standards/data` |
| `path_facts` | `knowledge/sources/injectable/path_facts/data` |
| `past_prs` | `knowledge/sources/code_context/past_prs/data/current`, `knowledge/sources/code_context/past_prs/data/prs` |
| `discord_knowledge` | `knowledge/sources/rag_search/discord_knowledge/data/docs` |
| `ssbm_data_sheet` | `knowledge/sources/code_context/ssbm_data_sheet/data` |
| `powerpc_docs` | `knowledge/sources/rag_search/powerpc_docs/data` |
| `external_mirrors` | `knowledge/sources/code_context/external_mirrors/data` |

Generated tool caches and indexes live with the callable tool suites under
`tools/<category>/<tool_id>/{cache,indexes}`. They are not registered knowledge
sources. `tools/research/mismatch_db` stores tool-local objdiff/checkdiff
summaries and compatibility lookup rows; durable generalized mismatch patterns
are graph records under the `mismatch_patterns` source id.

## Command Surface

- `bun run kg:sources` lists active source sections and registered tools.
- `bun run kg:rebuild -- --repo-root <repo_root>` rebuilds the graph from active
  default sources and graph-owned enrichments.
- `bun run kg:smoke -- --strict` verifies active registered sources and tool APIs.
- `bun run kg:file-card -- --repo-root <repo_root> --source <source_path>`
  returns graph-connected context for a source file.
- `bun run kg:search -- --repo-root <repo_root> --source past_prs --query <term>`
  searches graph chunks for one active source.
- `bun run kg:search -- --repo-root <repo_root> --source mismatch_patterns
  --query <term>` searches durable graph-owned mismatch-pattern knowledge.
- `python3 knowledge/sources/<section>/<source_id>/api/status.py --json`
  checks source-local readiness.
- `python3 knowledge/sources/<section>/<source_id>/api/search.py --query <term> --json`
  searches a source-local generated JSONL index when that source exposes search.
- `python3 knowledge/sources/rag_search/<source_id>/commands/vectorize.py --json`
  embeds a RAG source's generated chunks into `indexes/vector.sqlite`.
- `python3 knowledge/sources/rag_search/<source_id>/api/semantic_search.py --query <question> --json`
  performs hybrid semantic lookup over a vectorized RAG source.
- `python3 tools/<category>/<tool_id>/api/status.py --repo-root <repo_root>
  --json` and each tool's lookup/search API provide direct access to generated
  tool evidence with cache freshness checks when the tool supports them.

Full PR-corpus maintenance remains:

- `bun run pr:refresh:all`
- `bun run pr:postmortems -- --dump-root knowledge/sources/code_context/past_prs/data/current --run-agent`
- `bun run pr:sync:all`
