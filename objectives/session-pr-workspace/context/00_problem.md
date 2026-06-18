<problem>
    <objective_question>
        - How should the orchestrator represent a single decomp session from
          session-branch creation through autonomous run mode, local PR
          workspace preparation, batched GitHub draft publication, validation,
          review repair, merge intake, and final session completion?
    </objective_question>

    <current_baseline>
        - `SessionWorkspace` derives active session mode from current run,
          process, handoff, and PR evidence instead of a durable session table.
        - `apps/dashboard-server/src/server.ts` persists PR rows to
          `state_dir/pr_handoff/pr_records.json`; rows are seeded from the
          latest split plan and hydrated from GitHub by branch.
        - `openPrForSlice` verifies a planned slice, creates a temporary
          worktree, commits, pushes to `fork`, opens a GitHub draft, then
          deletes the worktree.
        - `pr-draft-qa` exists as a CLI lifecycle around an opened PR and writes
          artifacts under `state_dir/pr_draft_qa/pr-<number>/<run-id>/`, but the
          dashboard PR object does not yet own that validation state.
    </current_baseline>

    <why_current_state_is_insufficient>
        - The operator wants a session to be a local campaign object. Once run
          mode ends, PR mode should track the current session's PRs until they
          are all locally green, published in controlled batches, reviewed,
          fixed, merged, intaken, or explicitly abandoned.
        - The existing PR board is a useful bridge, but it cannot yet represent
          14 local PR candidates with independent worktrees, validation rounds,
          repair status, publication batches, and review state before GitHub
          draft creation.
        - New-session gating is partly client-side and PR-record-based; the
          server does not yet enforce "no next autonomous run while this
          session's PR work is unresolved."
    </why_current_state_is_insufficient>

    <failure_modes>
        - `global_open_pr_confusion`: The UI treats all upstream open PRs as
          session blockers instead of tracking only PR objects that belong to
          the active local session.
        - `publish_too_much`: Opening every slice at once overwhelms reviewers
          and creates many public branches before local validation and repair
          are complete.
        - `lost_local_context`: A PR branch exists only as a temporary worktree
          during draft creation, so later local repair/validation cannot resume
          from a durable per-PR workspace.
        - `moving_baseline`: Starting a new run while unresolved session PRs
          exist makes evidence ambiguous: workers, PR slices, local branches,
          and CI are no longer tied to one baseline.
        - `validation_orphaning`: `pr-draft-qa` artifacts exist on disk but are
          not attached to the PR row, so the dashboard cannot answer whether a
          PR is locally green, needs repair, or ready for human review.
    </failure_modes>

    <prior_evidence>
        - `docs/10-system-design/75-project-session-architecture.md`: Defines
          one active project session with run mode followed by PR mode.
        - `docs/10-system-design/65-operator-flow-and-pr-tracking.md`: Defines
          PR records as first-class objects that outlive split-plan artifacts.
        - `docs/10-system-design/60-score-and-pr-handoff.md`: Defines prepare
          handoff, ship-set verification, and draft PR QA lifecycle.
        - `objectives/project-session-ui-redesign/current_state.md`: Confirms
          the first UI pass intentionally kept durable state unchanged.
    </prior_evidence>

    <expected_value>
        - The operator can stop a session, prepare 14 PR candidates locally,
          fix and validate them independently, open only the next small batch,
          track reviewer/CI state per PR, and begin the next autonomous run only
          after the active session's PR work has been resolved or explicitly
          carried forward.
    </expected_value>
</problem>
