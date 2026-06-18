<implementation_scope>
    <owned_surfaces>
        - `apps/dashboard/src/components/App.tsx`: Owns top-level dashboard
          state, action dispatch, rail state, and the new page/navigation shell.
        - `apps/dashboard/src/components/Sidebar.tsx`: May be split, reduced,
          or repurposed into project/session navigation and mode-specific
          controls.
        - `apps/dashboard/src/components/DetailsRail.tsx`: May gain
          mode-aware tabs or move run/log/agent details into focused pages.
        - `apps/dashboard/src/components/ProgressPanel.tsx`: Run Mode should
          preserve progress, epoch, checkpoint, and match/improvement views.
        - `apps/dashboard/src/components/WorkTables.tsx`: Run Mode should
          preserve active/queued/report work visibility.
        - `apps/dashboard/src/components/PhaseStepper.tsx`: May be replaced or
          refit as a session timeline when the project/session model supersedes
          the old six-step presentation.
        - `apps/dashboard/src/lib/api.ts`,
          `apps/dashboard/src/hooks/useDashboardStream.ts`, and
          `apps/dashboard/src/lib/processView.ts`: May change to support
          session view-model fetch/stream behavior without breaking existing
          endpoints.
        - `apps/dashboard/src/styles.css`: Owns responsive layout, navigation,
          page surfaces, and non-overlap fixes for the new UI shape.
        - `packages/ui-contract/src/dashboard.ts`: May add typed session,
          project access, PR flow, or page-view structures when plain
          `JsonObject` payloads are too weak for reliable UI mode selection.
        - `apps/dashboard-server/src/server.ts`: May add or normalize derived
          fields for active session, PR rows, blocked reasons, and project
          inventory. Keep existing endpoints compatible.
        - `docs/10-system-design/75-project-session-architecture.md` and
          `docs/20-implementation/ui/00-overview.md`: Update if implementation
          decisions refine the architecture or current UI behavior.
    </owned_surfaces>

    <read_only_references>
        - `docs/10-system-design/65-operator-flow-and-pr-tracking.md`: Source
          of canonical operator lifecycle and PR board expectations.
        - `docs/10-system-design/60-score-and-pr-handoff.md`: Source of PR
          handoff, QA, draft PR, and review-loop semantics.
        - `objectives/current-pr-qa-repair-campaign/current_state.md`: Source
          for the current Melee PR-flow/blocker starting point.
        - `objectives/project-workspace-layering/current_state.md`: Confirms
          project identity/resolver work is complete.
        - `projects/melee/project.json`: Project defaults and process-name
          authority; avoid casual edits unless required by UI contract.
        - `packages/core/src/state/*` and `packages/core/src/projects/*`: Read
          to understand state/project fields; avoid schema migrations unless
          the derived UI model cannot meet gates.
    </read_only_references>

    <generated_outputs>
        - `objectives/project-session-ui-redesign/artifacts/session_view_model_map.md`:
          Field-by-field mapping from current dashboard payload to Project,
          Active Session, Run Mode, PR Mode, and new-session gate concepts.
        - `objectives/project-session-ui-redesign/artifacts/action_reachability_matrix.md`:
          Table mapping every existing operator action to its new page, enabled
          conditions, disabled reason, endpoint, and source component.
        - `objectives/project-session-ui-redesign/artifacts/ui_smoke_report.md`:
          Manual or automated smoke report with route/page list, screenshots if
          captured, responsive notes, and known residual layout issues.
        - `objectives/project-session-ui-redesign/artifacts/validation_summary.json`:
          Commands run, pass/fail status, relevant artifact paths, and blockers.
    </generated_outputs>

    <commands_and_entrypoints>
        - `bun run check`: Required TypeScript/repo check unless a dependency
          or environment blocker is documented.
        - `bun run ui:build`: Required production UI build unless superseded by
          the repo's current build command.
        - `bun test ...`: Run targeted tests for modified contract/server/UI
          utilities when test files exist or are added.
        - `bun objectives/project-session-ui-redesign/artifacts/<smoke>.ts`:
          Optional non-listening route/view smoke script if server contract
          changes need automated coverage.
    </commands_and_entrypoints>

    <adjacent_surfaces_requiring_caution>
        - `apps/agent-viewer/*`: Do not touch unless prompt template/context
          changes occur. If prompt previews change, update viewer server and
          client previews together and rebuild served dist when needed.
        - `packages/agents/*`: Out of the UI migration path unless PR/reviewer
          prompt metadata must be displayed. Prompt edits trigger Agent Viewer
          preview obligations.
        - `packages/core/src/state/schema.ts`: Avoid durable schema migration
          in the first UI-focused pass unless the active-session gate cannot be
          represented from current data.
        - Live UI process: Do not restart/start unless asked. If build output
          changes while an existing server serves `apps/dashboard/dist`, record
          that the bundle was rebuilt; do not assume the running process picked
          it up unless verified.
    </adjacent_surfaces_requiring_caution>

    <out_of_scope>
        - Redesigning scheduler policy, worker packet generation, scoring,
          score integration, PR split planning, QA repair algorithms, or
          knowledge graph ingestion.
        - Reworking the Melee source checkout or current PR repair patches.
        - Implementing a full CRUD knowledge/standards/tools editor.
        - Opening real GitHub PRs as part of validating the UI redesign unless
          the user separately asks.
    </out_of_scope>
</implementation_scope>
