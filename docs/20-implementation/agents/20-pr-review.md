---
covers: PR indexer, PR splitter, and PR reviewer agent slices
concepts: [pr-indexer, pr-splitter, pr-reviewer, pr-knowledge, pr-planning, preship-review, draft-pr-qa, qa-ship-gate, pr-fixer]
code-ref: decomp-orchestrator/packages/agents/src/agents/knowledge/pr-indexer, decomp-orchestrator/packages/agents/src/agents/pr/splitter, decomp-orchestrator/packages/agents/src/agents/pr/reviewer, decomp-orchestrator/knowledge/sources/code_context/past_prs
---

# PR Indexer, Splitter, And Reviewer Agents

PR work is split between knowledge-oriented indexing, handoff planning, and
PR-oriented review. The source layout separates those responsibilities and
gives each role its own runtime identity:

- `packages/agents/src/agents/knowledge/pr-indexer/` turns one raw PR slice
  into a compact postmortem record for knowledge-curator handoff.
- `packages/agents/src/agents/pr/splitter/` turns deterministic handoff
  evidence into a semantic, ordered PR series while preserving runner-owned
  file/lane facts.
- `packages/agents/src/agents/pr/reviewer/` reviews planned or opened PR
  slices for known maintainer issues and emits findings for the PR fixer.

## Files

| File | Purpose |
| --- | --- |
| `packages/agents/src/agents/knowledge/pr-indexer/index.ts` | Exposes the PR indexer agent definition. |
| `packages/agents/src/agents/knowledge/pr-indexer/prompt.ts` | Builds PR postmortem/indexing prompt inputs. |
| `packages/agents/src/agents/knowledge/pr-indexer/schema.json` | Defines the PR indexing structured output contract. |
| `packages/agents/src/agents/knowledge/pr-indexer/templates/system.md` | Defines indexing role, standards, and output expectations. |
| `packages/agents/src/agents/knowledge/pr-indexer/templates/initial_user.md` | Carries the PR-specific indexing prompt. |
| `packages/agents/src/agents/pr/splitter/index.ts` | Exposes the PR splitter agent definition. |
| `packages/agents/src/agents/pr/splitter/prompt.ts` | Builds splitter prompts and validates `melee_pr_splitter_plan_v1` output. |
| `packages/agents/src/agents/pr/splitter/schema.json` | Defines the splitter structured output contract. |
| `packages/agents/src/agents/pr/splitter/templates/system.md` | Defines planner-only authority, lane preservation, and output rules. |
| `packages/agents/src/agents/pr/splitter/templates/initial_user.md` | Carries deterministic split context, standards, tools, and schema. |
| `packages/agents/src/agents/pr/reviewer/prompt.ts` | Builds preship PR reviewer prompts from slice diffs, lint findings, standards, and exhibits. |
| `packages/agents/src/agents/pr/reviewer/preship.ts` | Loads/render exhibits and validates the preship output contract. |
| `packages/agents/src/agents/pr/reviewer/templates/preship_system.md` | Adversarial pre-ship reviewer role, rules, and workflow. |
| `packages/agents/src/agents/pr/reviewer/templates/preship_user.md` | Per-slice user prompt: standards, exhibits, lint findings, slice diff. |
| `packages/agents/src/agents/pr/reviewer/templates/preship_schema.json` | Pre-ship structured output contract (`melee_pr_preship_review_v1`). |
| `packages/agents/src/agents/pr/reviewer/exhibits/preship_exhibits.json` | Curated maintainer-rejection exhibits from doldecomp/melee PRs #2655-#2659. |

## PR Splitter Mode

The PR splitter is the intelligent planning layer between end-of-run handoff
and PR review. `pr-split-plan` still collects deterministic facts: changed
files, checkpoint lanes, ship-status filtering, base/head refs, size limits,
seed slices, and validation commands. With `--strategy agent` or project
`pr.splitStrategy: "agent"`, that deterministic plan becomes the splitter
context.

The splitter returns `melee_pr_splitter_plan_v1`: ordered slices with
sanitized ids, display names, titles, lanes, scopes, exact file lists,
dependencies, independence hypotheses, review focus, PR-body summaries, risks,
validation notes, warnings, rationale, and confidence. The CLI validates the
proposal before use: every changed file must appear exactly once, files must
stay in their deterministic lanes, lanes cannot mix inside one slice,
dependencies must point to emitted slice ids, and the max-files-per-PR ceiling
must hold. Invalid or unparseable output keeps the deterministic plan and adds
a warning plus splitter artifacts for inspection.

Splitter prompt artifacts are written under the command's agent output
directory. The dashboard passes the run id to `pr-split-plan`, so live splitter
sessions are recorded as `pr-splitter` Pi sessions and appear in the run
details rail.

## Pre-Ship Review Mode

The PR reviewer is the adversarial pre-ship review layer in the QA ship gate
(see [score and PR handoff](../../10-system-design/60-score-and-pr-handoff.md)
and [the plan](../../30-plans/2026-06-11-qa-ship-gate-and-pr-review-wiring.md)).
The reviewer judges the slice diff plus loaded evidence: global decomp
standards, deterministic L1/L2 lint findings for the slice, and curated
maintainer-rejection exhibits. An unavailable scanner becomes a prompt note
that increases suspicion; it is not approval.

Output follows `melee_pr_preship_review_v1`: per-finding `{file, line,
standard_id, verdict: "reject"|"warn", rationale, suggested_fix}` plus a
top-level `slice_verdict: "approve"|"reject"`, `summary`, and `confidence`.
Invalid or unparseable output is an infrastructure error, not approval.

Invocation is the `pr-preship-review` CLI command, one agent call per planned
PR slice at handoff time. Per-slice artifacts land under
`state_dir/preship_reviews/<run-id>/<slice-id>/`. The command fails closed:
any `reject` finding, any `reject` slice verdict, or any infrastructure
failure exits 1 and blocks the handoff.

`pr-draft-qa` embeds the same preship mode inside the opened draft PR
lifecycle. Scanner findings plus file-backed preship findings are routed
through the PR fixer (`qa-repair` runtime id) when `--run-agents` is set.
Findings that cannot be automatically cleared become commentable
manual-review items after repair attempts.

## Knowledge Relationship

The PR indexer is the knowledge-facing PR agent. Historical PR data lives under
`knowledge/sources/code_context/past_prs/data/`; the indexer turns raw slices
from that corpus into postmortem records that the knowledge curator can reduce
into graph-safe lessons and proposal-only source updates.

The postmortem builder supports pending-only discovery. `kg-maintain` calls the
builder with `--pending-only`, so newly fetched PRs are auto-discovered from
the active PR corpus and only missing `postmortem/postmortem.json` records are
queued. Direct `kg-maintain` enables model-reviewed postmortems with
`--run-pr-agent`; otherwise deterministic scaffold records keep the corpus
indexable.

The default live indexing runtime is provider `codex-lb`, model `gpt-5.5`, and
thinking `medium`. Root `local.env` remains supported, and selected projects
can load their configured ignored `localEnv` file so PR indexing can be
attributed separately from other projects.

## Key Rules

- PR indexing, splitting, and reviewing are separate slices with separate
  runtime ids: `pr-indexer`, `pr-splitter`, and `pr-reviewer`.
- Prompt/schema changes should happen in the owning vertical slice.
- Import indexing code from `@decomp-orchestrator/agents/pr-indexer` or
  `@decomp-orchestrator/agents/agents/knowledge/pr-indexer`.
- Import splitter code from `@decomp-orchestrator/agents/pr-splitter` or
  `@decomp-orchestrator/agents/agents/pr/splitter`.
- Import review code from `@decomp-orchestrator/agents/pr-reviewer` or
  `@decomp-orchestrator/agents/agents/pr/reviewer`.
- PR splitter output should shape the handoff plan but never decide ship-set
  membership; PR reviewer findings should feed the PR fixer or manual-review
  lifecycle; PR indexing output should feed graph ingestion/curation.

## Related

- [Knowledge implementation](../knowledge/00-overview.md)
- [Agent model](../../10-system-design/20-agent-model.md)
