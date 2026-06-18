<goal>
    - Build out the Melee agent code-quality standards system from the root
      roadmap into executable policy: reshape standard families, retire or
      merge obsolete worker-facing standards, add deterministic QA lint for
      hard catches, and update worker/reviewer/fixer prompts so agents write,
      flag, and repair source according to those rules.
    - Preserve compact worker standards while routing detailed examples to
      lint findings, QA repair, PR fixer, and pre-ship review contexts.
</goal>

<context_refresh>
    <required_files>
        - AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md
        - objectives/agent-code-quality-standards/current_state.md
        - objectives/agent-code-quality-standards/context/00_problem.md
        - objectives/agent-code-quality-standards/context/01_constraints.md
        - objectives/agent-code-quality-standards/context/02_implementation_scope.md
        - objectives/agent-code-quality-standards/context/03_working_plan.md
        - objectives/agent-code-quality-standards/context/04_validation_and_handoff.md
        - knowledge/sources/injectable/decomp_standards/data/standards.jsonl
        - tools/source_editing/review_lint/api/_qa_rules.py
        - tools/source_editing/review_lint/README.md
        - packages/agents/src/agents/run/worker/templates/system.md
        - packages/agents/src/agents/pr/reviewer/templates/preship_system.md
        - packages/agents/src/agents/pr/reviewer/templates/preship_user.md
        - packages/agents/src/agents/pr/fixer/templates/system.md
    </required_files>
    <instruction>
        - At start and after resume/compaction, reread these files and treat
          this bundle plus the root roadmap as the execution contract.
    </instruction>
</context_refresh>

<working_strategy>
    - Sequence the work as standards taxonomy first, then example catalog,
      deterministic lint, repair/reviewer/fixer prompt routing, viewer preview,
      docs, and validation.
    - Preserve existing standard ids where possible; add family/severity/
      enforcement metadata without breaking current prompt or lint consumers.
    - Promote hard catches into `review_lint` only when added-diff evidence is
      reliable. Keep semantic judgments in pre-ship review or repair prompts.
</working_strategy>

<success_metrics>
    - Standards JSONL, docs, linter metadata, and prompts describe the same six
      code-quality families.
    - Retired or merged standards map to replacement families or workflow-only
      policy.
    - New deterministic rules and fixtures cover the agreed hard catches where
      feasible.
    - Worker prompts stay compact, while fixer/repair/reviewer prompts can
      retrieve concrete examples by `standard_id` and `rule_id`.
</success_metrics>

<non_goals>
    - Do not turn PR shape, PR body, or manual verification ledgers into
      worker-facing code standards.
    - Do not start UI, dashboard, Agent Viewer, or dev servers unless asked.
    - Do not bypass build, objdiff/checkdiff, regression, QA, or pre-ship gates
      to declare a rule implementation complete.
    - Do not rewrite unrelated agent architecture or repair-lane behavior
      beyond what is needed to route these standards and examples.
</non_goals>

<completion_criteria>
    - Active standards and docs are reorganized around code-quality families
      with clear retired/merged disposition.
    - New/updated `review_lint` rules have fixture tests and README coverage.
    - Worker, pre-ship reviewer, PR fixer, QA repair, and Agent Viewer preview
      paths render the updated standards without raw placeholders.
    - Validation commands in `context/04_validation_and_handoff.md` pass, or
      failures are documented with exact blockers.
    - `current_state.md` records final status, commands, artifacts, risks, and
      remaining follow-up.
</completion_criteria>
