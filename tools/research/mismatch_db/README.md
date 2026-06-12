# Mismatch DB Tool

Search surface for known assembly mismatch patterns, source-shape fixes, and
last-mile matching tactics.

Current state: live runner v1. `bun run kg:tool-runner:mismatch-db` chooses an
imperfect function from `build/GALE01/report.json`, runs `objdiff-cli diff`,
and writes:

- `cache/runner_status.json`
- `cache/objdiff_<symbol>.json`
- `indexes/objdiff_mismatches.jsonl`

`build_tool_indexes.py` still keeps `indexes/patterns.jsonl` present for
compatibility, so `api/search.py` can return live objdiff evidence alongside
any supplemental local pattern notes.
