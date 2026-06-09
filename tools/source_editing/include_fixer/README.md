# Include Fixer Tool Suite

This suite ports the harness `fix_includes.py` workflow into a non-mutating
preview API. It runs a clang syntax-only check, extracts undeclared function
diagnostics, searches headers for declarations, and returns proposed include
lines plus a unified diff.

The upstream tool writes to the file. This orchestrator suite previews only so
workers can inspect and apply the minimum justified edit themselves.
