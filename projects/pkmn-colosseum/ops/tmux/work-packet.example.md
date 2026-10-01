# Decompilation work packet

Coordinator: <claude or codex; one owner>
Assigned agent: <claude, codex or local model>
Task ID: <unique ID>
Baseline commit: <SHA>
Worktree: <absolute path; exclusive to this editing agent>
Write scope: <source/header paths; do not edit outside these>
Function/object: <symbol, retail address and object owner>
Baseline: <function size, raw score, residual functions and object-link payoff>
Compiler: <version, flags and tool fingerprints>
Evidence: <assembly/reference paths, known types and callsites>

Read the checkout's AGENTS.md and campaign operations before starting. Compile
each proposal with the target flags and inspect objdiff feedback. Preserve
semantics; no .inc edits, wrappers or artificial compiler shaping. Do not edit
other agents' worktrees, publish, merge or restart workers. Local-model drafts
remain proposals until independently compiled and reviewed.

## Result handoff

Candidate path or commit: <value>
Files changed: <paths>
Commands and outcomes: <exact commands, exit codes and refreshed report>
Raw function scores: <before/after>
Exact-source delta: <functions/bytes>
Newly linked delta: <objects/bytes, or zero>
Semantic evidence: <types, behavior, SDK/source reference>
Sibling/data/relocation checks: <results>
Full link/retail hash: <result or not run>
Remaining blockers: <specific mismatches or missing checks>

## Coordinator takeover

Next coordinator: <agent>
Active task owners and worktrees: <list>
Outstanding proposals and reports: <paths>
Last independently verified report and integration head: <paths/SHA>
Next action: <bounded step; preserve running workers and their ownership>
