<validation_and_handoff>
    <validation_ladder>
        - `bun run ui:check`: dashboard type safety after action/row changes.
        - `tsc --noEmit`: workspace type safety when server/core types change.
        - Focused route smoke via the existing UI server only if it is already
          running; do not start a new server unless the user asks.
        - For local workspace code, use a temp repo or dry-run fixture before
          touching a real Melee checkout when possible.
        - `bun run check`: final broad validation when edits touch shared core,
          agents, CLI, or UI contracts.
    </validation_ladder>

    <artifact_contract>
        - `state_dir/pr_handoff/pr_records.json`: must remain JSON with
          top-level `records`, `upstreamOpen`, `repo`, `syncedAt`, and any
          warning. Each record may add `schemaVersion`, `sessionId`, `runId`,
          `baseSha`, `sourcePlan`, `local`, `validation`, `batch`, and
          `github`.
        - `local` object: `{ status, branch, worktreePath, commitSha,
          preparedAt, error }` where status is one of `not_prepared`, `ready`,
          `blocked`, or `dirty`.
        - `validation` object: `{ status, checkedAt, summaryPath, reportPath,
          newMatches, regressions, issuesCheck }` where status is one of
          `not_run`, `passed`, `failed`, `blocked`, or `warning`.
        - `batch` object: `{ state, ordinal, selectedAt, publishedAt }` where
          state is one of `unbatched`, `selected`, `published`, or `deferred`.
    </artifact_contract>

    <acceptance_gates>
        - Existing PR rows from the current Melee state render after any schema
          extension.
        - Local preparation does not call `gh pr create` or push by default.
        - Batch publication can be limited to three rows without changing the
          session's remaining local-ready rows.
        - Server-side new-session rejection cannot be bypassed by calling
          `/api/run/fresh` directly while unresolved PR rows exist.
    </acceptance_gates>

    <report_contract>
        - `report.md` is optional until the final migration; interim handoffs
          should update `current_state.md` with edited paths, commands, and
          exact remaining phases.
    </report_contract>

    <current_state_update>
        - Update `objectives/session-pr-workspace/current_state.md` after each
          milestone with edited paths, validation commands, blockers, and the
          next smallest safe phase.
    </current_state_update>

    <blocked_or_failed_handoff>
        - If the implementation stops at compatibility JSON, state that clearly
          and name the DB-backed migration as the next phase.
    </blocked_or_failed_handoff>
</validation_and_handoff>
