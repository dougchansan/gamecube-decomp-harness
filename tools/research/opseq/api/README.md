# Opseq API

CLI-style worker access:

- `python3 tools/research/opseq/api/status.py --json`
- `python3 tools/research/opseq/api/similar_functions.py --query <query> --limit <n> --json`

Queries should be small and concrete: a function name, source path, symbol, or
opcode-sequence fingerprint.
