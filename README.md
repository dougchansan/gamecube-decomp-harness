# GameCube Decomp Harness

GameCube Decomp Harness is a Bun/TypeScript workspace for coordinating
high-parallelism decompilation runs. It gives a GameCube decomp project a
durable agent control plane: many Pi worker agents can research, edit, validate,
and report in parallel while sharing one run board, one knowledge graph, and one
set of project-specific safety rails.

The fork default project is Pokemon Colosseum. The harness is organized around
`projects/<id>/project.json` descriptors so the same machinery can be pointed at
project-specific GameCube decompilation workspaces.

![GameCube Decomp Harness dashboard](docs/assets/dashboard-screenshot.png)

## What It Does

- Runs director and worker Pi agents against queued decompilation targets.
- Coordinates many workers through SQLite leases, file locks, events, reports,
  and run artifacts instead of agent-to-agent chat.
- Feeds agents from a shared knowledge graph of docs, workflows, tools, past PRs,
  decomp resources, and project-specific facts.
- Keeps long-running sessions inspectable through a dense dashboard with process
  controls, worker reports, queue state, progress panels, and handoff surfaces.
- Wraps validation and handoff flows such as smoke runs, score regression checks,
  PR slice planning, and knowledge refresh.

The intent is not to replace maintainers or project-specific build systems. The
harness automates the repetitive search, edit, validate, and report loop so a
human can supervise progress and review the work that survives validation.

## Quick Start

Install dependencies and run the local checks:

```sh
bun install
bun run check
bun run smoke
```

`bun run smoke` uses dry-run agents and fixture data, so it does not require a
live provider or edit a real decompilation checkout.

This branch expects the Agent Kernel workspace at
`/Users/douglaswhittingham/Codecaine/agent-kernel`, with its `prompt-kit`
submodule initialized and dependencies installed:

```sh
git clone https://github.com/Codecaine-AI/agent-kernel.git ../Codecaine/agent-kernel
git -C ../Codecaine/agent-kernel checkout fa2ebf7418a48c6bb85fafe237d28887507d8230
git -C ../Codecaine/agent-kernel submodule update --init --recursive packages/prompt-kit
bun install --cwd ../Codecaine/agent-kernel --linker hoisted
```

Inspect the server job surface:

```sh
bun run server:job -- --project pkmn-colosseum status
```

Launch the dashboard when you want the browser control surface:

```sh
bun run ui
```

The dashboard serves at `http://localhost:8787` by default.

## Live Project Setup

The tracked Pokemon Colosseum descriptor defaults to
`projects/pkmn-colosseum/checkout/`. For local work, either place a checkout
there or create ignored `projects/pkmn-colosseum/local.project.json` with
machine-specific paths for the repo, state directory, graph database, env file,
and process defaults.

Live agent sessions need:

- Bun, Python 3, and Git.
- A configured GameCube decompilation checkout with its normal build and objdiff
  tooling.
- Pi provider/auth configuration for the selected provider, model, and thinking
  level.
- Project-local secrets in ignored env files such as
  `projects/pkmn-colosseum/local.env`.

Keep literal API keys and generated session state out of tracked files.

## Typical Run Shape

Initialize a run:

```sh
bun run server:job -- --project pkmn-colosseum init-run \
  --desired-workers 16 \
  --goal-kind matched_code_percent \
  --goal-value 72
```

Run the supervised worker loop:

```sh
bun run server:job -- --project pkmn-colosseum --agent-timeout-seconds 14400 babysit \
  --max-workers 16 \
  --idle-sleep-ms 5000 \
  --worker-thinking-level low
```

Before review or handoff, run the regression gate:

```sh
bun run server:job -- --project pkmn-colosseum regression-check
```

For high-throughput runs, tune worker count, queue size, candidate windows, graph
ranking, and lease recovery flags from server jobs or the dashboard. The detailed
operational notes live in the docs.

## Repository Map

| Area | Purpose |
| --- | --- |
| `apps/frontend/` | React/Vite dashboard frontend. |
| `apps/server/` | Bun API/static server plus server-owned jobs, process controls, run orchestration, validation, handoff, agents, tools, knowledge, project registry, platform helpers, smoke tests, and fixtures. |
| `packages/agent-kernel/` | Symlinked external Agent Kernel workspace used by the server runtime. |
| `projects/` | Tracked project descriptors plus ignored project-local checkout, state, graph, env, and session paths. |
| `knowledge/` | Repo-level references, resources, indexes, graph state, and past-PR corpus. |
| `docs/` | Foundation, system design, implementation details, runbooks, and preserved design artifacts. |

## Docs

- [Docs map](docs/README.md)
- [Evidence refresh cadence](EVIDENCE_REFRESH_CADENCE.md)
- [Foundation overview](docs/00-foundation/00-overview.md)
- [System design overview](docs/10-system-design/00-overview.md)
- [Run director loop](docs/10-system-design/10-run-director-loop.md)
- [Agent model](docs/10-system-design/20-agent-model.md)
- [Process guardians](docs/10-system-design/25-process-guardians.md)
- [Worker lifecycle](docs/10-system-design/40-worker-lifecycle.md)
- [Server job implementation](docs/20-implementation/server-jobs/00-overview.md)
- [UI implementation](docs/20-implementation/ui/00-overview.md)
