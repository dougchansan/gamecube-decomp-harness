# Checkdiff API

Worker-facing commands:

- `python3 toolpacks/gamecube-decomp/validation/checkdiff/api/status.py --repo-root <repo_root> --json`
- `python3 toolpacks/gamecube-decomp/validation/checkdiff/api/run.py --repo-root <repo_root> --function <symbol> --json`
- `python3 toolpacks/gamecube-decomp/validation/checkdiff/api/summary.py --repo-root <repo_root> --function <symbol> --json`
- `python3 toolpacks/gamecube-decomp/validation/checkdiff/api/direct_compile.py --repo-root <repo_root> --function <symbol> --json`

`run.py` prints the focused objdiff/checkdiff output. `summary.py` is cheaper
for batches because it compiles each translation unit once. `direct_compile.py`
checks the exact MWCC build edge for a function or unit without running objdiff.
