<validation_and_handoff>
    <validation_ladder>
        - `bun run check`: Required repo/type validation. Pass condition:
          exits 0, or blocker records exact error and why it is unrelated or
          environment-bound.
        - `bun run ui:build`: Required production dashboard build. Pass
          condition: exits 0 and generated bundle succeeds without starting a
          new UI server.
        - Targeted tests for changed helpers/contracts/server routes: Required
          when logic is added outside React rendering. Pass condition: tests
          exit 0 or missing-test rationale is documented.
        - Route/view smoke: Required for Project Home, Run Mode, PR Mode, and
          Project Access. Use existing UI server only if already running, or
          non-listening handlers/build artifacts otherwise. Pass condition:
          pages render the expected active session/mode state and no primary
          controls overlap.
        - Current PR-flow smoke: Required for the active Melee session or a
          fixture that mirrors it. Pass condition: PR Mode is selected and the
          UI shows planned/mock or real PR rows, QA/handoff state, blocked
          reasons, and PR actions.
    </validation_ladder>

    <artifact_contract>
        - `objectives/project-session-ui-redesign/artifacts/session_view_model_map.md`:
          Must include source dashboard fields, derived session fields, mode
          selection rules, active-session/new-session gates, and known gaps.
        - `objectives/project-session-ui-redesign/artifacts/action_reachability_matrix.md`:
          Must include action name, old location, new page/location, endpoint,
          enabled conditions, disabled reason source, and validation notes.
        - `objectives/project-session-ui-redesign/artifacts/ui_smoke_report.md`:
          Must include page list, viewport coverage, PR-mode-current-session
          result, run-mode result, screenshots or textual observations, and
          residual layout risks.
        - `objectives/project-session-ui-redesign/artifacts/validation_summary.json`:
          Must include commands, status, timestamps, relevant stdout/stderr
          summary, artifact paths, and blockers.
        - `objectives/project-session-ui-redesign/report.md`: Optional final
          report when implementation spans multiple turns or leaves important
          product decisions.
    </artifact_contract>

    <acceptance_gates>
        - `mode_gate`: The selected project displays an active session mode
          derived from dashboard evidence; PR Mode is selected for the current
          Melee PR-flow state or a clearly labeled fixture.
        - `page_gate`: The main UI has focused pages for current run details
          and PR flow; the operator does not need one mega-page to perform the
          core workflow.
        - `action_gate`: Existing dashboard actions remain reachable with
          correct endpoint wiring and disabled-state reasoning.
        - `single_session_gate`: New-run/session entry points stay blocked
          while PR Mode work is unresolved.
        - `build_gate`: Typecheck/build validation passes or blockers are
          recorded with exact remediation.
        - `docs_gate`: System and implementation docs are updated when the
          shipped page model differs from the original design sketch.
    </acceptance_gates>

    <report_contract>
        - Final reporting must summarize the page model, session mode mapping,
          current PR-flow behavior, validation results, known gaps, and the
          next smallest implementation or product decision.
        - If PR rows remain mocked/planned, the report must clearly state what
          data must become real before draft/open/merged statuses can be shown
          as authoritative.
    </report_contract>

    <current_state_update>
        - At start of implementation, update `current_state.md` with the
          selected route through the working plan.
        - After each major phase, record completed files/artifacts, commands
          run, and any changed assumptions about session mode or PR state.
        - Before handoff/final response, record validation status, important
          paths, residual risks, and exact next actions.
    </current_state_update>

    <blocked_or_failed_handoff>
        - If current dashboard data cannot identify PR Mode honestly, stop
          before enabling unsafe UI actions and record the missing server/state
          field.
        - If UI build/check fails, preserve the exact failing command and
          relevant error summary in `validation_summary.json` or
          `current_state.md`.
        - If the live UI server is needed for visual verification and the user
          has not asked to start/restart it, document the skipped visual step
          and provide build/non-listening validation instead.
    </blocked_or_failed_handoff>
</validation_and_handoff>
