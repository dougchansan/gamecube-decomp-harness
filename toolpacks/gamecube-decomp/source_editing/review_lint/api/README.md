# Review Lint API

Worker-facing commands:

- `python3 toolpacks/gamecube-decomp/source_editing/review_lint/api/status.py --json`
- `python3 toolpacks/gamecube-decomp/source_editing/review_lint/api/scan.py --file <path> --json`
- `python3 toolpacks/gamecube-decomp/source_editing/review_lint/api/scan.py --text '<source snippet>' --json`

Use `--rule all`, `--rule type_erasing_casts`, or
`--rule inline_pointer_vars` to narrow the scan.
