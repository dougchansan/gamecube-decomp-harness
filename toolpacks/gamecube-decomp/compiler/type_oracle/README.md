# Type Oracle Tool Suite

This suite exposes the tool-local libclang type oracle. It parses a source file with the real `compile_commands.json` flags and
maps main-file expression byte spans to clang type spellings.

Use it when a worker needs to extract a subexpression into a named temporary,
split an inline, or confirm a pointer/value type before a source-shape edit.
The oracle is source-state-specific: rebuild it after editing the file.
