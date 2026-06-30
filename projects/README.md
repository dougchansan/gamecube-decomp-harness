# Projects

The orchestrator is the platform repository. Project descriptors in this
directory tell it which checkout, state directory, graph database, process name,
and local defaults to use for a decomp project.

Tracked project descriptors live at:

```text
projects/<project-id>/project.json
```

Machine-specific overrides live at:

```text
projects/<project-id>/local.project.json
```

`local.project.json` is ignored. Use it for absolute checkout paths or temporary
local paths that should not be committed. Explicit CLI flags and dashboard
advanced path overrides still win over both tracked and local project config.

For Pokemon Colosseum, either clone/worktree the project into
`projects/pkmn-colosseum/checkout/` or create
`projects/pkmn-colosseum/local.project.json` with a `repoRoot` that points at an
existing external checkout. This fork sets `pkmn-colosseum` as the default
project in `projects/config.json`.

Project-owned knowledge lives under `projects/<project-id>/knowledge/`: source
corpora, generated source indexes, tool caches, tool indexes, and graph
enrichment inputs. The active graph database lives under
`projects/<project-id>/graph/graph.sqlite`. Reusable callable tool definitions live in
`toolpacks/`, project-specific tool bindings and data live under each project,
and server APIs live under `apps/server/src`.

PR defaults live under the descriptor's `pr` key. `splitStrategy` can be
`deterministic` or `agent`; the tracked Colosseum descriptor uses `agent` so
handoff planning asks the PR splitter to reshape the deterministic seed plan.
