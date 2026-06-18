<goal>
    - Promote the project/session/PR flow from a derived UI projection into a
      durable local workspace model: one active project session owns a session
      branch, run-mode work, PR-mode slices, local PR worktrees, validation
      rounds, GitHub draft/open state, batching, merge intake, and completion.
    - Make PR mode safe to operate before publishing: every planned slice can
      be prepared, committed, validated, repaired, and tracked locally before
      a small operator-chosen batch is opened as GitHub drafts.
</goal>

<context_refresh>
    - Reread `objectives/session-pr-workspace/{goal.md,current_state.md,context/*.md}`.
    - Reread `docs/10-system-design/75-project-session-architecture.md`,
      `docs/10-system-design/65-operator-flow-and-pr-tracking.md`, and
      `docs/10-system-design/60-score-and-pr-handoff.md`.
    - Inspect current implementation surfaces before editing:
      `apps/dashboard-server/src/server.ts`,
      `apps/dashboard/src/components/SessionWorkspace.tsx`,
      `apps/dashboard/src/components/App.tsx`,
      `packages/ui-contract/src/dashboard.ts`,
      `packages/core/src/state/schema.ts`, and `packages/core/src/state/`.
    - Treat this bundle as the authority when chat history and code comments
      disagree.
</context_refresh>

<working_strategy>
    - Start by adding an additive local PR workspace layer that preserves the
      existing handoff artifacts and PR board while recording run/session
      provenance, local branch/worktree state, validation status, and batch
      readiness.
    - Move toward durable session records in phases: compatibility first,
      server-side gates second, persistent local worktrees third, UI batch
      controls fourth, and full GitHub review/merge intake state last.
    - Keep PR publication separate from local preparation. A local-ready PR is
      not automatically opened; draft publishing must be an explicit batch
      action.
</working_strategy>

<success_metrics>
    - A new session has a stable session id, session branch, baseline ref/SHA,
      mode, and latest run id in durable state or a compatibility record.
    - PR records identify their owning session/run, source split-plan slice,
      file manifest, local branch, local worktree, local commit, validation
      state, publication batch, GitHub PR state, CI, comments, and merge/intake
      disposition.
    - Operators can prepare all or selected PR slices locally without opening
      GitHub drafts, then open a bounded batch when ready.
    - The dashboard gates new autonomous runs while the active session has
      unresolved local, draft, open, changes-requested, or un-intaken merged
      PR work.
    - Validation includes typecheck/build plus focused route or unit tests for
      record migration, local preparation, batching, and session gates.
</success_metrics>

<non_goals>
    - Do not require immediate deletion of `pr_handoff/pr_records.json`; keep
      compatibility with existing Melee state and artifacts.
    - Do not open all session PRs on GitHub as the default path. Batch opening
      must be explicit and bounded.
    - Do not start `bun run ui:server`, `bun run ui`, or a UI dev server unless
      the user explicitly asks.
    - Do not add UI controls that let the Melee process name drift from
      `melee-live`.
    - Do not revert unrelated dirty worktree changes.
</non_goals>

<completion_criteria>
    - Durable or compatibility session records are written/read by the
      dashboard server and surfaced in the dashboard payload.
    - PR records can be seeded from a split plan, prepared in persistent local
      worktrees, validated locally, opened in batches, synced from GitHub,
      and marked merged/intaken without losing session provenance.
    - The UI exposes local PR workspace state and batch actions in PR Mode.
    - Server-side `Fresh Run`/new-session gates reject unresolved active-session
      PR work, not merely live worker processes.
    - Documentation and this objective's `current_state.md` record the final
      behavior, validation commands, known risks, and follow-up surfaces.
</completion_criteria>
