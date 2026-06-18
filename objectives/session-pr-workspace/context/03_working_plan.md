<working_plan>
    <overview>
        1. baseline_model - Record current session/PR state sources and gaps.
        2. compatibility_pr_ledger - Extend PR records with session/run,
           local workspace, validation, and batching fields without breaking
           existing JSON.
        3. local_workspace_prepare - Add local PR worktree preparation separate
           from draft publication.
        4. server_session_gate - Enforce unresolved PR work in `/api/run/fresh`.
        5. ui_batch_controls - Surface local state and bounded batch actions in
           PR Mode.
        6. durable_state_migration - Move compatibility state into core state
           tables when the JSON bridge is stable.
    </overview>

    <operating_principles>
        - Prefer additive compatibility over disruptive migrations.
        - Keep local preparation, validation, and GitHub publication as
          distinct lifecycle transitions.
        - Preserve operator choice: preparing 14 local PRs is fine; opening 14
          public drafts by default is not.
    </operating_principles>

    <phase id="1" name="baseline_model">
        <objective>
            - Identify current state files, run ids, handoff artifacts, and UI
              assumptions that the compatibility layer must preserve.
        </objective>
        <inputs>
            - `apps/dashboard-server/src/server.ts`
            - `apps/dashboard/src/components/SessionWorkspace.tsx`
            - `projects/melee/state/pr_handoff/pr_records.json` when present.
            - `docs/10-system-design/75-project-session-architecture.md`
        </inputs>
        <process>
            - Confirm where PR rows are read/written and where new-session
              blockers are computed.
            - Record any incompatibility in `current_state.md`.
        </process>
        <outputs>
            - Updated `current_state.md` with baseline findings.
        </outputs>
        <gate>
            - A future agent can describe the current PR row lifecycle from
              split plan to GitHub sync without rereading chat.
        </gate>
        <failure_handling>
            - If state files are missing, use code paths and tests as the
              baseline and mark live data unavailable.
        </failure_handling>
    </phase>

    <phase id="2" name="compatibility_pr_ledger">
        <objective>
            - Extend PR records so each row can own session/run provenance and
              local lifecycle state.
        </objective>
        <inputs>
            - `syncPrRecords`, `readPrRecords`, and write paths in
              `apps/dashboard-server/src/server.ts`.
        </inputs>
        <process>
            - Add migration/default helpers for records missing new fields.
            - Add fields: `sessionId`, `runId`, `baseSha`, `sourcePlan`,
              `local`, `validation`, `batch`, and `github`.
            - Preserve existing top-level `prNumber`, `url`, `status`, `ci`,
              and `comments` while duplicating richer state under subobjects.
        </process>
        <outputs>
            - `pr_records.json` remains readable by current UI and gains
              additive v2 fields.
        </outputs>
        <gate>
            - Existing Melee records load and display without manual migration.
        </gate>
        <failure_handling>
            - If migration risks overwriting operator edits, keep fields
              additive and do not drop unknown keys.
        </failure_handling>
    </phase>

    <phase id="3" name="local_workspace_prepare">
        <objective>
            - Prepare selected PR slices in persistent local worktrees without
              pushing or opening GitHub PRs.
        </objective>
        <inputs>
            - `ship_status.json` verified patch path and `baseline_status.json`
              base SHA/worktree.
            - PR row file manifests.
        </inputs>
        <process>
            - For each selected planned/local-unprepared row, verify the slice
              in isolation, create/update a persistent worktree branch from the
              base SHA, apply the slice patch, commit, and update the PR row.
            - Never remove a prepared worktree automatically.
        </process>
        <outputs>
            - `state_dir/pr_workspaces/<run_id>/<branch-slug>/`
            - Updated PR row `local.status = ready`, worktree path, branch,
              commit SHA, and verification facts.
        </outputs>
        <gate>
            - Local preparation can run for one row and for a bounded next set
              without invoking `gh pr create`.
        </gate>
        <failure_handling>
            - Mark failed rows with `local.status = blocked` plus the error,
              then continue preparing later rows when running a batch.
        </failure_handling>
    </phase>

    <phase id="4" name="server_session_gate">
        <objective>
            - Make the new-session gate server-authoritative.
        </objective>
        <inputs>
            - `freshRun`, `readPrRecords`, and active process checks.
        </inputs>
        <process>
            - Refuse `/api/run/fresh` when active-session PR rows are local
              pending/ready/blocked, draft, open, changes-requested, or merged
              but not intaken.
            - Include a concise JSON reason list for the UI.
        </process>
        <outputs>
            - `freshRun` rejection behavior and UI error text.
        </outputs>
        <gate>
            - Direct endpoint calls cannot bypass unresolved PR work.
        </gate>
        <failure_handling>
            - If legacy records lack session ids, treat unresolved records in
              the current `pr_records.json` as active until explicitly closed.
        </failure_handling>
    </phase>

    <phase id="5" name="ui_batch_controls">
        <objective>
            - Let the operator see local-ready state and publish a bounded
              batch.
        </objective>
        <inputs>
            - `SessionWorkspace.tsx`, `App.tsx`, dashboard payload PR rows.
        </inputs>
        <process>
            - Add local state text and buttons for Prepare Local, Prepare Next
              Batch, and Open Next Draft Batch.
            - Default batch size to 3 unless project config later overrides it.
        </process>
        <outputs>
            - PR Mode clearly distinguishes planned, local-ready, draft/open,
              needs-repair, merged, and intaken rows.
        </outputs>
        <gate>
            - Existing open/sync controls still work, but the recommended path
              is local preparation before draft publication.
        </gate>
        <failure_handling>
            - If UI space gets tight, show local state in row details and keep
              the top action buttons minimal.
        </failure_handling>
    </phase>

    <phase id="6" name="durable_state_migration">
        <objective>
            - Replace compatibility JSON as the source of truth with core state
              tables when the behavior has settled.
        </objective>
        <inputs>
            - Stable v2 PR records and any UI/API tests from prior phases.
        </inputs>
        <process>
            - Add `project_sessions`, `session_prs`, and `session_pr_events`
              tables with migration from `pr_records.json`.
            - Keep a compatibility export path until the UI no longer needs the
              old JSON layout.
        </process>
        <outputs>
            - Durable DB-backed active session and PR ledger.
        </outputs>
        <gate>
            - A restart of the UI server preserves full session/PR state and
              no longer depends on derived mode heuristics for authority.
        </gate>
        <failure_handling>
            - If migration scope is too high-risk, stop at compatibility v2 and
              document the exact remaining migration.
        </failure_handling>
    </phase>
</working_plan>
