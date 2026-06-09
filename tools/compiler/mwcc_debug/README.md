# MWCC Debug Tool

Lookup surface for cached MWCC pcdump output, compiler-pass summaries, and
last-mile compiler behavior notes.

Current state: live runner v1 plus harness bridge APIs.
`bun run kg:tool-runner:mwcc-debug` runs the
local `GC/1.2.5n` MWCC executable through Wine with `-version`, captures the
compiler output, extracts representative build-rule snippets from
`build.ninja`, and writes:

- `cache/runner_status.json`
- `cache/mwcc_version_probe.txt`
- `cache/mwcc_build_rule_snippets.json`
- `indexes/mwcc_probes.jsonl`

`build_tool_indexes.py` still generates `indexes/dumps.jsonl` from imported
MWCC reference docs.

Harness bridge APIs add target-specific live evidence:

- `api/dump_function.py` runs `mwcc_dump.py` and returns the function-filtered
  pcdump plus shape analysis.
- `api/diagnose.py --mode stack` explains stack/frame mismatch rows and named
  local movement.
- `api/diagnose.py --mode regflow` groups register-only mismatch windows and
  likely register roles.
- `api/diagnose.py --mode inlines` looks for inline extraction boundaries.
- `api/diagnose.py --mode raw` returns the raw filtered pcdump.

These calls require the instrumented `mwcceppc_debug.exe` built from the
reference harness and a current Melee build tree.

Reference material:

- `reference/SKILL.md`
- `reference/mwcc-inspect-SKILL.md`
- `knowledge/sources/reference_docs/data/docs/mwcc-debug.md`
