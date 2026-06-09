# Compiler Tool Suites

Compiler suites explain behavior that normal source inspection or basic
checkdiff output cannot resolve.

| Tool | What it does | Best trigger |
| --- | --- | --- |
| `mwcc_debug` | pcdump and stack/register/inline diagnosis through the harness debug compiler. | checkdiff points to stack, register-flow, or inline-boundary mismatch. |
| `type_oracle` | libclang expression type lookup for source spans. | A temporary extraction or pointer/value rewrite needs type evidence. |
