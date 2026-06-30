# MWCC Debug Tool

Lookup surface for cached MWCC pcdump output, compiler-pass summaries, and
last-mile compiler behavior notes.

Current state: live runner v1 plus tool-local dump/diagnose APIs.
`python3 toolpacks/gamecube-decomp/compiler/mwcc_debug/runners/probe_mwcc_compiler.py --repo-root <repo_root>`
smokes the local `GC/1.2.5n` MWCC executable with `-version`,
captures the compiler output, extracts representative build-rule snippets from
`build.ninja`, and writes:

- `cache/runner_status.json`
- `cache/mwcc_version_probe.txt`
- `cache/mwcc_build_rule_snippets.json`
- `indexes/mwcc_probes.jsonl`

`build_tool_indexes.py` keeps `indexes/dumps.jsonl` present as a tool-local
lookup surface.

Tool-local APIs add target-specific live evidence:

- `api/dump_function.py` runs `mwcc_dump.py` and returns the function-filtered
  pcdump plus shape analysis.
- `api/diagnose.py --mode stack` explains stack/frame mismatch rows and named
  local movement.
- `api/diagnose.py --mode regflow` groups register-only mismatch windows and
  likely register roles.
- `api/diagnose.py --mode inlines` looks for inline extraction boundaries.
- `api/diagnose.py --mode raw` returns the raw filtered pcdump.

These calls require the instrumented `mwcceppc_debug.exe` built from
`toolpacks/gamecube-decomp/_impl/gamecube/mwcc_debug` and a current project build tree.
