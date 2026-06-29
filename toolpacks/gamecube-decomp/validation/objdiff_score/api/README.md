# objdiff Score API

Worker-facing commands:

- `python3 toolpacks/gamecube-decomp/validation/objdiff_score/api/status.py --repo-root <repo_root> --json`
- `python3 toolpacks/gamecube-decomp/validation/objdiff_score/api/score_candidate.py --repo-root <repo_root> --function <symbol> --candidate-object <path.o> --json`

`score_candidate.py` resolves the owning unit through `report.json` unless
`--unit` is supplied.
