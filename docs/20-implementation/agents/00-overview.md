---
covers: Centralized agent implementation layout and boundary from trigger/guardian process actors
concepts: [agents, prompt-builders, runtime, registry, process-actors, vertical-slice]
code-ref: decomp-orchestrator/packages/agents/src
---

# Agents: Overview

Agent implementation is centralized under `packages/agents/src/`. Each role owns its
prompt builder, templates, schema or output parsing, and role-specific helpers.
Shared Pi invocation, artifact writing, prompt rendering, and JSON-output
salvage live in the runtime slice.

Trigger and guardian process actors are not implemented in `packages/agents/src/`
because they are not Pi agent roles. They live in the CLI/runtime command
surface and operate on process events and durable state.

## File Tree

```text
packages/agents/src/
+-- index.ts
+-- registry.ts
+-- types.ts
+-- context.ts
+-- context/
|   +-- manifest.json
+-- agents/
|   +-- knowledge/
|   |   +-- curator/
|   |   +-- pr-indexer/
|   +-- pr/
|   |   +-- fixer/
|   |   |   +-- reconcile/
|   |   +-- reviewer/
|   |   +-- splitter/
|   +-- run/
|       +-- worker/
+-- runtime/
+-- tools/
    +-- ...
```

## Section Scope

### What This Section Owns

- The central agent registry.
- Role prompt builders and templates.
- Output parsing and agent response contracts.
- Shared runtime integration with dry-run and live Pi sessions.

### What This Section Does Not Own

- SQLite state transitions after a parsed response.
- Trigger loops, guardian wrappers, restart policy, and lease-recovery command
  orchestration.
- Board target ranking logic.
- Knowledge file contents, except for selecting and rendering them into prompts.

## Child Nodes

- [Worker agents and scheduler delegation](10-director-worker.md)
- [PR indexer, splitter, and reviewer agents](20-pr-review.md)
- [Knowledge-curator agent](25-knowledge-curator.md)
- [Agent runtime](30-runtime.md)

## PR Fixer And Legacy Reconcile Mode

`packages/agents/src/agents/pr/fixer/` defines the bounded PR fixer surface.
Its stable runtime id remains `qa-repair` for compatibility with the existing
candidate-file repair lane. The fixer receives one repair item, fixes only the
listed deterministic findings, and returns the `melee_qa_repair_result_v1`
JSON contract. The runner owns final status: agent output must parse against
the schema, then the CLI reruns the QA scanner before a file can become
`clean_same_match` or `clean_lower_score`.

The legacy reconcile prompt is parked under
`packages/agents/src/agents/pr/fixer/reconcile/` and remains exported as
`@decomp-orchestrator/agents/reconcile`. It supports the existing
operator-triggered `reconcile` command while bundle-wide repair behavior is
folded into the PR reviewer/fixer flow. `ship-validate` consumes the latest
`regression-check` summary; `sync-merge` runs after upstream sync fallout.
Both refuse to run while the run status is `active`.

The fixer role has its own `qa-repair` tool profile, registry entry, prompt tests,
and Agent Viewer preview. Its prompt includes global decomp standards, the
queue item, the queue summary, the attached tool list, and the output schema so
preview rendering stays aligned with live prompt construction.
