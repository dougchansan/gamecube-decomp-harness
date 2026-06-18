<constraints>
    <hard_rules>
        - A project can have at most one active session. Active includes run
          mode and PR mode.
        - A PR record belongs to exactly one session/run provenance chain, even
          if the GitHub PR remains visible after later plans supersede it.
        - Local PR preparation must not publish to GitHub. Publishing is a
          separate explicit action.
        - Local PR worktrees must be deterministic from the session base SHA,
          slice file manifest, verified ship patch, and PR record branch.
        - The Melee dashboard process name remains `melee-live`.
        - Preserve existing `pr_handoff` artifacts and dashboard endpoints
          while adding compatibility state.
    </hard_rules>

    <forbidden_shortcuts>
        - Do not use "all open upstream PRs" as the active-session PR set; only
          tracked session PR objects should gate the session.
        - Do not make `Open All Drafts` the primary answer to batching. Add
          bounded batch semantics or a local-ready queue.
        - Do not infer local validation success from GitHub CI alone; the local
          record must know what validation ran and where artifacts live.
        - Do not start a new run from the UI when unresolved session PR records
          exist, even if no worker process is running.
    </forbidden_shortcuts>

    <data_and_feature_boundaries>
        - `pr_handoff/pr_records.json` is deployable compatibility state until
          core DB tables take over.
        - `pr_draft_qa` summaries are validation evidence and should be linked
          from PR records, not parsed ad hoc by the UI.
        - Worktree paths under `state_dir/pr_workspaces/` are local-only and
          should not be assumed portable across machines.
    </data_and_feature_boundaries>

    <risk_budget>
        - `worktree_deletion`: zero automatic deletion of prepared PR worktrees
          after local preparation. Explicit cleanup can come later.
        - `dirty_repo`: pre-existing unrelated changes must be preserved; make
          additive edits in dirty files.
        - `migration_scope`: if DB migration is too broad, stop at JSON v2 and
          document the exact remaining migration.
    </risk_budget>

    <promotion_or_completion_gates>
        - Existing `pr_handoff/pr_records.json` rows still load after schema
          extension.
        - A prepared PR row has `local.status`, `local.branch`,
          `local.worktreePath`, `local.commitSha`, `baseSha`, and validation
          summary fields.
        - Draft publishing can select a bounded next batch instead of every
          planned/local-ready slice.
        - `/api/run/fresh` rejects unresolved active-session PR work
          server-side.
    </promotion_or_completion_gates>
</constraints>
