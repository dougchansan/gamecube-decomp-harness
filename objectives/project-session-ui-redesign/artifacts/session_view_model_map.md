# Session View Model Map

This maps the current dashboard payload into the project/session architecture
without requiring a durable session-store migration in the first UI pass.

## Source Payloads

| Concept | Source |
| --- | --- |
| Project identity | `dashboard.project`, `/api/config.selectedProject`, `form.projectId` |
| Project access health | `dashboard.projectWarnings`, `ProjectSummary.*Exists`, `config.projectDefaults` |
| Active run/session anchor | `dashboard.status.run.id`, `dashboard.status.run.createdAt`, `dashboard.campaign.savePoint` |
| Run mode state | `dashboard.status.run.status`, `dashboard.process`, `dashboard.status.activeLeases`, `dashboard.status.schedulerEpoch` |
| Run progress | `dashboard.initial`, `dashboard.current`, `dashboard.trustedReport`, `dashboard.productionReport`, `dashboard.epochs`, `dashboard.checkpointProgress` |
| Run work | `dashboard.improvements`, `dashboard.improvedFiles`, `dashboard.activeFiles`, `dashboard.queueTargets`, `dashboard.reports`, `dashboard.progressReports`, `dashboard.touchedFiles`, `dashboard.events` |
| PR mode state | `dashboard.handoff`, `dashboard.prs`, `dashboard.checkpoint`, `dashboard.campaign`, `dashboard.process.operation` |
| Session history | `dashboard.campaign.savePoint`, `dashboard.epochs`, `dashboard.prs.records`, run details timeline when loaded |

## Derived `SessionViewModel`

```ts
type SessionMode = "run" | "pr" | "none";

interface SessionViewModel {
  project: ProjectSummary | null;
  activeSession: {
    id: string;
    label: string;
    mode: SessionMode;
    modeLabel: string;
    modeEvidence: string[];
    blockedReasons: string[];
    recommendedPage: DashboardPage;
  };
  run: {
    hasRun: boolean;
    status: string;
    running: boolean;
    activeLeases: number;
    epochSummary: string;
    canStartWorkers: boolean;
    startBlockedReason: string;
  };
  pr: {
    hasHandoffEvidence: boolean;
    hasPrRecords: boolean;
    records: PrRecord[];
    qaStatus: string;
    shipStatus: string;
    splitPlanStatus: string;
    blockedReasons: string[];
  };
  newSession: {
    blocked: boolean;
    reasons: string[];
  };
}
```

The concrete implementation can keep this as client-side helpers instead of a
public `ui-contract` type until multiple components or endpoints need to share
the same shape.

## Mode Selection

Mode selection is evidence-driven:

1. `none`: no selected project and no run/save-point anchor.
2. `run`: a managed process is running/draining, active leases exist, or the
   latest visible work is scheduler/worker work.
3. `pr`: the run is paused/stopped/not active and any PR-mode evidence exists:
   handoff checkpoint, QA summary, QA repair summary, split plan, ship status,
   PR records, or a currently running handoff/PR operation.
4. `pr` with explicit planned/mock evidence: allowed when real PR records are
   absent but the current session is known to be PR-bound and rows are visibly
   labeled planned/mock.
5. Tie-breaker: active workers and active leases win over PR evidence because
   the checkout can still be changing. Otherwise PR evidence wins over stale
   run-status telemetry, including a run row that remains `active` after the
   process has stopped.

Current Melee target state:

- `objectives/current-pr-qa-repair-campaign/current_state.md` says the live QA
  repair campaign is complete as routed-blocked, not PR-ready.
- It records routed ship-status and split-plan artifacts, plus next actions to
  isolate the intended ship set before rerunning PR promotion.
- Therefore the dashboard should land on PR Mode when corresponding
  `dashboard.handoff`/`dashboard.prs` evidence exists, or on a clearly labeled
  planned/mock PR-flow fixture if the persisted PR records have not been
  seeded yet.

## Active Session Identity

Until durable session records exist, the active session id is derived:

| Field | Derivation |
| --- | --- |
| `activeSession.id` | `dashboard.status.run.id`, else `dashboard.campaign.savePoint.commit_sha`, else `project.id + ":no-run"` |
| `activeSession.label` | `Run <short id>` when a run exists; otherwise latest save-point trigger/commit |
| `baseline` | `dashboard.handoff.baseline`, `dashboard.campaign.baseSha`, and `dashboard.initial` |
| `session branch` | `dashboard.campaign.head.branch` |

This is intentionally a projection. Durable session records can later replace
the derivation behind the same UI model.

## PR Flow Summary

PR Mode summarizes:

| Field | Source |
| --- | --- |
| Checkpoint | `dashboard.handoff.checkpoint` or `dashboard.checkpoint` |
| QA | `dashboard.handoff.qa` |
| QA repair | `dashboard.handoff.qaRepair` |
| Ship set | `dashboard.handoff.ship` |
| Split plan | `dashboard.handoff.splitPlan` |
| PR records | `dashboard.prs.records` |
| Upstream open count | `dashboard.prs.upstreamOpen` |
| GitHub warning | `dashboard.prs.warning` |
| Current operation | `dashboard.process.operation` |

When `dashboard.prs.records` is empty but `handoff.splitPlan.slices` contains
match slices, the UI may render planned rows derived from the split plan. When
both are empty and the current session is known PR-bound only from objective
state, rows must be labeled planned/mock and must not pretend to be real draft
or open PRs.

## New Session Gate

Starting a new autonomous run is blocked when any of these are true:

- Managed process is running/draining.
- Active leases are present.
- Run status is `active`.
- PR records contain `planned`, `branch_pushed`, `draft`, `open`, or
  `changes_requested`.
- `dashboard.handoff.ship.status` or QA repair state indicates PR/handoff work
  is blocked or pending.
- `dashboard.prs` shows merged records that have not been intaken/synced into
  the project baseline.
- The campaign head is dirty or ahead of the save point and has not been
  measured against the next baseline.

If evidence is ambiguous, the UI should show "session gate unclear" and keep
unsafe run-start controls disabled.

## Page Mapping

| Page | Primary data |
| --- | --- |
| Project Home | Project summary, active session verdict, baseline/branch, recommended action |
| Project Access | Project paths, warnings, defaults, standards/knowledge/tools inventory |
| Active Session | Session timeline, mode verdict, save points, handoff/run artifact links |
| Run Mode | Run setup, process controls, progress, epochs, workers, queue, leases, reports, logs |
| PR Mode | Handoff gate, QA/repair status, ship set, split plan, PR board, open/sync controls |
| Session History | Save points, epochs, PR records, carry-forward and artifact links |

## Data Gaps

- Real durable session identity does not exist yet; use a derived active
  session id.
- PR records may be empty until `Sync PR Status` seeds from the latest split
  plan. Planned/mock rows must be labeled honestly.
- Session history is save-point/epoch based until a session ledger is added.
