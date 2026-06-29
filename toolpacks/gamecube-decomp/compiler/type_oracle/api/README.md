# Type Oracle API

Worker-facing commands:

- `python3 toolpacks/gamecube-decomp/compiler/type_oracle/api/status.py --repo-root <repo_root> --json`
- `python3 toolpacks/gamecube-decomp/compiler/type_oracle/api/inspect.py --repo-root <repo_root> --source-path <src.c> --expression <expr> --json`

`inspect.py` can also accept `--byte-start` and `--byte-end` for exact span
lookups. Without an expression or span, it returns a bounded sample of the
source file's typed expression spans.
