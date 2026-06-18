<implementation_scope>
    <owned_surfaces>
        - `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md`: Keep aligned with final
          implementation decisions or supersede with objective report.
        - `knowledge/sources/injectable/decomp_standards/data/standards.jsonl`:
          Add family/severity/enforcement metadata, retired/merged disposition,
          and compact worker-facing wording.
        - `knowledge/sources/injectable/decomp_standards/README.md`: Document
          new schema fields and update status/search expectations if needed.
        - `docs/20-implementation/knowledge/20-melee-pr-review-qa-standards.md`:
          Reorganize into source-code quality families and remove workflow-only
          standards.
        - `tools/source_editing/review_lint/api/_qa_rules.py`: Add reliable
          hard/warning rules for the new deterministic catches.
        - `tools/source_editing/review_lint/tests/`: Add fixture diffs and
          pytest coverage for each new or changed rule.
        - `tools/source_editing/review_lint/README.md`: Update rule table,
          severity, standard mapping, and moved/invented exceptions.
        - `packages/agents/src/agents/run/worker/templates/system.md`: Keep
          compact source-quality standards and routing instructions.
        - `packages/agents/src/agents/pr/reviewer/templates/preship_system.md`
          and `preship_user.md`: Teach pre-ship review the new families,
          semantic-review boundaries, and example routing.
        - `packages/agents/src/agents/pr/fixer/templates/system.md`: Teach the
          PR fixer to use standard-linked examples and preserve validation
          authority.
        - `packages/agents/src/agents/pr/fixer/` and QA repair prompt files:
          Update prompt builders/tests if example lookup is introduced.
        - `apps/agent-viewer/src/server.ts` and
          `apps/agent-viewer/src/components/AgentViewer.tsx`: Update previews
          if prompt placeholders, standards hydration, or example displays
          change.
        - `docs/20-implementation/agents/20-pr-review.md`,
          `docs/20-implementation/knowledge/00-overview.md`, and
          `docs/20-implementation/tools/00-overview.md`: Update only when the
          implemented runtime surfaces change.
    </owned_surfaces>

    <read_only_references>
        - `docs/20-implementation/knowledge/21-melee-pr-review-qa-coverage-audit.md`:
          Historical evidence counts. Do not treat it as current through #2733
          unless refreshed.
        - `knowledge/sources/injectable/banned_patterns/data`: Read for
          examples and tombstone/regex contract. Mutate only when adding
          curated records through the existing source policy.
        - `packages/agents/src/agents/pr/reviewer/exhibits/preship_exhibits.json`:
          Read existing exhibit shape; update only when adding curated examples
          intentionally.
        - `.codex/skills/melee-pr-workflow/references/pr-shaping-reviewer-guidance.md`:
          PR shape policy reference. Keep separate from code-quality standards.
    </read_only_references>

    <generated_outputs>
        - `objectives/agent-code-quality-standards/report.md`: Final summary of
          implemented changes, validation, residual gaps, and follow-up.
        - `objectives/agent-code-quality-standards/artifacts/coverage_matrix.json`:
          Optional generated matrix mapping standards to lint rules, prompts,
          docs, and examples.
        - `knowledge/sources/injectable/decomp_standards/data/examples.jsonl`:
          Standard-linked example catalog used by repair, PR fixer, and
          pre-ship review prompt contexts.
    </generated_outputs>

    <commands_and_entrypoints>
        - `python3 -m pytest tools/source_editing/review_lint/tests`: Validate
          deterministic lint rules.
        - `bun test packages/agents/src/agents/pr/reviewer packages/agents/src/agents/pr/fixer packages/agents/src/agents/run/worker apps/cli/src/cli/commands`: Validate prompt and QA consumer behavior with focused tests.
        - `bun run agent-viewer:check`: Validate Agent Viewer prompt preview
          behavior after prompt/template changes.
        - `python .codex/skills/setup-objective/scripts/validate_goal_length.py objectives/agent-code-quality-standards/goal.md`: Ensure the goal remains usable as a `/goal` objective.
    </commands_and_entrypoints>

    <adjacent_surfaces_requiring_caution>
        - `apps/dashboard*`: Do not change unless standards status needs new
          visible fields. Do not start UI servers.
        - `projects/melee/project.json`: Read if project-specific prompt
          routing requires it; do not change process names or project metadata
          for this objective.
        - Parent `doldecomp/melee` checkout files: Do not edit as part of this
          orchestrator standards objective except for explicit fixture patches.
    </adjacent_surfaces_requiring_caution>

    <out_of_scope>
        - PR split/grouping policy implementation.
        - Broad past-PR corpus refresh or postmortem rebuild unless needed to
          curate specific examples.
        - Full automated semantic type inference for all pointer math.
        - Rewriting the worker loop, QA repair lane, or PR handoff flow beyond
          standards/example routing.
    </out_of_scope>
</implementation_scope>
