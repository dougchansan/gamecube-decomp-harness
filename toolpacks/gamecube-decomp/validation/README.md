# Validation Tool Suites

Validation suites prove whether a source-edit attempt improved or regressed
matching. They are best thought of as feedback tools: call them when the agent
has a concrete attempt ready to evaluate, or when it explicitly needs compile,
checkdiff, or score evidence.

| Tool | What it does | Process rule |
| --- | --- | --- |
| `checkdiff` | Direct MWCC compile, focused checkdiff run, and summary output. | Attempt-evaluation feedback. |
| `objdiff_score` | Score a candidate object/function with objdiff evidence. | Conditional when a candidate object exists. |
