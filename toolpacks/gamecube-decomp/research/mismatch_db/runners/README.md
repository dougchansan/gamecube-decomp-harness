# Mismatch DB Runners

Live runner:

```sh
python3 toolpacks/gamecube-decomp/research/mismatch_db/runners/analyze_objdiff_mismatches.py --repo-root <repo_root>
```

The runner chooses an imperfect function from `build/GC6E01/report.json`, runs a
narrow `build/tools/objdiff-cli diff`, and writes `cache/objdiff_<symbol>.json`,
`indexes/objdiff_mismatches.jsonl`, and `cache/runner_status.json`.

Pass `--unit <unit> --symbol <symbol>` to analyze a specific target.
