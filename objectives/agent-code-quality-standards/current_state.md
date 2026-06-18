<current_state>
<last_updated>2026-06-17</last_updated>

<status>
    - Objective implementation is complete and validation passed.
    - Standards are now code-quality focused, family-tagged, and separated
      from PR workflow/manual verification ledger policy.
    - Worker prompts receive compact accepted standards only; examples are
      routed to PR fixer/QA repair and pre-ship review.
</status>

<completed>
    - Created and maintained the objective bundle under
      `objectives/agent-code-quality-standards/`.
    - Added `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md` as the repo top-level
      design/roadmap document.
    - Added `artifacts/coverage_matrix.json`; it accounts for 16 standards,
      27 deterministic/derived QA rules, and final residual semantic gaps.
    - Updated `standards.jsonl` with `family`, `disposition`,
      `worker_facing`, `severity`, `qa_enforcement`, `qa_rule_ids`,
      `example_policy`, `preferred_repairs`, and `retired_into` metadata.
    - Final standard status counts: 13 `accepted`, 2 `merged`, and 1
      `workflow_only`; 13 remain worker-facing and 3 are excluded from worker
      standards injection.
    - Added `examples.jsonl` with 12 `standard_example_v1` records lookupable
      by `standard_id` and `qa_rule_id`.
    - Added `loadStandardExamples()` and `standardExamplesPromptXml()` and
      exported them from the knowledge package.
    - Updated worker, PR fixer/QA repair, pre-ship reviewer, and Agent Viewer
      prompt paths for standards/example rendering.
    - Updated deterministic lint with `pointer_offset_arithmetic`,
      `address_named_static_data`, `codegen_pragma`, `volatile_local_tactic`,
      and stronger `jobj.h` raw assert repair detail.
    - Updated lint tests, fixture coverage, linter README, human standards
      docs, standards README, search/index text, UI contract, dashboard API,
      and standards UI metadata display.
    - Wrote final report at
      `objectives/agent-code-quality-standards/report.md`.
</completed>

<validation>
    - Passed:
      `python .codex/skills/setup-objective/scripts/validate_goal_length.py objectives/agent-code-quality-standards/goal.md`
      (`objective_chars=3893`, `max_chars=3999`).
    - Passed:
      `python3 -m pytest tools/source_editing/review_lint/tests`
      (70 passed).
    - Passed:
      `bun test packages/agents/src/agents/pr/reviewer packages/agents/src/agents/pr/fixer packages/agents/src/agents/run/worker`
      (44 passed).
    - Passed:
      `bun run agent-viewer:check`.
    - Passed:
      `bun test apps/cli/src/cli/commands/pr-draft-qa.test.ts apps/cli/src/cli/commands/qa-repair.test.ts apps/cli/src/cli/commands/worker-qa.test.ts apps/cli/src/cli/commands/pr-preship-review.test.ts`
      (30 passed).
    - Passed:
      `bun run check`.
</validation>

<in_progress>
    - None for this objective.
</in_progress>

<next_actions>
    - Review/commit the objective changes together with the surrounding
      standards, lint, prompt, and docs edits.
    - Keep future hard lint promotions conservative; semantic gaps should
      stay in pre-ship review until a reliable added-diff detector exists.
</next_actions>

<risks_or_open_questions>
    - Likely loop/switch rewrites, single-use helper intent, broad semantic
      naming quality, raw-address field access, and broad data split ownership
      remain semantic review topics.
    - The worktree contains many pre-existing unrelated changes; do not revert
      them while handling this objective.
</risks_or_open_questions>

<important_paths>
    - `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md`
    - `objectives/agent-code-quality-standards/goal.md`
    - `objectives/agent-code-quality-standards/current_state.md`
    - `objectives/agent-code-quality-standards/report.md`
    - `objectives/agent-code-quality-standards/artifacts/coverage_matrix.json`
    - `knowledge/sources/injectable/decomp_standards/data/standards.jsonl`
    - `knowledge/sources/injectable/decomp_standards/data/examples.jsonl`
    - `packages/knowledge/src/decomp-context.ts`
    - `tools/source_editing/review_lint/api/_qa_rules.py`
    - `tools/source_editing/review_lint/api/scan_diff.py`
    - `tools/source_editing/review_lint/tests/`
    - `packages/agents/src/agents/run/worker/templates/`
    - `packages/agents/src/agents/pr/reviewer/`
    - `packages/agents/src/agents/pr/fixer/`
    - `apps/agent-viewer/src/`
    - `docs/20-implementation/knowledge/20-melee-pr-review-qa-standards.md`
</important_paths>
</current_state>
