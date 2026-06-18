<problem>
    <objective_question>
        - How should the orchestrator turn recent Melee PR feedback into a
          coherent, agent-facing code-quality standards system with executable
          QA checks and targeted repair examples?
    </objective_question>

    <current_baseline>
        - `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md` defines the target
          direction: six code-quality families, retire/merge decisions,
          current deterministic coverage, gaps, examples, and implementation
          roadmap.
        - `knowledge/sources/injectable/decomp_standards/data/standards.jsonl`
          holds compact worker-injected standards, but records are flat and do
          not yet expose family/severity/enforcement/example metadata.
        - `docs/20-implementation/knowledge/20-melee-pr-review-qa-standards.md`
          is useful but still reads like a broad PR review checklist rather
          than a code-quality standard taxonomy.
        - `tools/source_editing/review_lint/api/_qa_rules.py` already catches
          many hard failures: data anchors, string literal regressions,
          unrolled asserts, copied jobj inlines, register/asm, generated
          residue, and define aliases.
        - Worker validation, PR draft QA, QA repair, PR fixer, and pre-ship
          review already consume `review_lint` findings and standard ids.
    </current_baseline>

    <why_current_state_is_insufficient>
        - Standards are mostly present but not structured by code-quality
          family, severity, or deterministic coverage. Agents can see the
          rules, but the system cannot reliably decide which examples, repair
          hints, or lint behavior belong with each rule.
        - Some reviewed failure modes still rely on human comments or pre-ship
          review: pointer-offset arithmetic, address-named static data,
          codegen pragmas that are known but still suspicious, volatile local
          tactics, and single-use helper/codegen steering.
        - Worker prompts should not carry bulky example catalogs, but repair
          and reviewer agents need concrete examples to flag and fix recurring
          mistakes such as `__assert` vs `HSD_ASSERT`, extern-for-literal
          anchors, borrowed `gv` union arms, and raw pointer math.
        - The `verification-and-regression-ledger` rule is process policy, not
          a source code standard. It should move out of worker standards so
          pipeline artifacts remain the verification source of truth.
    </why_current_state_is_insufficient>

    <failure_modes>
        - `flat_policy`: Adding more bullets to the current standards makes
          prompts longer without improving linter or repair behavior.
        - `over_linting`: Promoting semantic review concerns into hard regex
          checks can block legitimate matches or existing source patterns.
        - `worker_prompt_bloat`: Including examples directly in every worker
          prompt increases token load and distracts from target-specific work.
        - `drift_between_surfaces`: Updating docs without JSONL, linter, prompt
          previews, and tests leaves agents seeing different rules than QA.
        - `process_policy_leak`: PR shape, PR bodies, and manual verification
          ledgers can crowd out the code-quality rules agents need while
          writing C.
    </failure_modes>

    <prior_evidence>
        - `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md`: User-reviewed roadmap for
          the target taxonomy, example routing, and linter gaps.
        - `tools/source_editing/review_lint/README.md`: Current deterministic
          rule list and exit-code contract.
        - `docs/20-implementation/knowledge/21-melee-pr-review-qa-coverage-audit.md`:
          Prior corpus counts through PR #2606; use as background only because
          newer PRs #2655-#2733 drove this objective.
        - `knowledge/sources/injectable/banned_patterns/data`: Maintainer
          rejection records and tombstones from recent PRs.
        - Recent PR feedback from #2581, #2583, #2655-#2659, #2692, #2704,
          #2709, and #2723: concrete evidence for pointer math, data anchors,
          assert/inlines, pragmas, and authored-source style issues.
    </prior_evidence>

    <expected_value>
        - The worker receives a compact, current, code-quality contract.
        - Deterministic QA catches more repeatable hard failures before human
          review.
        - PR fixer, QA repair, and pre-ship review get examples tied to the
          failing standard/rule so fixes are more specific and less hand-wavy.
        - Standards, linter output, repair prompts, and docs stay aligned.
    </expected_value>
</problem>
