# MWCC Debug API

CLI-style worker access:

- `python3 tools/compiler/mwcc_debug/api/status.py --repo-root <repo_root> --json`
- `python3 tools/compiler/mwcc_debug/api/lookup_dump.py --query <query> --limit <n> --json`
- `python3 tools/compiler/mwcc_debug/api/dump_function.py --repo-root <repo_root> --function <symbol> --json`
- `python3 tools/compiler/mwcc_debug/api/diagnose.py --repo-root <repo_root> --mode <stack|regflow|inlines|raw> --function <symbol> --json`

Lookup reads cached dump/index files. Dump and diagnose are explicit
target-specific tool-local calls because they may compile the owning translation
unit and require the instrumented MWCC debug compiler.
