---
covers: Dashboard server, React UI, process controls, and PR handoff controls
concepts: [ui, dashboard, process-controls, pr-handoff, checkpoint, regression-check, pr-split-plan]
code-ref: decomp-orchestrator/apps/dashboard, decomp-orchestrator/apps/dashboard-server/src
---

# UI: Overview

The UI is the operator dashboard for live runs. It combines a Bun HTTP server
with a React app so an operator can inspect progress, manage the long-running
process, checkpoint runs, and prepare PR handoff artifacts without switching to
the shell.

## File Tree

```text
apps/
+-- dashboard/
|   +-- index.html
|   +-- src/
|   |   +-- components/
|   |   +-- hooks/
|   |   +-- lib/
|   |   +-- main.tsx
|   |   +-- styles.css
|   +-- vite.config.ts
+-- dashboard-server/
    +-- src/
        +-- server.ts
        +-- trusted-report.ts
```

## Server

`apps/dashboard-server/src/server.ts` serves built static assets from
`apps/dashboard/dist/` and exposes JSON endpoints under `/api/`.
`ORCH_UI_PORT` selects the port, defaulting to `8787`. The module exports a
fetch handler for non-listening validation and starts Bun only when run as the
server entrypoint.

The server keeps a small in-process process record for the managed babysit
process and also reads saved process files from
`state_dir/ui-processes/*.json`. This lets the dashboard reconnect to a saved
process record even after a browser refresh or UI server restart. Saved process
records include the selected project summary, repo root, state directory, graph
database path, and command array.

All dashboard routes resolve paths through the project resolver. `/api/config`
returns available projects, the default project id, selected project summary,
project defaults, and default repo/state/graph paths. Request query strings and
POST bodies send `projectId` by default; raw repo/state/graph paths are applied
only when `usePathOverrides` is true.

Dashboard data comes from the resolved project context. It combines:

- SQLite run, queue, lease, event, report, checkpoint, and handoff state.
- Current board/report measures from the selected project checkout.
- Trusted `report_changes.json` data when the report is fresh for the run.
- Recent worker reports, touched files, active files, queue rows, and process
  logs.

The dashboard stream endpoint sends server-sent events at
`ORCH_UI_DASHBOARD_INTERVAL_MS` cadence. It emits the full dashboard payload
when stable state changes and compact tick payloads for elapsed-time updates.

## Layout

`apps/dashboard/src/components/SessionWorkspace.tsx` is the main project and
session shell. It derives a client-side session view model from the existing
dashboard payload rather than requiring a durable session-store migration. The
view model maps selected project, run status, process state, handoff artifacts,
PR records, campaign/save-point data, epochs, and run details into one active
session with a mode verdict: `Run Mode`, `PR Mode`, or `No Active Session`.

The React app has three regions:

- Left project/session navigation rail: selected project, active session label,
  current mode verdict, and page buttons for Project Home, Project Access,
  Active Session, Run Mode, PR Mode, and Session History. The rail is the
  navigation and orientation surface; it does not show every operator control
  at once.
- Center focused page: the selected page owns the primary work surface. Project
  Home shows the active-session gate and recommended next page. Project Access
  shows project paths, config health, knowledge sources, validation defaults,
  and PR defaults. Active Session shows mode evidence and key artifacts. Run
  Mode shows run controls, run setup, process state, progress, epochs,
  workers, queues, leases, and reports. PR Mode shows handoff status, QA and
  repair rounds, ship-set/split-plan artifacts, PR rows, draft-opening
  controls, and review/blocker status. Session History shows save points,
  epochs, PR intake, and carry-forward state from available artifacts.
- Right details rail: `Run`, `Agents`, and `Logs` tabs remain available for
  deep inspection. The Logs tab opens with an operation activity card: the
  server tracks the one long-running dashboard operation (sync, prepare
  handoff, checkpoint, QA, plan PRs, reconcile, fresh run) as named steps with
  per-step status and elapsed time, exposed as `process.operation` in the
  dashboard payload. Triggering any long-running operation auto-opens the
  details rail on the Logs tab.

Both side rails are collapsible. The navigation rail persists its collapsed
state in `localStorage` as `sidebarCollapsed`; the details rail persists
`detailsCollapsed` and `detailsWidth`.

## Session Phase Stepper

`apps/dashboard/src/components/PhaseStepper.tsx` derives the operating phase of
the session cycle from durable dashboard state — run status, active lease
count, process liveness, sync activity, and handoff artifacts — and renders a
six-step stepper (Sync & Intake → Baseline & Init → Run → Checkpoint & Validate
→ Ship PRs → Resync) at the top of the left rail. No new state is stored; the
phase is recomputed from each dashboard payload.

The focused page shell uses `SessionWorkspace` for the primary mode verdict,
but the phase derivation remains the source for the sync lock. While the run is
`active`,
`Intake Merged PRs` is disabled with the lock reason as its tooltip, and the
server independently rejects `POST /api/project/sync` so the lock is hard, not
UI-only. The full design rationale lives in
[../../sidebar-flow-design.html](../../sidebar-flow-design.html).

## Campaign Strip And Save Points

The center column opens with a where-we-are strip driven by the dashboard's
`campaign` block: latest save point (commit, trigger, matched percent, age),
current head (sha, branch, dirty), and the count of commits not yet merged into
the base ref. When the checkout has moved past the save point the strip shows a
staleness banner instead of silently presenting old numbers. The `Save Point`
button posts to `POST /api/save-point`; the server also records automatic save
points after init, pause, checkpoint, QA, sync, and fresh-run boundary actions.

## Epoch Checkpoints

The dashboard payload carries an `epochs` array: save points with trigger kind
`epoch`, oldest first, each with matched-code percent, measures, regression
counts, and repair results. The Progress panel renders them as an "Epoch
checkpoints" table — per-epoch matched percent, delta against the previous
epoch, and regression/repair status — with the total delta since the first
epoch in the header. The run's starting position stays anchored to the
existing `initial` measures, so the start never moves while the current
position advances one epoch at a time.

## Process Controls

The Run section manages the long-running decomp process:

| UI Action | Endpoint | Behavior |
| --- | --- | --- |
| `Start` | `POST /api/process/start` | Starts the managed babysit process for an active run. The command includes `--project <id>` plus resolved repo/state/graph paths. The server refuses to start workers for a paused, complete, or failed run. |
| `Stop` | `POST /api/process/drain` | Requests a soft drain: child workers receive `SIGTERM`, and the supervisor is stopped so no new workers are introduced. |
| `Force Stop` | `POST /api/process/stop` | Stops the process group and runs `recover-leases --force` by default. |
| `Report Now` | `POST /api/report/run` | Runs the trusted report refresh flow through `forceReportRun`. |
| `Fresh Run` | `POST /api/run/fresh` | Optionally checkpoints the current run, resets the report baseline, initializes a new run, and refreshes PR knowledge. |

Run Setup exposes scheduling as a size preset plus epoch controls. The dashboard
server derives `--max-workers`, `--queue-target-size`, `--queue-low-watermark`,
`--candidate-limit`, `--candidate-window`, `--epoch-size`,
`--epoch-ready-queue-size`, fast refresh cadence, and boundary maintenance mode
from form state and project defaults. The managed process name remains the
project process name, which is `melee-live` for the Melee dashboard run.

| Preset | Workers | Default epoch | Ready queue |
| --- | ---: | ---: | ---: |
| Small | 4 | 16 | 16 |
| Medium | 8 | 32 | 32 |
| Large | 16 | 64 | 64 |
| XL | 32 | 128 | 128 |

The active scheduler epoch is a fixed admitted target set. The ready queue is
the subset of admitted targets that workers can lease immediately. Operators can
choose preset epoch sizes (`32`, `64`, `128`, `256`, `512`, or `full`), tune the
ready queue independently, enable or disable fast run-evidence refresh, set the
fast interval/report-count triggers, and choose boundary maintenance mode
(`full`, `no-tool-runners`, or `skip`). Dashboard status surfaces active epoch
admitted, queued, leased, completed, and remaining counts from durable state.

Fresh Run (the `New Session` dock action) always checkpoints the current run
first, preserving PR candidates and carry-forward work before the next
baseline/session is created. There is no longer a UI toggle for skipping that
checkpoint; pass `checkpointBeforeFresh: false` to the endpoint directly for
the rare intentional-discard case.

## PR Handoff Controls

The PR Handoff section is the UI-facing sequence for pausing new work, keeping
the current run durable, running final QA, and producing reviewer-sized PR plan
artifacts.

| UI Action | Endpoint | Behavior |
| --- | --- | --- |
| `Pause Intake` | `POST /api/pr/pause` | Drains the managed process and marks the run `paused`. Worker and trigger commands reject non-active runs, so no new worker edits can be introduced until the run is resumed. |
| `Resume` | `POST /api/pr/resume` | Marks the run `active` again so scheduling can continue. |
| `Checkpoint` | `POST /api/run/checkpoint` | Calls `createRunCheckpoint` for the current run and writes `checkpoint.json`, `pr_candidates.md` (match and improvement lanes), and `carry_forward.md`. |
| `Run QA` | `POST /api/pr/qa` | Runs `regression-check --require-pr-promotion` by default (plus the project's improvement byte floor as `--promotion-min-unmatched-improvement-bytes`) and returns the generated summary/report artifact paths even when the gate fails. |
| `Reconcile` | `POST /api/pr/reconcile` | Runs the reconcile agent in `ship-validate` mode against the latest QA summary to fix regressions before handoff. Rejected while the run is `active`. |
| `Plan PRs` | `POST /api/pr/split-plan` | Runs `pr-split-plan` with the latest checkpoint for lane splitting, the project's PR split strategy, and writes a Markdown plan plus `summary.json` under the handoff artifact directory. |
| `Prepare` | `POST /api/pr/prepare` | Runs the full ship pipeline: pause → pull upstream & rebase → rebuild production baseline (worktree at the base SHA, cached per SHA) → QA vs the new baseline → checkpoint (regressed symbols forced to `needs_rework`) → lane-aware split plan. Stops with the QA hint as the error if the gate fails; the checkpoint still lands. |

Checkpoint, QA, split planning, and Prepare refuse to run while a worker
process is alive (server-side `assertHandoffIdle`); the dashboard disables the
matching buttons until workers are stopped and all leases are released. Pause
and Resume stay available because pausing is how the operator stops intake.

QA and split-plan inputs (QA target, base ref, group mode, max files per PR,
branch/title prefixes, improvement promotion floors) are not editable in the
UI: they come from `projects/<id>/project.json`, with `local.project.json` as
the per-machine override.

Latest handoff artifacts are summarized in the dashboard under
`dashboard.handoff`:

- `checkpoint`: latest `run_checkpoints` row plus disposition counts.
- `qa`: latest `state_dir/regression_checks/<run_id>/<timestamp>/summary.json`.
- `splitPlan`: latest
  `state_dir/pr_handoff/<run_id>/split_plans/<timestamp>/summary.json`.

PR mode also reads `dashboard.prs`, a compatibility PR ledger from
`state_dir/pr_handoff/pr_records.json`. The server normalizes legacy rows with
session/run provenance plus additive `local`, `validation`, `batch`, and
`github` subobjects. `POST /api/prs/sync` seeds the ledger from the current
split plan, imports existing GitHub PRs whose heads match the local split-series
branches, and discovers local `codex/split-##-*` branches/worktrees so local
PRs appear before publication. Planned rows can be prepared locally before
publication: `POST /api/prs/prepare-local` prepares one slice in a persistent
worktree under `state_dir/pr_workspaces/<run_id>/`, while locally discovered
worktrees are tracked in place, and
`POST /api/prs/prepare-local-batch` prepares the next three unprepared slices.
`POST /api/prs/open-batch` opens the next three local-ready slices as GitHub
drafts by generating a patch from each persistent worktree's committed diff,
re-verifying it, and pushing the local branch. `POST /api/prs/open-all` remains
as the legacy all-planned path.

## Artifact Locations

| Artifact | Location |
| --- | --- |
| Checkpoint summary | `state_dir/runs/<run_id>/checkpoints/<timestamp>/checkpoint.json` |
| PR candidates | `state_dir/runs/<run_id>/checkpoints/<timestamp>/pr_candidates.md` |
| Carry-forward ledger | `state_dir/runs/<run_id>/checkpoints/<timestamp>/carry_forward.md` |
| QA summary | `state_dir/regression_checks/<run_id>/<timestamp>/summary.json` |
| QA PR report | `state_dir/regression_checks/<run_id>/<timestamp>/pr_report.md` |
| Split plan summary | `state_dir/pr_handoff/<run_id>/split_plans/<timestamp>/summary.json` |
| Split plan Markdown | `state_dir/pr_handoff/<run_id>/split_plans/<timestamp>/pr_split_plan.md` |
| PR ledger | `state_dir/pr_handoff/pr_records.json` |
| Local PR worktrees | `state_dir/pr_workspaces/<run_id>/<branch-slug>/` |
| Local PR publish patches | `state_dir/pr_handoff/local_patches/<branch-slug>.patch` |

## Related

- [CLI overview](../cli/00-overview.md)
- [State implementation](../state/00-overview.md)
- [Score integration and PR handoff](../../10-system-design/60-score-and-pr-handoff.md)
