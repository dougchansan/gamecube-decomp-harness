<working_plan>
    <overview>
        1. session_model_mapping - Derive the project/session/mode model from
           existing dashboard data and document the mapping.
        2. navigation_shell - Introduce focused page navigation without
           dropping existing dashboard capability.
        3. run_mode_page - Move current live-run details into a Run Mode page.
        4. pr_mode_page - Make PR flow the active surface for the current
           stopped/PR-bound Melee session.
        5. project_pages_and_history - Expose project inventory, access, and
           session history outside the live control surface.
        6. validation_docs_handoff - Validate, update docs/state, and leave a
           durable handoff.
    </overview>

    <operating_principles>
        - Prefer a derived session view model before changing durable state.
          Add server/contract fields only when derivation in the client would
          be brittle or duplicated.
        - Keep user actions reachable throughout the migration. A page split is
          not allowed to strand an endpoint or hide a blocker.
        - Treat PR Mode as the current Melee session's default active work
          while PR/handoff artifacts or planned/mock PR rows are present.
        - Keep the UI information-dense and operational: no marketing-style
          landing page, no decorative hero, no page that explains itself instead
          of showing the actual system state.
    </operating_principles>

    <phase id="1" name="session_model_mapping">
        <objective>
            - Define how current dashboard payloads map into project, active
              session, run mode, PR mode, session gate, and page navigation.
        </objective>
        <inputs>
            - `docs/10-system-design/75-project-session-architecture.md`
            - `docs/10-system-design/65-operator-flow-and-pr-tracking.md`
            - `docs/20-implementation/ui/00-overview.md`
            - `packages/ui-contract/src/dashboard.ts`
            - `apps/dashboard-server/src/server.ts`
            - `apps/dashboard/src/components/App.tsx`
            - `apps/dashboard/src/components/Sidebar.tsx`
            - `objectives/current-pr-qa-repair-campaign/current_state.md`
        </inputs>
        <process>
            - Inventory the current dashboard payload fields used by the UI.
            - Define a `SessionViewModel` concept with: project summary,
              active-session id/label, mode, mode evidence, blocked reasons,
              run summary, PR flow summary, page recommendations, and action
              availability.
            - Decide which fields can be derived client-side and which should
              be normalized in the server or `ui-contract`.
            - Write the field mapping and ambiguous cases before editing the
              layout.
        </process>
        <outputs>
            - `objectives/project-session-ui-redesign/artifacts/session_view_model_map.md`:
              source fields, derived fields, mode rules, blocked reasons, and
              unresolved data gaps.
            - Optional typed helper or contract addition if the mapping would
              otherwise be duplicated across components.
        </outputs>
        <gate>
            - The mapping explains why the current Melee session selects PR
              Mode, or it identifies the exact fixture/server field needed to
              make that true honestly.
        </gate>
        <failure_handling>
            - If the current payload has insufficient PR evidence, add a
              clearly labeled planned/mock PR source or server-derived
              `prFlow` block rather than making hidden UI assumptions.
        </failure_handling>
    </phase>

    <phase id="2" name="navigation_shell">
        <objective>
            - Replace the single-page pressure with route/page state for
              Projects, Project Home, Project Access, Active Session, Run Mode,
              PR Mode, and Session History.
        </objective>
        <inputs>
            - Phase 1 view-model map.
            - `apps/dashboard/src/components/App.tsx`
            - `apps/dashboard/src/components/Sidebar.tsx`
            - `apps/dashboard/src/styles.css`
        </inputs>
        <process>
            - Add a stable page selection model using URL query/hash or an
              internal router consistent with the existing app.
            - Build a project/session navigation surface that shows selected
              project, active session, mode verdict, and recommended next
              action.
            - Keep details rail/log behavior available during operations.
            - Preserve existing collapsed-state behavior where it still makes
              sense, but do not require both side rails to be open for normal
              work.
        </process>
        <outputs>
            - New or refactored React components for the navigation shell.
            - Updated CSS layout with responsive page regions.
            - `artifacts/action_reachability_matrix.md` initial draft.
        </outputs>
        <gate>
            - Every existing top-level dashboard action has a named destination
              page before old UI surfaces are removed.
        </gate>
        <failure_handling>
            - If page routing causes state loss or action dispatch duplication,
              keep route state minimal and centralize action dispatch in the
              existing `App` action handler until a later cleanup.
        </failure_handling>
    </phase>

    <phase id="3" name="run_mode_page">
        <objective>
            - Preserve current live-run observability and controls on a focused
              Run Mode page.
        </objective>
        <inputs>
            - Phase 1 view model.
            - Existing `ProgressPanel`, `WorkTables`, `DetailsRail`,
              `PhaseStepper`, and process/action state.
        </inputs>
        <process>
            - Move or compose run progress, epochs, workers, queue, leases,
              active files, worker reports, and run logs into Run Mode.
            - Keep Start/Resume/Pause/Drain/Force Stop controls in Run Mode
              with current enabled/disabled reasons.
            - Ensure Run Mode shows why it is not the active page when PR Mode
              is selected.
            - Keep operation activity/logs visible for run operations without
              dominating PR Mode.
        </process>
        <outputs>
            - Run Mode page/component(s).
            - Updated action matrix rows for run/process controls.
        </outputs>
        <gate>
            - A live or fixture run payload can show all current run details
              without requiring PR panels to be visible.
        </gate>
        <failure_handling>
            - If an old panel cannot be relocated cleanly, leave it reachable
              behind a temporary "legacy run details" section and record the
              exact follow-up in `current_state.md`.
        </failure_handling>
    </phase>

    <phase id="4" name="pr_mode_page">
        <objective>
            - Make PR Mode the main surface for the current active session:
              ship set, split plan, QA/fix rounds, draft PRs, and human review.
        </objective>
        <inputs>
            - Phase 1 view model.
            - `dashboard.handoff`, `dashboard.prs`, campaign/save-point data,
              current PR QA repair objective state, and existing PR actions.
            - `docs/10-system-design/60-score-and-pr-handoff.md`
            - `docs/10-system-design/65-operator-flow-and-pr-tracking.md`
        </inputs>
        <process>
            - Build a PR Mode page with sections for session summary, PR gate,
              ship set/split plan, QA rounds, blockers, draft PR board, and
              human review loop.
            - Show planned/mock PR rows clearly if real PR records are missing;
              do not label them draft/open until backed by real state.
            - Move Prepare, Checkpoint, QA, Reconcile, Split Plan, Sync PRs,
              Open Draft, and Open All Drafts controls into PR Mode.
            - Make blocked/routed state from the current PR QA campaign visible
              enough that the operator sees why the session is in PR flow but
              not yet PR-ready.
            - Ensure Run Mode start/resume controls remain gated while PR Mode
              work is unresolved.
        </process>
        <outputs>
            - PR Mode page/component(s).
            - PR row rendering for planned/mock, branch-pushed, draft, open,
              changes-requested, merged, closed, and blocked statuses as data
              permits.
            - Updated action matrix rows for PR/handoff controls.
        </outputs>
        <gate>
            - Current Melee dashboard state or fixture opens to PR Mode and
              shows the PR flow as the primary active session work.
        </gate>
        <failure_handling>
            - If split-plan/PR records are too incomplete, implement an
              explicit planned PR fixture source with visible "planned/mock"
              labeling and record the backend data gap.
        </failure_handling>
    </phase>

    <phase id="5" name="project_pages_and_history">
        <objective>
            - Add project-level browsing that answers what the project has
              access to and what happened in prior sessions.
        </objective>
        <inputs>
            - Project config and dashboard config payload.
            - Existing campaign/save point, PR, and run details data.
            - Knowledge/tool/standards paths listed in project config and docs.
        </inputs>
        <process>
            - Build Project Home with selected project, baseline, branch,
              active session gate, and recommended next action.
            - Build Project Access with standards, knowledge, tools, missing
              capability/config warnings, and path health.
            - Build Session History with completed sessions/save points, PR
              intake records where available, carry-forward status, and links
              to artifacts.
            - Avoid creating a knowledge editor; this is an inventory/browser
              surface.
        </process>
        <outputs>
            - Project Home, Project Access, and Session History page/component
              surfaces.
            - Updated docs if the final page list differs from the design note.
        </outputs>
        <gate>
            - The operator can inspect project access/history without opening
              Run Mode or PR Mode.
        </gate>
        <failure_handling>
            - If history data is too sparse, show the available save points and
              artifact links with an explicit "history incomplete" state rather
              than a blank page.
        </failure_handling>
    </phase>

    <phase id="6" name="validation_docs_handoff">
        <objective>
            - Validate the UI migration, update documentation, and leave a
              compact handoff state.
        </objective>
        <inputs>
            - Outputs from phases 1-5.
            - `context/04_validation_and_handoff.md`
            - Modified source files and generated artifacts.
        </inputs>
        <process>
            - Run the validation ladder. Use non-listening handlers or builds;
              do not start the UI server unless asked.
            - Capture screenshots or a written visual smoke report for desktop
              and mobile page states if browser tooling is available.
            - Update system/implementation docs to describe the final UI model.
            - Update `current_state.md` with completed work, commands, risks,
              artifacts, and exact next action.
        </process>
        <outputs>
            - `objectives/project-session-ui-redesign/artifacts/ui_smoke_report.md`
            - `objectives/project-session-ui-redesign/artifacts/validation_summary.json`
            - Optional `objectives/project-session-ui-redesign/report.md`
            - Updated `current_state.md`
        </outputs>
        <gate>
            - Completion criteria in `goal.md` and validation gates in
              `context/04_validation_and_handoff.md` are satisfied or blockers
              are explicit enough for the next agent to resume.
        </gate>
        <failure_handling>
            - If validation fails, keep the focused page work only when it does
              not break existing dashboard usage; otherwise document the
              rollback route and smallest repair step.
        </failure_handling>
    </phase>
</working_plan>
