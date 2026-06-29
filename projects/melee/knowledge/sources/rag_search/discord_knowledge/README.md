# Discord Knowledge Source

Lightweight indexed source descriptor for Discord-derived notes.

The actual Discord corpus lives in `data/docs`. This slice owns the
API/indexing contract and keeps the legacy Discord skill notes in
`data/legacy-skill`.

Generated graph/search chunks are written to `indexes/chunks.jsonl` during
`kg-rebuild-graph`.

Semantic RAG lookup uses `indexes/vector.sqlite`, generated from
`indexes/chunks.jsonl` with:

```bash
python3 projects/melee/knowledge/sources/rag_search/discord_knowledge/commands/vectorize.py --json
```
