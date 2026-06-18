# Action Reachability Matrix

Every existing operator action keeps a home in the focused page model.

| Action | Current source | New page | Endpoint | Enabled when | Disabled reason source |
| --- | --- | --- | --- | --- | --- |
| Refresh | `App.runAction` | Project Home / all pages | dashboard stream refresh | Always when not busy | Busy/action state |
| Sync Merged PRs | `SyncStage` | Project Home, PR Mode, Session History | `POST /api/project/sync` | No active run/process/leases/operation and sync lock is clear | Phase sync lock, process state, active leases, operation |
| Start / Start Work | `RunStage` | Run Mode | `POST /api/run/init`, `POST /api/pr/resume`, `POST /api/process/start` | No process/sync/operation, and active-session PR gate allows workers | Process state, operation state, PR/session gate |
| Pause Intake | `RunStage`, `ShipStage` | Run Mode and PR Mode gate | `POST /api/pr/pause` | Process running and not already draining | Process view, run status |
| Force Stop / Kill | `RunStage` | Run Mode | `POST /api/process/stop` | Process running | Process view |
| Fresh Run / New Session | `SessionStage` | Project Home / Session History | `POST /api/run/fresh` | No process/sync/operation/leases and PR work resolved | New-session gate |
| Checkpoint | `ShipStage` manual detail | PR Mode | `POST /api/run/checkpoint` | Handoff idle | Handoff idle reason |
| Run QA | `ShipStage` manual detail | PR Mode | `POST /api/pr/qa` | Handoff idle | Handoff idle reason |
| Reconcile | `ShipStage` manual detail | PR Mode | `POST /api/pr/reconcile` | Handoff idle and run paused | Handoff idle reason, run status |
| Plan PRs | `ShipStage` manual detail | PR Mode | `POST /api/pr/split-plan` | Handoff idle | Handoff idle reason |
| Prepare Handoff | `ShipStage` | PR Mode | `POST /api/pr/prepare` | Handoff idle and run active/paused | Handoff idle reason, run status |
| Sync PR Status | `PrsStage` | PR Mode / Session History | `POST /api/prs/sync` | Not busy | Busy/action state, GitHub warning in result |
| Open Draft PR | `PrRecordRow` | PR Mode | `POST /api/prs/open` | Planned record has branch and checkout is idle | PR operation lock reason |
| Open All Drafts | `PrsStage` | PR Mode | `POST /api/prs/open-all` | Planned records exist and checkout is idle | PR operation lock reason |
| Load Run Details | `DetailsRail` | Run Mode / Active Session details | `GET /api/run/details` | Run id exists and not already loading | Run id/loading state |

## Focused Page Placement

- Run Mode owns worker/process controls and live run telemetry.
- PR Mode owns handoff, QA, split, draft opening, PR sync, and review status.
- Project Home owns high-level sync/new-session recommendation and active
  session gate.
- Project Access owns project selection, path overrides, warnings, and
  standards/knowledge/tools inventory.
- Session History owns past save points, epochs, PR records, and artifact
  links.

## Migration Rule

Do not remove an old sidebar control until its row above has a reachable page
location and its disabled reason is still visible through the derived session
view model.
