# Source Editing Tool Suites

Source-editing suites help propose or guard source changes. Worker defaults
should avoid silent mutation unless a caller explicitly chooses an applying
operation.

| Tool | What it does | Process rule |
| --- | --- | --- |
| `source_permuter` | Bounded source-shape search, replay, and mutation preview. | On demand; default to non-mutating candidate evidence. |
| `include_fixer` | Missing include/header proposal preview. | Conditional after undeclared identifier or missing prototype diagnostics. |
| `review_lint` | Decomp review anti-pattern scan. | Attempt-evaluation or explicit source-review feedback. |
