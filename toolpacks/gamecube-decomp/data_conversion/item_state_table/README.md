# ItemStateTable Tool Suite

This suite previews the tool-local ItemStateTable conversion helper. It finds the
owning source file from `splits.txt`, parses the assembly `.obj` table, formats
a C `ItemStateTable` definition, and reports whether an insertion point appears
to exist.

The full helper can write into the source file. This suite previews only so
data ownership and review risk can be checked before editing.
