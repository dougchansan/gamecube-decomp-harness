---
covers: Project-centered dashboard redesign plan for moving run and PR controls into a single active-session workflow
concepts: [ui-redesign, project-dashboard, project-workspace, knowledge-base, sessions, active-session, run-mode, pr-mode]
depends-on: docs/10-system-design/75-project-session-architecture.md, docs/20-implementation/ui/00-overview.md
---

# Design Plan: Project Workspace UI Redesign

**Date:** 2026-06-17

## Goal

Restructure the orchestrator UI around the way the work actually flows:

```text
Project Dashboard
  -> Project Workspace
       -> Project Overview
       -> Knowledge Base
       -> Sessions
            -> Active Session
                 -> Prepare
                 -> Run
                 -> PR
                 -> Review / Close
```

The current UI exposes Project, Access, Session, Run Mode, PR Mode, and History
as peer-level tabs. That made sense while the dashboard was mostly a single live
Melee run monitor, but the target UX is project-centered. An operator should
first feel "I am in this project," then see the project state, knowledge,
configuration, and session history from there.

Run Mode and PR Mode should stop being top-level places. They are phases inside
one active session.

## Mental Model

The redesign should feel nested even if the first implementation still uses one
React app and one dashboard data payload.

```text
Orchestrator
+-- Project Dashboard
|   +-- project cards
|   +-- active project summaries
|   +-- global settings later
|
+-- Project Workspace
    +-- Overview
    |   +-- active session state
    |   +-- PR gate summary
    |   +-- recommended next action
    |   +-- project readiness
    |
    +-- Knowledge Base
    |   +-- editable standards
    |   +-- prompt/context previews
    |   +-- knowledge graph views
    |   +-- tool/source references
    |
    +-- Sessions
    |   +-- one active session
    |   +-- past sessions
    |   +-- run artifacts
    |   +-- PR handoff artifacts
    |
    +-- Settings
        +-- paths
        +-- local overrides
        +-- validation defaults
        +-- project-level configuration
```

This preserves the future multi-project shape while keeping today's reality
simple: there may be only one project card, Melee, but it should still live in
the same UX structure that can later hold more projects.

## Design Rules

- The left navigation should describe where the operator is, not what mode the
  machine is in.
- A project is the stable object the operator opens.
- A session is the operational unit of work under a project.
- A project can have many past sessions, but only one active session.
- Run and PR are phases inside the active session, not sibling pages beside the
  project.
- Project selection, paths, sync readiness, access, and local configuration
  belong at the project level.
- Standards and durable project knowledge belong in a visible Knowledge Base,
  not inside a generic Access tab.
- Session history should live near the active session, because both answer
  "what work happened against this project?"

## Current Navigation Problem

The current navigation has six visible peer sections:

```text
Project
Access
Session
Run Mode
PR Mode
History
```

That hierarchy implies these are equivalent destinations. They are not.

Access is project configuration. Run Mode and PR Mode are session phases.
History is session history. The UI should make those ownership boundaries
visible.

## Target Navigation

At the project workspace level:

```text
Project
Knowledge
Sessions
Settings
```

Inside a session:

```text
Summary
Prepare
Run
PR Queue
Review
Artifacts
```

The active session may still show a phase stepper:

```text
Prepare -> Run -> PR -> Review -> Close
                      ^ current
```

The phase stepper is status and workflow orientation. It is not the top-level
app navigation.

## Mockup: Project Dashboard

The dashboard is the future place where multiple projects can appear. Today it
would show one Melee project card.

```text
+------------------------------------------------------------------------------+
| DECOMP ORCHESTRATOR                                             Settings     |
+------------------------------------------------------------------------------+
| Projects                                                                     |
|                                                                              |
| +--------------------------------------------------------------------------+ |
| | Super Smash Bros. Melee                                                   | |
| | Active session: Run 6a0281a8, PR Mode                                      | |
| | Branch: codex/split-05-gr-stage-pass-b                                    | |
| | Gate: 9 PR slices unresolved, 4 workspaces unresolved                      | |
| |                                                                          | |
| | [Open Project]                                                            | |
| +--------------------------------------------------------------------------+ |
|                                                                              |
| +--------------------------------------------------------------------------+ |
| | Add Project                                                               | |
| +--------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------+
```

Purpose:

- Make project selection a real first-class layer.
- Keep the single current Melee project compatible with a future multi-project
  dashboard.
- Summarize enough active-session state that the operator knows whether opening
  the project will land them in run work, PR work, or setup.

## Mockup: Project Workspace Overview

The project overview is the default page after opening a project.

```text
+------------------------------------------------------------------------------+
| < Projects   Super Smash Bros. Melee                         Refresh  Sync   |
+---------------+--------------------------------------------------------------+
| PROJECT       | Overview                                                     |
|               |                                                              |
| > Overview    | Active Session                                               |
|   Knowledge   | +----------------------------------------------------------+ |
|   Sessions    | | Run 6a0281a8                         Current phase: PR   | |
|   Settings    | | Branch: codex/split-05-gr-stage-pass-b                    | |
|               | | Gate: run active, 9 PR slices, 4 workspaces               | |
|               | |                                                          | |
|               | | [Open Session] [Open PR Queue] [Drain / Stop]             | |
|               | +----------------------------------------------------------+ |
|               |                                                              |
|               | Project Readiness                                            |
|               | +----------------------+ +----------------------+            |
|               | | Repository            | | Standards             |            |
|               | | Synced / known branch | | Loaded / editable     |            |
|               | +----------------------+ +----------------------+            |
+---------------+--------------------------------------------------------------+
```

Purpose:

- Answer "what is the current state of this project?"
- Surface the active session and PR gate without forcing the operator into a
  mode-specific page first.
- Keep top-level project readiness visible: repository, paths, standards,
  knowledge, sync status, and configuration health.

## Mockup: Project Home As Command Center

This is a more compact variant of the overview surface. It keeps the same
ownership model but emphasizes immediate operator actions.

```text
+------------------------------------------------------------------------------+
| DECOMP ORCHESTRATOR                                      Refresh   Sync PRs   |
| Super Smash Bros. Melee                                                     |
+---------------+--------------------------------------------------------------+
| PROJECTS      | PROJECT: Super Smash Bros. Melee                             |
|               |                                                              |
| > Melee       | Status: Active session running                                |
|   Add Project | Branch: codex/split-05-gr-stage-pass-b                       |
|               | Baseline: f59b5e08b5                                         |
| NAVIGATION    |                                                              |
|               | +----------------------+ +----------------------+             |
| > Project     | | Readiness             | | Repository Paths      |             |
|   Knowledge   | | Run active            | | melee checkout        |             |
|   Sessions    | | 9 PR slices open      | | artifacts             |             |
|               | | 4 workspaces open     | | standards path        |             |
|               | +----------------------+ +----------------------+             |
|               |                                                              |
|               | Recommended Next Step                                        |
|               | Resolve active PR-mode session before starting another run.   |
|               |                                                              |
|               | [Open Active Session]   [View PR Queue]   [Project Settings] |
+---------------+--------------------------------------------------------------+
```

Purpose:

- Treat the project page as a command center.
- Show identity, paths, sync state, readiness, and "what should I do next?"
- Keep actions short and contextual.

## Mockup: Knowledge Base

The knowledge base is where standards and durable project knowledge become
visible and editable.

```text
+------------------------------------------------------------------------------+
| < Projects   Super Smash Bros. Melee                                         |
+---------------+--------------------------------------------------------------+
| PROJECT       | Knowledge Base                                               |
|               |                                                              |
|   Overview    | [Standards] [Prompt Context] [Knowledge Graph] [Tools]       |
| > Knowledge   |                                                              |
|   Sessions    | Standard: PR Review Expectations                             |
|   Settings    |                                                              |
|               | +----------------------------+-----------------------------+ |
|               | | Edit                       | Effective Preview            | |
|               | |                            |                             | |
|               | | Use objdiff evidence...    | Use objdiff evidence...     | |
|               | | Keep PR slices small...    | Keep PR slices small...     | |
|               | |                            |                             | |
|               | +----------------------------+-----------------------------+ |
|               |                                                              |
|               | [Validate] [Revert] [Save]                                   |
+---------------+--------------------------------------------------------------+
```

Alternate editor-first shape:

```text
+------------------------------------------------------------------------------+
| KNOWLEDGE BASE: Super Smash Bros. Melee                         Save Changes |
+---------------+--------------------------------------------------------------+
| PROJECTS      | + Standards ------------------------------------------------+ |
| > Melee       | | [Decomp Style] [Review Rules] [PR Text] [Agent Notes]    | |
|               | +----------------------------------------------------------+ |
| NAVIGATION    |                                                              |
|   Project     | Standard: Decomp Style                                       |
| > Knowledge   | Last updated: 2026-06-17                                     |
|   Sessions    |                                                              |
|               | +----------------------------+-----------------------------+ |
|               | | Editable Standard           | Preview / Effective Context | |
|               | |                            |                             | |
|               | | Use objdiff evidence...    | Use objdiff evidence...     | |
|               | | Prefer small PR slices...   | Prefer small PR slices...   | |
|               | | Avoid broad refactors...    | Avoid broad refactors...    | |
|               | |                            |                             | |
|               | +----------------------------+-----------------------------+ |
|               |                                                              |
|               | [Revert] [Validate] [Save]                                   |
+---------------+--------------------------------------------------------------+
```

Purpose:

- Make standards inspectable and editable.
- Let the operator adjust wording without spelunking through files.
- Show effective rendered context, because standards eventually feed prompts.
- Leave room for knowledge graph and tool/source inventory without making those
  controls dominate the day-to-day session workflow.

## Mockup: Sessions Index

The sessions page owns both the current active session and previous sessions.

```text
+------------------------------------------------------------------------------+
| < Projects   Super Smash Bros. Melee                         New Session     |
+---------------+--------------------------------------------------------------+
| PROJECT       | Sessions                                                     |
|               |                                                              |
|   Overview    | Active Session                                               |
|   Knowledge   | +----------------------------------------------------------+ |
| > Sessions    | | Run 6a0281a8                                               | |
|   Settings    | | Phase: PR                                                  | |
|               | | Started: today                                             | |
|               | | Status: active                                             | |
|               | | [Open Session]                                             | |
|               | +----------------------------------------------------------+ |
|               |                                                              |
|               | Past Sessions                                                |
|               | +------------+------------+--------------+----------------+ |
|               | | Run        | Final state| Branch       | Outcome        | |
|               | | 91c0ab32   | Complete   | split-04     | PR drafted     | |
|               | | f204cd19   | Complete   | split-03     | Carried forward| |
|               | +------------+------------+--------------+----------------+ |
+---------------+--------------------------------------------------------------+
```

Earlier table-focused variant:

```text
+------------------------------------------------------------------------------+
| SESSIONS: Super Smash Bros. Melee                              New Session   |
+---------------+--------------------------------------------------------------+
| PROJECTS      | Active Session                                               |
| > Melee       | +----------------------------------------------------------+ |
|               | | Run 6a0281a8                                              | |
| NAVIGATION    | | State: PR Mode                                            | |
|   Project     | | Branch: codex/split-05-gr-stage-pass-b                    | |
|   Knowledge   | | Gate: 9 PR slices unresolved, 4 workspaces unresolved     | |
| > Sessions    | |                                                          | |
|               | | [Open Session] [Drain Run] [Stop]                         | |
|               | +----------------------------------------------------------+ |
|               |                                                              |
|               | Session History                                              |
|               | +------------+------------+------------+------------------+ |
|               | | Run        | State      | Branch     | Result           | |
|               | +------------+------------+------------+------------------+ |
|               | | 6a0281a8   | PR Mode    | split-05   | In progress      | |
|               | | 91c0ab32   | Complete   | split-04   | PR drafted       | |
|               | | f204cd19   | Complete   | split-03   | Merged / carried | |
|               | +------------+------------+------------+------------------+ |
+---------------+--------------------------------------------------------------+
```

Purpose:

- Separate "which session am I looking at?" from "what phase is that session
  in?"
- Make the single-active-session rule obvious.
- Put session history next to the active session instead of making History a
  peer of Run Mode and PR Mode.

## Mockup: Active Session

The active session page is where run and PR details live.

```text
+------------------------------------------------------------------------------+
| < Sessions   Run 6a0281a8                                      PR Mode       |
+---------------+--------------------------------------------------------------+
| SESSION       | Prepare -> Run -> PR -> Review -> Close                      |
|               |                    ^ current                                 |
| > Summary     |                                                              |
|   Run         | Session State                                                |
|   PR Queue    | +----------------------+ +----------------------+            |
|   Review      | | Run                   | | PR Work               |            |
|   Artifacts   | | active                | | 9 slices unresolved   |            |
|               | | workers / leases      | | 4 workspaces open     |            |
|               | +----------------------+ +----------------------+            |
|               |                                                              |
|               | Current Phase Surface                                        |
|               | +----------------------------------------------------------+ |
|               | | PR slices, blockers, QA rounds, draft status, review     | |
|               | | notes, and publish controls live here.                   | |
|               | +----------------------------------------------------------+ |
+---------------+--------------------------------------------------------------+
```

Earlier summary-card variant:

```text
+------------------------------------------------------------------------------+
| SESSION Run 6a0281a8                                      PR Mode   Refresh  |
+---------------+--------------------------------------------------------------+
| SESSIONS      | Timeline                                                     |
|               | [Prepare] -- [Run] -- [PR] -- [Review] -- [Close]            |
| > 6a0281a8    |                       ^ current                              |
|   91c0ab32    |                                                              |
|   f204cd19    | Session Summary                                              |
|               | +----------------------+ +----------------------+             |
| NAVIGATION    | | Run Configuration     | | PR Queue              |             |
|   Project     | | Workers: 8            | | 9 slices unresolved   |             |
|   Knowledge   | | Epochs: active        | | 4 workspaces open     |             |
| > Sessions    | | Lease status: live    | | Drafts pending        |             |
|               | +----------------------+ +----------------------+             |
|               |                                                              |
|               | Current Work Surface                                         |
|               | +----------------------------------------------------------+ |
|               | | PR slices, blockers, QA rounds, draft PRs, review notes  | |
|               | | live here because this session is currently in PR mode.  | |
|               | +----------------------------------------------------------+ |
+---------------+--------------------------------------------------------------+
```

Purpose:

- Keep run setup, process state, PR queue, QA rounds, drafts, blockers, and
  artifacts attached to the session that created them.
- Let the UI show phase-specific controls without pretending each phase is a
  global app section.
- Give the operator a stable place to return to throughout the session.

## Single Active Session Rule

A project should allow only one active session at a time.

"Active" includes:

- preparing a run,
- actively running workers,
- paused or drainable run state,
- PR handoff,
- local PR workspaces,
- draft PRs,
- review/fix loops,
- unresolved carry-forward state that still belongs to that baseline.

A new session should be blocked while the current active session has unresolved
work. The project overview should explain the blocker and provide the next
useful action.

Example gate:

```text
+----------------------------------------------------------+
| Session Gate                                             |
|                                                          |
| New session blocked                                      |
|                                                          |
| Current session Run 6a0281a8 is still in PR mode.         |
| 9 PR slices are unresolved.                              |
| 4 local PR workspaces are unresolved.                    |
|                                                          |
| [Open Active Session] [View PR Queue] [Refresh Status]   |
+----------------------------------------------------------+
```

## Proposed Page Ownership

| Surface | Owns | Does not own |
| --- | --- | --- |
| Project Dashboard | Project selection, project cards, global overview | Run controls, PR queues |
| Project Overview | Active session state, readiness, recommended next action | Detailed worker tables |
| Knowledge Base | Standards, prompt previews, graph/source views, tool inventory | Session execution controls |
| Sessions Index | Active session card, past sessions, session creation gate | Project path editing |
| Active Session | Run phase, PR phase, review phase, artifacts | Project selection |
| Settings | Paths, overrides, defaults, local configuration | Day-to-day PR triage |

## Migration Path

The redesign can land in steps without requiring a full backend rewrite first.

### Phase 1: Rename And Regroup Existing Views

- Replace peer-level tabs with project workspace navigation:
  `Overview`, `Knowledge`, `Sessions`, `Settings`.
- Move the current Access content under Settings, with standards linked toward
  Knowledge.
- Keep existing dashboard payloads and derived session view model.
- Keep the managed process name stable as `melee-live`.

### Phase 2: Build The Sessions Surface

- Make `Sessions` show the active session first and history second.
- Move Run Mode and PR Mode entry points under the active session.
- Keep old components internally if useful, but route them through session
  subnavigation.
- Make the active session phase visible as a chip and stepper.

### Phase 3: Build The Knowledge Base Surface

- Expose standards as editable records.
- Show rendered/effective prompt context previews beside the editor.
- Add knowledge graph and source/tool inventory tabs as secondary views.
- Keep Agent Viewer preview hydration aligned when prompt placeholders or
  injected context change.

### Phase 4: Add The Project Dashboard

- Add the dashboard route above the project workspace.
- Show Melee as the first project card.
- Preserve current default behavior by auto-opening Melee only if the operator
  arrives at the old project URL or if a compatibility flag requires it.
- Later, support adding and selecting additional project descriptors.

## Open Design Questions

- Should Settings be a permanent fourth project page, or should it be folded
  into Overview until there are enough controls to justify it?
- Should the active session subnav expose `Prepare`, `Run`, `PR Queue`,
  `Review`, and `Artifacts`, or should it stay summary-first with cards that
  open focused panels?
- Should the Knowledge Base edit standards directly in source files, or should
  it use structured records with a save/apply step?
- How much of the right details rail survives once the session page becomes the
  main operational surface?

## Success Criteria

- Opening the UI answers "which project am I in?" before "which mode is the
  process in?"
- The project overview clearly shows the current active-session phase and
  blockers.
- Operators can see and edit standards from a Knowledge Base page.
- Past sessions and the active session live together under Sessions.
- Run and PR controls are reachable from the active session, not from global
  peer navigation.
- The one-active-session rule is visible and hard to misunderstand.
- The design still works when there is only one project today and multiple
  projects later.
