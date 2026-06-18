<constraints>
    <hard_rules>
        - Keep this objective scoped to code quality: authored source shape,
          typed access, asserts/inlines, data/literals/externs, codegen
          tactics, names/defines/headers, deterministic QA, and repair prompts.
        - Preserve current standard ids unless a migration path is explicit.
          Existing consumers rely on `standard_id` values in lint findings and
          repair prompts.
        - Do not remove existing hard lint protections while adding new rules.
        - New deterministic lint rules must scan added diff lines, not punish
          pre-existing upstream code unless the hunk reintroduces or moves a
          known rejected pattern.
        - Worker prompt changes must stay compact and must not embed a full
          example catalog.
        - Prompt template or placeholder changes must update Agent Viewer
          preview hydration and parsing at the same time.
    </hard_rules>

    <forbidden_shortcuts>
        - `docs_only_completion`: Invalid because the user asked for actual
          standards, lint, prompt, fixer, and repair-system buildout.
        - `regex_everything`: Invalid because pointer/inline/helper quality
          often requires local semantic context and should stay pre-ship review
          when deterministic evidence is weak.
        - `breaking_standard_ids`: Invalid unless all linter, prompt, repair,
          and docs consumers are migrated in the same change.
        - `worker_example_dump`: Invalid because examples are meant for flagging
          and fixing, not every worker bootstrap.
        - `verification_ledger_as_code_standard`: Invalid because verification
          artifacts are pipeline-owned; source standards should only require
          evidence for retained tactics.
    </forbidden_shortcuts>

    <data_and_context_boundaries>
        - Deployable standards data lives in
          `knowledge/sources/injectable/decomp_standards/data/standards.jsonl`.
        - Repair/review examples may live in a new standard-linked examples
          catalog or in existing curated exhibit structures, but must be
          lookupable by `standard_id` and, where applicable, `rule_id`.
        - `banned_patterns` remains the durable record for specific maintainer
          rejections, regex detectors, and tombstones.
        - PR comments are evidence for examples and standards, not direct
          source truth. Current source, headers, symbols, splits, assembly,
          objdiff/checkdiff, and regression output still outrank standards.
    </data_and_context_boundaries>

    <risk_budget>
        - `false_positive_hard_lint`: Zero known false-positive hard failures
          in fixture tests. If a rule is plausibly context-dependent, ship it
          as warning or pre-ship review first.
        - `prompt_drift`: Zero raw `{{PLACEHOLDER}}` leaks in Agent Viewer
          preview and prompt tests after edits.
        - `standards_drift`: Active JSONL standards, human docs, linter README,
          and prompt wording must agree on family names and retired rules.
        - `test_runtime`: Prefer focused pytest and bun tests; avoid running
          full Melee builds unless code changes require them or handoff asks.
    </risk_budget>

    <promotion_or_completion_gates>
        - `taxonomy_gate`: Every active standard is assigned a family,
          disposition, severity, and enforcement route, or is explicitly
          retired/merged/workflow-only.
        - `lint_gate`: Every new deterministic rule has fixture coverage and
          README documentation.
        - `prompt_gate`: Worker, pre-ship reviewer, PR fixer, QA repair, and
          Agent Viewer paths render updated standards or examples without
          placeholders.
        - `validation_gate`: Objective validation commands pass or exact
          blockers are recorded in `current_state.md`.
    </promotion_or_completion_gates>
</constraints>
