# MWCC Debug Runners

Live runner:

```sh
python3 toolpacks/gamecube-decomp/compiler/mwcc_debug/runners/probe_mwcc_compiler.py --repo-root <repo_root>
```

The runner smokes `build/compilers/GC/1.2.5n/mwcceppc.exe`,
captures the version output, extracts representative MWCC build-rule snippets
from `build.ninja`, and writes `cache/mwcc_version_probe.txt`,
`cache/mwcc_build_rule_snippets.json`, `indexes/mwcc_probes.jsonl`, and
`cache/runner_status.json`.
