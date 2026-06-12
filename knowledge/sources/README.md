# Knowledge Sources

`knowledge/sources/` keeps stable vertical slices for corpora, indexes, and
source-local APIs. The active access model and physical source paths are
declared in `registry.json`: injected context, standalone RAG-style sources,
and code-connected evidence.

## Source Shape

```text
<section>/<source_id>/
+-- source.json       # descriptor, section, access modes, trust, commands
+-- README.md
+-- data/             # canonical corpus or source material
+-- indexes/          # generated JSONL lookup rows
+-- api/              # worker/operator lookup scripts
+-- commands/         # source maintenance scripts
+-- tests/            # source-local smoke notes/tests
```

Common source-local APIs:

```bash
python3 knowledge/sources/<section>/<source_id>/api/status.py --json
python3 knowledge/sources/<section>/<source_id>/api/search.py --query "<term>" --limit 10 --json
```

RAG sources also expose semantic retrieval after vectorization:

```bash
python3 knowledge/sources/rag_search/<source_id>/commands/vectorize.py --json
python3 knowledge/sources/rag_search/<source_id>/api/semantic_search.py --query "<question>" --limit 10 --json
```

Vectorization stores normalized embeddings in
`knowledge/sources/rag_search/<source_id>/indexes/vector.sqlite` and writes the
provider, model, dimensions, source fingerprint, and chunking policy to
`indexes/vector_manifest.json`.

Some sources expose focused aliases, such as:

- `path_facts/api/resolve_for_path.py`
- `discord_knowledge/api/topics_for_terms.py`
- `powerpc_docs/api/lookup_instruction.py`
- `ssbm_data_sheet/api/lookup_address.py`
- `ssbm_data_sheet/api/lookup_offset.py`
- `external_mirrors/api/lookup_external_symbol.py`

## Active Sections

| Section | Sources | Notes |
| --- | --- | --- |
| `injectable` | `decomp_standards`, `path_facts` | Auto-selected context. Search APIs exist for curation and focused follow-up, not broad worker browsing. |
| `rag_search` | `discord_knowledge`, `powerpc_docs` | Independently searchable knowledge bases. |
| `code_context` | `code_graph`, `past_prs`, `ssbm_data_sheet`, `external_mirrors` | Sources that connect to files, symbols, PRs, data rows, or mirrors. |

Callable tool results are intentionally not source slices. Expensive or
refreshable evidence belongs in each tool suite's own `cache/` or `indexes/`
folder under `tools/`, where the tool API can decide whether a cached response
is fresh enough for the current query.

## Rebuild And Smoke

The normal graph rebuild materializes declared `indexes/*.jsonl` outputs for
active default sources:

```bash
bun run kg:rebuild -- --sources all
bun run kg:smoke -- --strict
```

Use source-local status/search APIs when you need quick lookup without a graph
rebuild. Use `bun run kg:search`, `bun run kg:file-card`, or worker tools when
you need graph-level edges, rank signals, PR history, or cross-source context.
Use `semantic_search.py` when the question is conceptual enough that exact
terms may differ from useful source wording.
