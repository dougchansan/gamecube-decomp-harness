# UI Smoke Report

Date: 2026-06-16

## Coverage

| Check | Result | Evidence |
| --- | --- | --- |
| Existing UI server reachable | Pass | `GET http://localhost:8787/api/config` returned `200` |
| SPA Project Home URL | Pass | `GET /?page=project` returned `200`, 402 bytes |
| SPA Project Access URL | Pass | `GET /?page=access` returned `200`, 402 bytes |
| SPA Active Session URL | Pass | `GET /?page=session` returned `200`, 402 bytes |
| SPA Run Mode URL | Pass | `GET /?page=run` returned `200`, 402 bytes |
| SPA PR Mode URL | Pass | `GET /?page=pr` returned `200`, 402 bytes |
| SPA Session History URL | Pass | `GET /?page=history` returned `200`, 402 bytes |
| Rebuilt bundle served | Pass | `/assets/index-C2j06MMc.js` returned `200`, 299087 bytes |
| Current Melee mode evidence | Pass | API payload derives PR Mode: process stopped, 0 leases, handoff evidence present, 5 PR records |
| Desktop PR Mode render | Pass | `screenshots/pr-mode.png` captured with headless Chrome |
| Desktop Run Mode render | Pass | `screenshots/run-mode.png` captured with headless Chrome |
| Mobile PR Mode render | Pass | `screenshots/pr-mode-mobile.png` captured with headless Chrome |
| In-app Browser smoke | Skipped | In-app Browser reported `Browser is not available: iab`; headless Chrome was used instead |

## Current Melee PR-Mode Evidence

```json
{
  "project": "melee",
  "runStatus": "active",
  "processRunning": false,
  "activeLeases": 0,
  "hasHandoffEvidence": true,
  "prRecords": 5,
  "shipStatus": "pr_ready",
  "derivedMode": "pr"
}
```

The run row is still marked `active`, but the checkout is not actively running
workers and the dashboard has handoff/PR evidence. The UI mode rule therefore
lands on PR Mode because active workers or leases are absent and PR evidence is
present.

## Pages

- Project Home: active session summary, mode verdict, session gate, refresh,
  sync, and new-session entry point.
- Project Access: project selection, path health, knowledge sources,
  validation defaults, and PR defaults.
- Active Session: mode evidence, run/process status, and run/PR artifacts.
- Run Mode: run controls, run setup, process card, progress timeline, and work
  tables.
- PR Mode: checkpoint/QA/QA-repair/ship/split status, blocker list, PR flow
  actions, draft PR board, and handoff artifact links.
- Session History: latest save point, PR intake summary, unresolved PR count,
  and epoch checkpoints.

## Residual Risk

Screenshots were captured through the installed Google Chrome binary because
the in-app browser surface was unavailable. The desktop PR Mode screenshot
shows PR Mode as the active work surface with PR rows and handoff controls.
The desktop Run Mode screenshot shows run controls gated by PR Mode while run
telemetry remains inspectable. The mobile PR Mode screenshot stacks the
navigation and PR surface without an obvious blank page or primary-control
overlap.
