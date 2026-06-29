---
covers: Reusable GameCube decomp toolpack, project tool bindings, agent tool wrappers, validation tools, and scoped tool data
concepts: [tools, toolpacks, project-bindings, worker-tools, pi-extensions, validation, research, worktree-cache]
code-ref: toolpacks/gamecube-decomp, projects/melee/project.json, projects/melee/tool-bindings, apps/server/src/core/tools/resolver.ts, apps/server/src/core/tools
---

# Worker Tool Suites

Callable decomp tools are resolved through a toolpack/project binding runtime.
Reusable GameCube decomp tool contracts, default Python APIs, runners, recipes,
and shared helper modules live in `toolpacks/gamecube-decomp`. A project
selects that pack from `projects/<id>/project.json` and owns its bindings,
stable generated tool data, and mutable worktree output.

`apps/server` owns the resolver and agent-facing wrappers only. It does not own
or mirror a server-local tool resource tree; callable tool definitions,
implementations, runner scripts, and tests belong to the toolpack selected by
the project descriptor.

Knowledge sources and tools are separate surfaces. Knowledge sources store
searchable or injectable facts. Tools execute lookup, validation, compiler,
source-editing, and conversion operations against a resolved project/worktree
context.

## Ownership

| Surface | Path | Owner |
| --- | --- | --- |
| Toolpack descriptor | `toolpacks/gamecube-decomp/toolpack.json` | Reusable GameCube decomp pack metadata. |
| Tool registry | `toolpacks/gamecube-decomp/registry.json` | Stable tool ids, paths, categories, usage metadata. |
| Tool slices | `toolpacks/gamecube-decomp/<category>/<tool_id>` | Default APIs, runners, descriptors, tests, and docs. |
| Shared helper code | `toolpacks/gamecube-decomp/_shared` | Toolpack-level Python support helpers. |
| Shared implementation modules | `toolpacks/gamecube-decomp/_impl/gamecube` | Toolpack-owned implementation helpers used by public tool APIs. |
| Project binding root | `projects/<id>/tool-bindings/<tool_id>.json` | Enablement, overrides, and per-project roots. |
| Shared project tool data | `projects/<id>/shared/tool-data/<tool_id>` | Stable indexes/cache tied to a project binary or base checkout. |
| Worktree tool cache | `projects/<id>/worktrees/<worktree_id>/tool-cache/<tool_id>` | Mutable validation, compiler, editing, and candidate output for one active worktree. |

## Runtime

`apps/server/src/core/tools/resolver.ts` merges:

- the enabled toolpack from `projects/<id>/project.json`;
- the tool's registry entry;
- the project binding file;
- optional project override roots;
- the runtime project and worktree context.

The merged tool context contains the API path, tool root, project repo root,
project state dir, shared data root, worktree cache root, implementation root,
and a command environment. Agent wrappers call tools by stable ids such as
`checkdiff`, `ghidra`, and `review_lint`; they do not hardcode physical script
paths.

## Suite Roles

| Tool | Role | Default use |
| --- | --- | --- |
| `checkdiff` | Focused compile/checkdiff validation. | Attempt evaluation feedback. |
| `review_lint` | Source review anti-pattern scan. | Attempt evaluation feedback and QA gates. |
| `include_fixer` | Missing include preview. | Conditional feedback after declaration diagnostics. |
| `objdiff_score` | Candidate object scoring. | Conditional feedback when a candidate object exists. |
| `mwcc_debug` | Compiler stack/regflow/inline diagnosis. | Conditional feedback after shape-specific validation symptoms. |
| `ghidra` | Binary symbol/address lookup. | On-demand research. |
| `opseq` | Similar function lookup. | On-demand research before inventing source shape. |
| `mismatch_db` | Known mismatch tactic lookup. | On-demand after first mismatch evidence. |
| `m2c_decomp` | Control-flow scaffold generation. | On-demand for understanding asm only. |
| `type_oracle` | Expression type lookup. | On-demand before type-sensitive rewrites. |
| `source_permuter` | Source-shape search and preview. | On-demand; worker defaults are non-mutating. |
| `struct_infer` | Pointer-register layout inference. | On-demand when offsets need grounding. |
| `item_state_table` | Item state table conversion preview. | On-demand for asm data labels. |

## Agent Entry Points

First-class agent tools live under `apps/server/src/core/tools`.
`runtime/` contains tool construction, command execution helpers, result
formatting, and telemetry. `profiles/` contains role-level tool bundles.
`wrappers/knowledge/` adapts project knowledge sources such as code graph,
past PRs, path facts, standards, and external reference sources into Pi tools.
`wrappers/capabilities/` adapts callable decomp capabilities backed by the
enabled toolpack into specific affordances such as `ghidra_lookup`,
`checkdiff_run`, and `source_permuter_run`.

## Maintenance

`bun run kg:sources` lists active knowledge sources and registered tools.
`bun run kg:smoke -- --project melee --strict` checks graph source readiness and
tool readiness. The strict smoke also requires local indexed source data and
live runner artifacts, so a resolver-valid setup can still fail strict smoke
when generated project data is stale or absent.

Operator refresh commands use the toolpack paths:

- `python3 toolpacks/gamecube-decomp/build_tool_indexes.py --repo-root <repo_root>`
- `python3 toolpacks/gamecube-decomp/research/ghidra/runners/run_headless_probe.py --repo-root <repo_root>`
- `python3 toolpacks/gamecube-decomp/research/opseq/runners/extract_opcode_sequences.py --repo-root <repo_root>`
- `python3 toolpacks/gamecube-decomp/research/mismatch_db/runners/analyze_objdiff_mismatches.py --repo-root <repo_root>`
- `python3 toolpacks/gamecube-decomp/compiler/mwcc_debug/runners/probe_mwcc_compiler.py --repo-root <repo_root>`

Workers usually call resolver-backed Pi tools or suite APIs, not runners.
Runners and generated data are operator maintenance surfaces.
