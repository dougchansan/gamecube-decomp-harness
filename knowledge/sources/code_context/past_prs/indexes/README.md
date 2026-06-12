# Past PR Indexes

Planned source-local exports:

- `prs.jsonl`
- `pr_file_edges.jsonl`
- `pr_symbol_edges.jsonl`
- `review_risks.jsonl`
- `tactic_synthesis.jsonl`
- `file_rollups.jsonl`
- `fresh_graph_deltas.jsonl`

V1 writes the normalized records into the shared SQLite graph. The existing
processed PR library also keeps
`knowledge/sources/code_context/past_prs/data/library/index.jsonl` and
`knowledge/sources/code_context/past_prs/data/library/index.csv`.
