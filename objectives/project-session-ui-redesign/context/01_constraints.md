<constraints>
    <hard_rules>
        - A project has at most one active session. The UI may show history and
          artifacts for older sessions, but it must not present multiple
          concurrent autonomous run sessions for the same project.
        - Active session includes PR Mode. Starting a new autonomous run must
          remain blocked while planned, draft, open, changes-requested, or
          not-yet-intaken merged PR work exists for the active session.
        - The Melee dashboard-managed process name remains `melee-live`; do not
          add controls or defaults that let this project process name drift.
        - Assume the UI server is already running. Do not start
          `bun run ui:server`, `bun run ui`, or any UI dev server unless the
          user explicitly asks.
        - Keep path/project override behavior compatible with the completed
          project workspace layering objective.
        - Preserve user/unrelated dirty worktree changes.
    </hard_rules>

    <forbidden_shortcuts>
        - `hide_old_ui_without_mapping`: Removing panels before their actions,
          state, and disabled reasons are represented on a focused page is
          invalid because it drops operator capability.
        - `mode_from_local_storage_only`: Persisting "PR Mode" in browser
          state without deriving it from dashboard evidence is invalid because
          another browser/server restart would show a different truth.
        - `new_session_button_always_enabled`: Allowing a new run while PR work
          is active violates the single active session rule.
        - `backend_rewrite_first`: Requiring a full state schema migration
          before shipping the UI shape is invalid unless a derived view model
          cannot answer the mode/gate questions.
        - `mock_prs_as_success`: Mocked PR rows may show intended slices, but
          they must not imply draft/open/merged state unless backed by PR
          records or clearly labeled mock/planned evidence.
    </forbidden_shortcuts>

    <data_and_feature_boundaries>
        - Deployable UI truth may come from `dashboard.project`,
          `dashboard.status`, `dashboard.process`, `dashboard.handoff`,
          `dashboard.prs`, `dashboard.campaign`, `dashboard.epochs`,
          `RunDetails`, and project config/defaults.
        - Diagnostic/mock PR rows are allowed only as planned-session fixtures
          or explicit "planned/mock" rows while the current real PR records are
          incomplete.
        - PR Mode may include repair/reviewer/fixer operations, but autonomous
          run workers must remain a Run Mode concept.
        - Project Access should summarize standards, knowledge, tools, and
          configuration health; it must not become a full knowledge editor in
          this objective.
    </data_and_feature_boundaries>

    <risk_budget>
        - `action_regression`: Zero known existing dashboard actions may become
          unreachable without an alternate page location and disabled reason.
        - `type_breakage`: Zero TypeScript errors are acceptable at completion.
        - `layout_overlap`: No obvious text/control overlap on desktop and
          mobile smoke screenshots for the new main pages.
        - `mode_misclassification`: If derived mode evidence is ambiguous, the
          UI must show the ambiguity and avoid enabling unsafe next actions.
    </risk_budget>

    <promotion_or_completion_gates>
        - `session_model_gate`: A documented mapping explains how existing
          dashboard fields derive project, active session, run mode, PR mode,
          and new-session blocked reasons.
        - `ui_reachability_gate`: Every existing action in the current sidebar
          and details rail has a home in the new page model.
        - `current_pr_mode_gate`: With current Melee PR/handoff evidence or an
          explicit fixture, the active session lands on PR Mode and shows PR
          flow status rather than live-run telemetry as the primary surface.
        - `validation_gate`: Commands and smoke checks in
          `context/04_validation_and_handoff.md` pass or the objective records
          exact blockers and the smallest useful next step.
    </promotion_or_completion_gates>
</constraints>
