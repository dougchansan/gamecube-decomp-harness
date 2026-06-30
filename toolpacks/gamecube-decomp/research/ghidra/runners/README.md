# Ghidra Runners

Live runner:

```sh
python3 toolpacks/gamecube-decomp/research/ghidra/runners/run_headless_probe.py --repo-root <repo_root>
```

The runner resolves Homebrew Ghidra/OpenJDK when present, runs
`analyzeHeadless` against `build/GC6E01/main.elf`, and records bounded smoke
evidence in `cache/runner_status.json`, `cache/ghidra_headless_probe.log`, and
`indexes/ghidra_headless_probe.jsonl`.

Set `GHIDRA_ANALYZE_HEADLESS` or pass `--analyze-headless <path>` to use a
non-Homebrew Ghidra install.
