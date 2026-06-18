<current_state>
<last_updated>2026-06-16</last_updated>

<status>
    - First implementation pass is complete.
    - The system now has a compatibility PR workspace layer over
      `state_dir/pr_handoff/pr_records.json`; full DB-backed session/PR tables
      are still a follow-up phase.
    - PR mode supports private local preparation, persistent worktrees, and
      bounded draft publication batches.
    - `Sync PRs` now imports the active split-series workspace: GitHub PRs
      `codex/split-01-*` through `codex/split-05-*` are linked to rows, and
      local split worktrees through `codex/split-14-*` are visible as local
      PR objects.
</status>

<completed>
    - Accepted direction: a session owns a branch, run mode transitions into PR
      mode, and PR mode owns local PR objects before GitHub draft publication.
    - Accepted publication rule: local preparation and validation are distinct
      from opening public drafts; GitHub drafts should be opened in bounded
      batches.
    - Created objective bundle `objectives/session-pr-workspace/`.
    - Added `session_pr_records_v1` normalization with `runId`, `sessionId`,
      `baseSha`, `sourcePlan`, `local`, `validation`, `batch`, and `github`
      record subobjects.
    - Added `POST /api/prs/prepare-local` and
      `POST /api/prs/prepare-local-batch` for persistent local worktrees under
      `state_dir/pr_workspaces/<run_id>/<branch-slug>/`.
    - Added `POST /api/prs/open-batch` for opening the next bounded set of
      local-ready slices as GitHub drafts.
    - Local-ready publication now generates a patch from the persistent
      worktree's committed diff, re-verifies that exact diff, and pushes the
      local worktree branch, so operator repair commits are what ship.
    - `freshRun` now rejects unresolved active-session PR work before starting a
      new session.
    - The PR Mode UI shows local status, validation status, worktree path, and
      actions for `Prepare Local`, `Prepare Next 3`, and `Open Ready 3`.
    - Added split-series discovery to `POST /api/prs/sync`, combining current
      split-plan rows, existing GitHub PRs, and local `codex/split-##-*`
      branches/worktrees.
    - Synced current Melee PR records for run
      `6a0281a8-4147-4c18-9fce-048154304637`: rows `01`-`05` are linked to
      PRs `#2704`, `#2705`, `#2706`, `#2708`, and `#2709`; rows `06`-`14` are
      local-ready planned rows with worktree paths.
    - Documentation was updated in the session architecture, operator flow, and
      UI implementation overview docs.
</completed>

<in_progress>
    - No implementation work is currently active for this phase.
    - Running assumption: `pr_handoff/pr_records.json` remains the bridge state
      until core DB tables are added in a later phase.
</in_progress>

<next_actions>
    - Add focused route/unit tests for PR record migration, session scoping,
      dirty local worktree handling, local-ready publication, and fresh-run
      blockers.
    - Add durable DB-backed session/PR tables once the compatibility workflow is
      proven.
    - Add GitHub review/merge intake status transitions beyond the existing
      status sync and merged PR intake hooks.
    - Decide whether the broad WIP PR `#2702` should remain external, become an
      umbrella/historical row, or be explicitly superseded in the board.
</next_actions>

<risks_or_open_questions>
    - The repository worktree is already dirty in many files, including
      dashboard/server and docs. Preserve unknown user changes and keep edits
      additive.
    - Persistent worktrees must not be deleted automatically because they may
      hold local repair edits after preparation.
    - Full session DB tables may require a separate migration phase after JSON
      compatibility behavior is proven.
    - Legacy PR rows without `runId`/`sessionId` can only be scoped by current
      split-plan branch membership and conservative compatibility rules.
    - `bun run check` is blocked in this environment because Python `pytest` is
      not installed; TypeScript and agent-viewer checks pass before that point.
</risks_or_open_questions>

<validation>
    - `bun run ui:check` passed.
    - `bun run check` passed `tsc --noEmit`, dashboard `ui:check`, and
      `agent-viewer:check`, then failed at `python3 -m pytest
      tools/source_editing/review_lint/tests` with `No module named pytest`.
    - `bunx --bun vite build --config apps/dashboard/vite.config.ts` passed and
      rebuilt `apps/dashboard/dist`.
    - Direct server smoke passed:
      `/api/dashboard?projectId=melee` returned
      `session_pr_records_v1`; `/api/prs/open-batch` rejected with
      `No local-ready PR slices to open. Prepare a local batch first.`
    - Direct `POST /api/prs/sync` smoke passed and wrote 14 current-session
      split-series rows plus five legacy merged rows.
    - Direct `/api/dashboard?projectId=melee` smoke showed 14 visible
      current-session rows: `01`-`05` with PR state/CI/comments and `06`-`14`
      local-ready.
</validation>

<important_paths>
    - `objectives/session-pr-workspace/goal.md`
    - `objectives/session-pr-workspace/context/`
    - `apps/dashboard-server/src/server.ts`
    - `apps/dashboard/src/components/SessionWorkspace.tsx`
    - `apps/dashboard/src/components/App.tsx`
    - `projects/melee/state/pr_handoff/pr_records.json`
    - `docs/10-system-design/75-project-session-architecture.md`
    - `docs/10-system-design/65-operator-flow-and-pr-tracking.md`
</important_paths>
</current_state>
