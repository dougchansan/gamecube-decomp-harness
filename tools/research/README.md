# Research Tool Suites

Research suites gather evidence before or during a matching hypothesis. They do
not mutate source and should be called on demand when the worker lacks enough
context.

| Tool | What it does | Best trigger |
| --- | --- | --- |
| `ghidra` | Cached Ghidra symbol/address/string lookup and headless probe evidence. | A binary-derived clue needs corroboration. |
| `opseq` | Similar-function lookup from opcode fingerprints and function-shape rows. | A local analog could explain source shape. |
| `mismatch_db` | Known objdiff mismatch symptoms and source-shape tactics. | The first mismatch is known but the fix is unclear. |
| `m2c_decomp` | Harness-vendored m2c scaffold generation. | Control flow is unclear and a scaffold would help reading asm. |
