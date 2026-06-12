# Ghidra API

CLI-style worker access:

- `python3 tools/research/ghidra/api/status.py --repo-root <repo_root> --json`
- `python3 tools/research/ghidra/api/lookup.py --query <query> --limit <n> --json`

The lookup API should prefer cached indexes. Live Ghidra calls belong in
`runners/` and should only run when explicitly requested by a worker or operator.
