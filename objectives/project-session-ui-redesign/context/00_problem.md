<problem>
    <objective_question>
        - How should the current dashboard be reshaped so the orchestrator is
          experienced as "project -> active session -> run mode or PR mode"
          instead of one large run page with every control visible at once?
    </objective_question>

    <current_baseline>
        - The dashboard already resolves a selected project, streams a large
          dashboard payload, shows a lifecycle sidebar, renders progress/work
          tables, exposes run/process controls, and includes PR handoff actions.
        - `docs/10-system-design/75-project-session-architecture.md` defines
          the target architecture: project-owned standards/knowledge/tools, one
          active session per project, run mode followed by PR mode, and a
          multi-page dashboard.
        - `docs/10-system-design/65-operator-flow-and-pr-tracking.md` defines
          the current canonical lifecycle and PR tracking direction.
        - `objectives/current-pr-qa-repair-campaign/current_state.md` records
          that the current Melee work is no longer a live autonomous run; the
          next useful surface is PR handoff/isolation after QA repair routing.
    </current_baseline>

    <why_current_state_is_insufficient>
        - The current UI can technically reach run, handoff, process, logs, PR,
          project, and status information, but it asks the operator to parse
          too much at once.
        - Run controls and PR handoff controls are adjacent enough that the
          conceptual boundary between "keep running workers" and "package this
          session for PR review" is not as strong as the architecture needs.
        - Project access/inventory information exists but is secondary to the
          live run dashboard, even though the target architecture starts from a
          project and asks what standards, knowledge, tools, and authority are
          available.
        - The active Melee session should presently read as PR Mode, but the
          current page still has a live-run center of gravity.
    </why_current_state_is_insufficient>

    <failure_modes>
        - `mode_blur`: The UI still presents Run Mode and PR Mode as a single
          mixed control surface, so operators can continue a run while PR work
          is unresolved.
        - `state_fiction`: The UI invents session status that is not grounded
          in existing run, handoff, PR, campaign, or process evidence.
        - `lost_controls`: Existing start/stop/pause/prepare/split/open/sync
          actions become unreachable or lose their disabled-state reasons.
        - `pr_flow_hidden`: Planned or mocked PR rows exist, but the UI buries
          them behind run telemetry rather than making PR Mode the active
          session surface.
        - `backend_big_bang`: Implementation blocks useful UI progress on a
          full durable session-store rewrite when a derived view model would be
          enough for the first migration.
    </failure_modes>

    <prior_evidence>
        - `docs/10-system-design/75-project-session-architecture.md`: Target
          tree and lifecycle sketch for project/session/run/PR mode.
        - `docs/10-system-design/65-operator-flow-and-pr-tracking.md`: Current
          pipeline rail, PR board, and action ownership design.
        - `docs/20-implementation/ui/00-overview.md`: Current UI architecture,
          dashboard payload, process controls, handoff controls, and artifact
          locations.
        - `objectives/project-workspace-layering/current_state.md`: Project
          descriptor/resolver work is complete, so this objective can build on
          selected-project identity.
        - `objectives/current-pr-qa-repair-campaign/current_state.md`: Current
          Melee handoff is routed-blocked/not PR-ready; UI should make the PR
          flow and blockers visible as the active work.
    </prior_evidence>

    <expected_value>
        - The operator can open the dashboard, immediately understand which
          project/session/mode is active, and work the correct surface without
          mentally untangling run telemetry from PR handoff work.
        - The current Melee session displays as PR-flow work with visible PR
          slices, QA blockers, draft/open controls, and review-loop status.
        - Future implementation can add durable session storage behind the same
          UI model without changing the user's mental map again.
    </expected_value>
</problem>
