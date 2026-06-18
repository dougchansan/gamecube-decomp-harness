# Agent Code Quality Standards

Use this objective bundle to build out the Melee agent code-quality standards
system: standards taxonomy, deterministic QA lint, targeted examples, worker
prompt updates, pre-ship review guidance, PR fixer/QA repair prompt routing,
and validation artifacts.

Keep durable handoff notes in `current_state.md`, not in the top-level
`CURRENT_STATE.md`. The root
`AGENT_CODE_QUALITY_STANDARDS_ROADMAP.md` is the seed roadmap for this
objective.

## Objective Files

- `goal.md` - objective, context refresh, strategy, success metrics, non-goals,
  and completion criteria.
- `current_state.md` - compact objective-local handoff state for active work.
- `context/00_problem.md` - problem statement and motivation.
- `context/01_constraints.md` - hard constraints, validity rules, and boundaries.
- `context/02_implementation_scope.md` - files, modules, and systems this
  objective may change.
- `context/03_working_plan.md` - phase-gated execution plan with inputs,
  outputs, gates, and failure handling.
- `context/04_validation_and_handoff.md` - acceptance checks and handoff rules.
- `examples/` - standard-linked example records or notes used by repair and
  review prompts.
- `artifacts/` - generated coverage matrices, reports, and validation outputs.

Objective path: `objectives/agent-code-quality-standards/`
