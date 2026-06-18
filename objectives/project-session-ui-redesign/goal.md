<goal>
    - Map the current run-oriented dashboard into the project/session model:
      project -> one active session -> Run Mode or PR Mode.
    - Build a focused multi-page UI so the main screen no longer shows every
      run, handoff, PR, process, project, and log surface at once.
    - Current Melee state should land in PR Mode when dashboard evidence or an
      explicit planned/mock fixture shows the run is stopped and PR split/QA/
      draft/human-review work is active.
</goal>

<context_refresh>
    - Reread this objective bundle:
      `objectives/project-session-ui-redesign/{goal.md,current_state.md,context/*.md}`.
    - Reread the design/UI anchors:
      `docs/10-system-design/75-project-session-architecture.md`,
      `docs/10-system-design/65-operator-flow-and-pr-tracking.md`, and
      `docs/20-implementation/ui/00-overview.md`.
    - Reread current PR state:
      `objectives/current-pr-qa-repair-campaign/current_state.md`.
    - Inspect current UI/contract surfaces before editing:
      `apps/dashboard/src/components/App.tsx`,
      `apps/dashboard/src/components/Sidebar.tsx`,
      `apps/dashboard/src/components/DetailsRail.tsx`,
      `packages/ui-contract/src/dashboard.ts`, and
      `apps/dashboard-server/src/server.ts`.
</context_refresh>

<working_strategy>
    - First document a session view-model mapping from existing dashboard data:
      project, run status, process, handoff, PRs, campaign, epochs, and run
      details.
    - Add server/contract fields only when the derived model would otherwise
      be brittle or duplicated.
    - Implement page navigation and focused views: Project Home, Project
      Access, Active Session, Run Mode, PR Mode, and Session History.
    - Preserve all existing actions, endpoints, disabled reasons, run details,
      logs, and PR handoff controls while moving them to mode-appropriate
      pages.
</working_strategy>

<success_metrics>
    - Selected project shows one active session with a clear mode verdict.
    - Run Mode preserves progress, epochs, workers, queue, leases, reports,
      logs, and start/pause/stop controls.
    - PR Mode shows ship set, split plan, QA/fix rounds, draft PR rows,
      blockers, open/sync controls, and human-review loop status.
    - Project pages expose standards, knowledge, tools, config health, and
      session history without competing with live run or PR work.
    - Validation covers typecheck/build and smoke checks for Run Mode and PR
      Mode, including the current PR-flow default state.
</success_metrics>

<non_goals>
    - Do not redesign scheduler, worker, PR split, QA repair, score, or
      knowledge semantics except for UI/state projection.
    - Do not start `bun run ui:server`, `bun run ui`, or a UI dev server unless
      explicitly asked.
    - Do not add controls that let the Melee process name drift from
      `melee-live`.
    - Do not require a full durable session-store migration before the UI can
      represent the current flow.
    - Do not revert unrelated dirty worktree changes.
</non_goals>

<completion_criteria>
    - `artifacts/session_view_model_map.md` maps current dashboard fields into
      project/session/run-mode/PR-mode/new-session-gate concepts.
    - Focused dashboard pages are implemented, and current Melee PR-flow state
      lands on PR Mode from evidence or a clearly labeled planned/mock fixture.
    - Existing actions remain reachable with correct endpoint wiring and
      disabled-state explanations.
    - Validation in `context/04_validation_and_handoff.md` passes, or exact
      blockers and smallest next steps are recorded.
    - `current_state.md` records completed phases, commands, artifacts, risks,
      and handoff instructions.
</completion_criteria>
