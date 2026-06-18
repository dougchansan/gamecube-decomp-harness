<implementation_scope>
    <owned_surfaces>
        - `apps/dashboard-server/src/server.ts`: dashboard payload, PR record
          compatibility/migration, local PR workspace endpoints, batch/open
          gating, and server-side new-session rejection.
        - `apps/dashboard/src/components/SessionWorkspace.tsx`: PR Mode rows,
          local workspace state, batch controls, and gate language.
        - `apps/dashboard/src/components/App.tsx`: action names, labels, and
          endpoint wiring for local preparation/batch publication.
        - `packages/ui-contract/src/dashboard.ts`: add typed optional fields
          only if JsonObject flexibility is no longer enough.
        - `packages/core/src/state/schema.ts` and `packages/core/src/state/*`:
          durable session/PR tables when moving beyond JSON compatibility.
        - `docs/10-system-design/75-project-session-architecture.md` and
          `docs/10-system-design/65-operator-flow-and-pr-tracking.md`: update
          architecture once behavior is implemented.
        - `docs/20-implementation/ui/00-overview.md`: update dashboard payload
          and operator flow behavior after implementation.
    </owned_surfaces>

    <read_only_references>
        - `apps/cli/src/cli/commands/pr-draft-qa.ts`: draft QA artifact schema
          and lifecycle status; read before attaching validation summaries.
        - `apps/cli/src/cli/commands/pr-preship-review.ts`: pre-ship review
          semantics; read before gating local-ready state on review output.
        - `packages/core/src/epoch/cycle.ts`: existing persistent worktree
          pattern for epoch checkpoints.
        - `objectives/project-session-ui-redesign/current_state.md`: prior UI
          objective boundary and validation status.
    </read_only_references>

    <generated_outputs>
        - `state_dir/pr_handoff/pr_records.json`: compatibility PR ledger, with
          additive fields for session/run provenance, local workspace state,
          validation state, batch state, and GitHub state.
        - `state_dir/pr_workspaces/<run_id>/<branch-slug>/`: persistent local
          git worktrees for prepared PR slices.
        - `objectives/session-pr-workspace/current_state.md`: live objective
          state after each implementation milestone.
    </generated_outputs>

    <commands_and_entrypoints>
        - `POST /api/prs/prepare-local`: prepare one selected PR slice in a
          local worktree without publishing.
        - `POST /api/prs/prepare-local-batch`: prepare the next bounded set of
          local PR slices.
        - `POST /api/run/fresh`: reject unresolved active-session PR work.
        - `bun run ui:check`, `tsc --noEmit`, and `bun run check`: validation
          commands as scope grows.
    </commands_and_entrypoints>

    <adjacent_surfaces_requiring_caution>
        - Existing dirty files in dashboard/server/agent docs may include user
          work; read before editing and do not normalize unrelated content.
        - Git worktree operations can affect the target checkout; keep paths
          under state_dir and avoid destructive cleanup by default.
    </adjacent_surfaces_requiring_caution>

    <out_of_scope>
        - Rewriting the scheduler/worker lease model.
        - Changing how exact-match evidence is produced by workers.
        - Replacing the entire handoff pipeline in one pass.
        - Deleting legacy `Sidebar.tsx` or other already-dirty UI files as a
          cleanup unless required by this objective.
    </out_of_scope>
</implementation_scope>
