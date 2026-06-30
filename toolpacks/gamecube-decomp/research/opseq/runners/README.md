# Opseq Runners

Live runner:

```sh
python3 toolpacks/gamecube-decomp/research/opseq/runners/extract_opcode_sequences.py --repo-root <repo_root>
```

The runner parses generated assembly under `build/GC6E01/asm`, extracts opcode
fingerprints for each function, and writes `cache/opcode_fingerprints.jsonl`,
`indexes/opcode_sequences.jsonl`, and `cache/runner_status.json`.

Rerun it after regenerating assembly or `build/GC6E01/report.json`.
