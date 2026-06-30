# Mismatch DB Tool

Search surface for known assembly mismatch patterns, source-shape fixes, and
last-mile matching tactics.

Current state: live runner v1.
`python3 toolpacks/gamecube-decomp/research/mismatch_db/runners/analyze_objdiff_mismatches.py --repo-root <repo_root>`
chooses an imperfect function from `build/GC6E01/report.json`, runs
`objdiff-cli diff`, and writes:

- `cache/runner_status.json`
- `cache/objdiff_<symbol>.json`
- `indexes/objdiff_mismatches.jsonl`

`build_tool_indexes.py` keeps `indexes/patterns.jsonl` present so
`api/search.py` can return live objdiff evidence alongside any supplemental
local pattern notes.
