<validation_and_handoff>
    <validation_ladder>
        - `python .codex/skills/setup-objective/scripts/validate_goal_length.py objectives/agent-code-quality-standards/goal.md`:
          Goal remains usable for `/goal`; must pass.
        - `python3 -m pytest tools/source_editing/review_lint/tests`:
          Deterministic lint rule and fixture validation; must pass after lint
          changes.
        - `bun test packages/agents/src/agents/pr/reviewer packages/agents/src/agents/pr/fixer packages/agents/src/agents/run/worker`:
          Prompt and standards-consumer validation; run focused subsets if test
          names or package structure differ.
        - `bun test apps/cli/src/cli/commands/pr-draft-qa.test.ts apps/cli/src/cli/commands/qa-repair.test.ts apps/cli/src/cli/commands/worker-qa.test.ts`:
          Validate lint findings and repair/fixer flow through CLI consumers
          when touched.
        - `bun run agent-viewer:check`: Validate prompt preview rendering after
          Agent Viewer changes; rebuild viewer bundle only if an existing
          server is serving `apps/agent-viewer/dist`.
        - `bun run check`: Final TypeScript/package sanity check when
          TypeScript sources or exports changed.
    </validation_ladder>

    <artifact_contract>
        - `objectives/agent-code-quality-standards/artifacts/coverage_matrix.json`:
          Must include current standard ids, family, disposition, severity,
          QA enforcement, deterministic rule ids, prompt consumers, example
          source, and gap/follow-up fields.
        - `knowledge/sources/injectable/decomp_standards/data/examples.jsonl`:
          One JSONL/object record per example with
          `schema_version`, `id`, `standard_id`, optional `qa_rule_id`,
          `severity`, `bad_pattern`, `preferred_shape`, `description` bullet
          strings, and evidence reference.
        - `objectives/agent-code-quality-standards/report.md`: Summarize
          changed standards, retired/merged rules, lint additions, prompt
          routing, validation commands, and residual gaps.
        - `current_state.md`: Compact live state with last update date,
          completed work, in-progress work, next actions, risks, and important
          paths.
    </artifact_contract>

    <acceptance_gates>
        - `standards_alignment`: JSONL standards, human docs, linter README,
          and prompt wording agree on active families and retired/merged
          standards.
        - `deterministic_coverage`: New hard/warning linter rules have tests,
          fixture coverage, and standard ids in findings.
        - `prompt_rendering`: Worker, pre-ship reviewer, PR fixer, QA repair,
          and Agent Viewer prompt paths render updated standards/examples
          without raw placeholders.
        - `example_routing`: Examples are available to repair/reviewer/fixer
          contexts by `standard_id` and `rule_id`; worker base prompt remains
          compact.
        - `process_separation`: PR shape policy and manual verification ledger
          policy are not worker-facing source-code standards.
    </acceptance_gates>

    <report_contract>
        - `report.md` must include:
          - Standards families implemented.
          - Retired, merged, and workflow-only standards.
          - Deterministic lint additions with rule ids and severities.
          - Prompt surfaces updated.
          - Example catalog location and lookup contract.
          - Validation commands and results.
          - Residual gaps that remain pre-ship-review or human-only.
    </report_contract>

    <current_state_update>
        - Update `current_state.md` before major handoff/compaction and final
          response.
        - Include commands run, skipped commands with reasons, artifact paths,
          remaining risks, and exact next action.
    </current_state_update>

    <blocked_or_failed_handoff>
        - If lint rules are too noisy, land only warnings or examples and mark
          the hard-gate promotion blocked.
        - If prompt/template changes cannot be validated because unrelated
          tests fail, record the exact failing command and whether touched
          snapshots/rendering were manually inspected.
        - If example catalog plumbing is incomplete, preserve the catalog and
          route it first to the surface that already supports examples
          (`preship_exhibits` or repair prompt context), then record remaining
          consumers as follow-up.
    </blocked_or_failed_handoff>
</validation_and_handoff>
