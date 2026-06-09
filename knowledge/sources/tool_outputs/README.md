# Tool Outputs Source

Indexed source that normalizes cached outputs from `tools` into graph
facts.

The tools themselves live under `tools/<category>/<tool_id>`. This source
normalizes those caches and generated indexes into graph-searchable facts.

Generated tool-output search chunks are written to
`indexes/tool_findings.jsonl` during `kg-rebuild-graph`.
