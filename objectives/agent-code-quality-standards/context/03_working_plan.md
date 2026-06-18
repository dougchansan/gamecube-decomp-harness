<working_plan>
    <overview>
        1. baseline_inventory - Build a standards-to-lint-to-prompt inventory
           from current files and the root roadmap.
        2. standards_taxonomy - Update deployable standards and human docs into
           code-quality families with retired/merged dispositions.
        3. example_catalog - Create or wire targeted examples for repair and
           review without bloating worker prompts.
        4. deterministic_lint - Add reliable `review_lint` hard/warning rules
           and fixtures for the new catches.
        5. prompt_routing - Update worker, pre-ship reviewer, PR fixer, QA
           repair, and Agent Viewer prompt paths.
        6. validation_and_report - Run focused validation, write objective
           report, and update handoff state.
    </overview>

    <operating_principles>
        - Make standards executable: every active rule should say who consumes
          it, whether lint can catch it, and where examples live.
        - Keep deterministic lint conservative. Hard-fail only patterns that
          are maintainer-rejected or mechanically unsafe in added diffs.
        - Keep examples targeted. Worker gets compact standards; repair and
          review get examples after a finding identifies the relevant family.
        - Preserve compatibility. Add metadata around existing standard ids
          instead of replacing ids casually.
    </operating_principles>

    <phase id="1" name="baseline_inventory">
        <objective>
            - Produce a current map of standards, lint rules, prompt consumers,
              and known gaps before editing behavior.
        </objective>
        <inputs>
            - `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md`
            - `knowledge/sources/injectable/decomp_standards/data/standards.jsonl`
            - `tools/source_editing/review_lint/api/_qa_rules.py`
            - `tools/source_editing/review_lint/README.md`
            - Worker, pre-ship reviewer, PR fixer, and QA repair prompt files.
        </inputs>
        <process>
            - Enumerate active standard ids, titles, and current text.
            - Enumerate `review_lint` rule ids, severities, and standard ids.
            - Enumerate prompt builders/templates that inject standards or
              lint findings.
            - Write a coverage matrix that marks each roadmap family as
              `covered`, `partial`, `missing_lint`, `prompt_only`, or
              `retire_or_merge`.
        </process>
        <outputs>
            - `objectives/agent-code-quality-standards/artifacts/coverage_matrix.json`
              with standard id, family, disposition, lint rules, prompt
              consumers, example source, and gap fields.
            - `current_state.md` update with baseline inventory status.
        </outputs>
        <gate>
            - The matrix accounts for every current `global_standard:*` record
              and every `review_lint` rule with a standard id.
        </gate>
        <failure_handling>
            - If prompt surfaces have moved, update `context_refresh` and
              `implementation_scope` before continuing.
        </failure_handling>
    </phase>

    <phase id="2" name="standards_taxonomy">
        <objective>
            - Convert deployable and human standards into the six code-quality
              families while preserving runtime compatibility.
        </objective>
        <inputs>
            - Phase 1 coverage matrix.
            - Root roadmap disposition table.
            - Existing standards JSONL and human standards doc.
        </inputs>
        <process>
            - Add optional fields such as `family`, `severity`,
              `qa_enforcement`, `example_policy`, `preferred_repairs`, and
              `retired_into` to standards JSONL records.
            - Mark `verification-and-regression-ledger` as workflow-only or
              retired from worker injection; do not delete until consumers are
              confirmed safe.
            - Merge `text-before-data-matching` and
              `data-sections-and-tu-splits` into the data/literals/externs
              family in human docs while retaining detector-specific standard
              ids where useful.
            - Reorganize the human standards doc around:
              authored source shape, typed access, asserts/reports/inlines,
              literals/data/externs, codegen tactics, and names/headers.
        </process>
        <outputs>
            - Updated `standards.jsonl`.
            - Updated human standards doc.
            - Updated `coverage_matrix.json` disposition fields.
        </outputs>
        <gate>
            - No active worker-facing standard lacks a family and enforcement
              route; retired/merged records name the replacement.
        </gate>
        <failure_handling>
            - If a consumer rejects added JSONL fields, keep the schema
              backwards-compatible and update the reader/test instead of
              flattening the taxonomy away.
        </failure_handling>
    </phase>

    <phase id="3" name="example_catalog">
        <objective>
            - Provide concrete bad/better examples for flagging and fixing
              standards violations without dumping examples into every worker
              prompt.
        </objective>
        <inputs>
            - Root roadmap examples.
            - `banned_patterns` records and preship exhibits.
            - Recent PR comments cited in the roadmap.
            - Phase 2 standard families and standard ids.
        </inputs>
        <process>
            - Decide storage: a new standard-linked examples source, an
              `examples.jsonl` file under `decomp_standards`, or a curated
              repair/reviewer examples file. Prefer the smallest structure that
              supports lookup by `standard_id` and `rule_id`.
            - Seed examples for pointer-offset arithmetic, `HSD_ASSERT` vs
              raw `__assert`, copied `jobj.h` inlines, extern-for-literal data
              anchors, packed strings, codegen pragmas, volatile/local lifetime
              steering, define aliases, and same-TU extern repair.
            - Add loader or prompt plumbing only for repair/reviewer/fixer
              paths that need examples.
            - Keep `banned_patterns` for exact rejected hunks and tombstones;
              do not duplicate it as generic examples unless the example adds
              a repair shape.
        </process>
        <outputs>
            - Example catalog or updated exhibit file.
            - Tests or snapshots proving examples can be retrieved by relevant
              standard/rule ids.
            - Documentation of where examples are stored and who consumes them.
        </outputs>
        <gate>
            - Every target family has at least one concise bad/better example
              available to repair or pre-ship contexts.
        </gate>
        <failure_handling>
            - If example plumbing is too invasive, land the catalog and wire it
              to pre-ship review first; record PR fixer/QA repair routing as
              follow-up in `current_state.md`.
        </failure_handling>
    </phase>

    <phase id="4" name="deterministic_lint">
        <objective>
            - Add reliable deterministic QA catches for recurring hard or
              warning-level source-quality issues.
        </objective>
        <inputs>
            - Phase 1 matrix gap list.
            - Phase 3 example patterns.
            - Existing `_qa_rules.py`, fixtures, and tests.
        </inputs>
        <process>
            - Implement `pointer_offset_arithmetic` as warning or error for
              added raw byte-pointer offset shapes, excluding known byte
              buffers and comments/strings.
            - Implement `address_named_static_data` for new address-style
              static/global data that is not a moved pre-existing definition.
            - Implement `codegen_pragma` warning for added known codegen
              pragmas (`dont_inline`, `auto_inline`, `global_optimizer`,
              `pool_data`) while keeping `novel_pragma` for unknown pragmas.
            - Implement `volatile_local_tactic` warning for added local
              volatile declarations in normal source contexts.
            - Strengthen `unrolled_assert`/`copied_jobj_inline` messages with
              standard-specific repair hints, especially for `jobj.h` line
              numbers and `HSD_JObj*` helpers.
            - Add one fixture and test expectation per new rule, including
              moved-vs-invented or warning-vs-error cases where applicable.
        </process>
        <outputs>
            - Updated `tools/source_editing/review_lint/api/_qa_rules.py`.
            - Updated `tools/source_editing/review_lint/tests/fixtures/`.
            - Updated pytest tests.
            - Updated `tools/source_editing/review_lint/README.md`.
        </outputs>
        <gate>
            - `python3 -m pytest tools/source_editing/review_lint/tests`
              passes and new rules report expected `rule_id`, severity,
              `standard_id`, line, message, and excerpt.
        </gate>
        <failure_handling>
            - If a proposed hard rule is context-dependent, downgrade to
              warning or pre-ship review and document why in the coverage
              matrix.
        </failure_handling>
    </phase>

    <phase id="5" name="prompt_routing">
        <objective>
            - Make all relevant agent prompts understand the updated standards
              and example routing.
        </objective>
        <inputs>
            - Updated standards JSONL, examples, and linter findings.
            - Worker, pre-ship reviewer, PR fixer, QA repair, and Agent Viewer
              prompt paths.
        </inputs>
        <process>
            - Update worker prompt wording to emphasize compact code-quality
              standards and retired workflow-only exclusions.
            - Update pre-ship reviewer prompts to evaluate semantic families
              that deterministic lint cannot fully catch, including likely
              loops, helper/inlining shape, and authored-source style.
            - Update PR fixer and QA repair prompts to consume lint findings,
              standard ids, rule ids, and targeted examples; require minimal
              source fixes and runner validation.
            - Update Agent Viewer server sample hydration and client parsing
              for any new prompt placeholders or example sections.
            - Add or update prompt tests/snapshots so raw placeholders cannot
              leak.
        </process>
        <outputs>
            - Updated prompt templates/builders/tests.
            - Updated Agent Viewer preview path when prompt rendering changes.
            - Documentation updates for prompt/example routing.
        </outputs>
        <gate>
            - Focused bun tests pass for touched prompt packages and Agent
              Viewer check/build expectations are satisfied without starting
              new servers.
        </gate>
        <failure_handling>
            - If an existing viewer server serves `apps/agent-viewer/dist`,
              rebuild the bundle after changes. Do not start a new server.
        </failure_handling>
    </phase>

    <phase id="6" name="validation_and_report">
        <objective>
            - Validate the complete standards/lint/prompt system and leave a
              durable handoff.
        </objective>
        <inputs>
            - Outputs from phases 1-5.
            - Validation ladder in `context/04_validation_and_handoff.md`.
        </inputs>
        <process>
            - Run focused validation commands.
            - Regenerate or update the coverage matrix with final statuses.
            - Write `objectives/agent-code-quality-standards/report.md` with
              implemented changes, tests, known gaps, and follow-up.
            - Update `current_state.md` with final status, commands, artifact
              paths, risks, and next actions.
        </process>
        <outputs>
            - Final report.
            - Final coverage matrix.
            - Updated current state.
        </outputs>
        <gate>
            - Completion criteria in `goal.md` are satisfied or the report
              explicitly marks the objective blocked with the smallest useful
              next step.
        </gate>
        <failure_handling>
            - If validation fails, preserve artifacts, exact command output
              paths, and the narrow failing surface. Do not mark complete.
        </failure_handling>
    </phase>
</working_plan>
