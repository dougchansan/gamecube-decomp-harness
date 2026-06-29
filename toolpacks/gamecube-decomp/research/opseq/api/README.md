# Opseq API

CLI-style worker access:

- `python3 toolpacks/gamecube-decomp/research/opseq/api/status.py --repo-root <repo_root> --json`
- `python3 toolpacks/gamecube-decomp/research/opseq/api/similar_functions.py --query <query> --limit <n> --json`

Queries should be small and concrete: a function name, source path, symbol, or
opcode-sequence fingerprint.
