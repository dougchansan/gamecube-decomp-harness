# m2c Decomp API

Worker-facing commands:

- `python3 toolpacks/gamecube-decomp/research/m2c_decomp/api/status.py --repo-root <repo_root> --json`
- `python3 toolpacks/gamecube-decomp/research/m2c_decomp/api/decompile.py --repo-root <repo_root> --input <function_or_unit> --json`

The wrapper passes `--no-copy` by default so it never writes to the clipboard.
It does not expose `--write`; source insertion should be a deliberate human or
agent edit after review.
