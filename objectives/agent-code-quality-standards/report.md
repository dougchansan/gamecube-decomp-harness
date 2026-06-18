---
covers: Final handoff for the agent code-quality standards objective.
concepts: [agent-standards, decomp-quality, qa-lint, prompt-routing, repair-examples]
code-ref: AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md, knowledge/sources/injectable/decomp_standards/data/standards.jsonl, tools/source_editing/review_lint/api/_qa_rules.py
---

# Agent Code Quality Standards Report

## Outcome

The agent-facing Melee standards are now structured as source-code quality
rules instead of broad PR workflow policy. The worker prompt receives compact,
active standards only; repair, PR fixer, and pre-ship review paths receive
targeted examples after lint or review context identifies the relevant standard
or rule.

The implementation preserves all 16 existing `global_standard:*` ids. Final
standard status counts are:

- `accepted`: 13 worker-facing code-quality standards.
- `merged`: 2 standards retained for search/history but removed from worker
  injection as standalone rules.
- `workflow_only`: 1 verification-ledger standard retained outside worker
  code-quality injection.

## Standards Families

The deployable JSONL standards, human docs, linter README, and prompt routing
now use the same six active source-quality families:

- `authored_source_shape`: local authored C shape, natural loops, canonical
  control flow, and generated residue.
- `typed_access_and_pointer_math`: typed fields, correct union arms, avoiding
  raw byte offsets and type-erasing casts.
- `asserts_reports_and_header_inlines`: `HSD_ASSERT*`, report idioms, and
  canonical `jobj.h` inlines/helpers.
- `literals_data_and_externs`: literal ownership, data anchors, packed strings,
  address-style data, and TU ownership.
- `codegen_tactics`: pragmas, `register`, inline asm, volatile locals, local
  extern steering, and evidence-required matching tactics.
- `names_defines_headers_and_prototypes`: conservative names, define aliases,
  generated locals, truthful includes, and prototypes.

Retired or merged standards:

- `global_standard:text-before-data-matching`: merged into
  `global_standard:literals-and-data-ownership`.
- `global_standard:data-sections-and-tu-splits`: merged into
  `global_standard:literals-and-data-ownership`.
- `global_standard:verification-and-regression-ledger`: marked
  `workflow_only`; runner/build/objdiff/regression artifacts own verification.

## Deterministic QA

`review_lint` now includes the new hard/warning catches that were reliable on
added diff evidence:

- `pointer_offset_arithmetic`: warning for raw byte-pointer offset access.
- `address_named_static_data`: error for new address-style static/global data,
  with moved-line downgrade support in `scan_diff`.
- `codegen_pragma`: warning for established-but-suspicious codegen pragmas.
- `volatile_local_tactic`: warning for local `volatile` declarations used as
  likely lifetime/register steering.

The raw assert detector now carries stronger `jobj.h` repair detail:
`detail.assert_file`, `detail.assert_line`, and messaging that points repair
agents toward canonical `HSD_JObj*` helpers or `HSD_ASSERT*` macros.

The final coverage matrix accounts for 16 standards and 27 deterministic or
derived QA rules:

- `objectives/agent-code-quality-standards/artifacts/coverage_matrix.json`

## Examples And Routing

The standard-linked example catalog lives at:

- `knowledge/sources/injectable/decomp_standards/data/examples.jsonl`

It contains 12 `standard_example_v1` records. Records are lookupable by
`standard_id` and, where applicable, `qa_rule_id`. Seed examples cover natural
loops, pointer offsets, borrowed `GroundVars` arms, raw `jobj.h` asserts,
copied `jobj.h` inlines, extern literal/data anchors, packed strings, codegen
pragmas, volatile locals, define aliases, generated local names, and same-TU
function extern repair.

Runtime support was added through:

- `loadStandardExamples()`
- `standardExamplesPromptXml()`

Worker prompts stay compact and do not embed the full example catalog. PR
fixer/QA repair and pre-ship review prompts select examples from lint findings,
queue findings, or fallback catalog context.

## Prompt And UI Surfaces

Updated runtime and prompt surfaces:

- Standards XML filters out non-worker-facing `merged` and `workflow_only`
  records.
- Standards XML includes compact `family`, `severity`, and `qa_enforcement`
  attributes.
- Worker prompt no longer asks agents to maintain a separate manual regression
  ledger.
- PR fixer/QA repair prompt includes targeted `STANDARD_EXAMPLES_XML`.
- Pre-ship review prompt includes targeted or fallback `STANDARD_EXAMPLES_XML`
  and treats examples as repair context, not independent authority.
- Agent Viewer server and client fallback hydrate the new examples placeholder.
- Knowledge search/index text includes standard metadata.
- Dashboard standards API/UI can surface family, disposition, severity, and QA
  chips.

## Documentation

Updated documentation:

- `AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md`: top-level roadmap and design.
- `docs/20-implementation/knowledge/20-melee-pr-review-qa-standards.md`:
  present-state human standard taxonomy.
- `knowledge/sources/injectable/decomp_standards/README.md`: JSONL metadata and
  examples catalog contract.
- `tools/source_editing/review_lint/README.md`: deterministic rule table.

## Validation

Passed on 2026-06-17:

- `python .codex/skills/setup-objective/scripts/validate_goal_length.py objectives/agent-code-quality-standards/goal.md`
  - `objective_chars=3893`, `max_chars=3999`
- `python3 -m pytest tools/source_editing/review_lint/tests`
  - 70 passed
- `bun test packages/agents/src/agents/pr/reviewer packages/agents/src/agents/pr/fixer packages/agents/src/agents/run/worker`
  - 44 passed
- `bun run agent-viewer:check`
  - passed
- `bun test apps/cli/src/cli/commands/pr-draft-qa.test.ts apps/cli/src/cli/commands/qa-repair.test.ts apps/cli/src/cli/commands/worker-qa.test.ts apps/cli/src/cli/commands/pr-preship-review.test.ts`
  - 30 passed
- `bun run check`
  - passed, including TypeScript checks, dashboard check, Agent Viewer check,
    and review-lint pytest.

## Residual Gaps

These remain pre-ship review or human-review concerns because they need local
semantic context:

- Likely loop, switch, ternary, and helper-shape rewrites.
- Single-use codegen helper intent.
- Broad semantic naming quality.
- Raw-address field access when proving the correct typed path requires local
  struct/source context.
- Broad data split ownership when source, split metadata, assembly, and
  regression artifacts must be reconciled together.

No further hard lint rule should be promoted from these gaps until there is a
deterministic added-diff shape with a low false-positive risk.
