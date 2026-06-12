# Checkdiff Tool Suite

This suite exposes tool-local validation helpers through the orchestrator tool
registry. It gives workers named APIs for:

- focused checkdiff output for one function;
- PASS/FAIL summaries for one or more functions;
- direct MWCC translation-unit compilation from `build.ninja`.

The APIs keep output JSON-shaped and bounded. The tool-local helper scripts
perform the work against the selected Melee checkout, so results should be
treated as local tool evidence with the command, checkout root, and stderr
preserved.

Use this suite when a source edit needs proof from the project compiler and
objdiff, or when a worker needs to know whether the current translation unit
still compiles directly under the exact MWCC rule.
