---
covers: PR-review agent slice and relationship to platform-owned PR knowledge
concepts: [pr-review-agent, pr-knowledge, schema, prompts, postmortems, preship-review, qa-ship-gate]
code-ref: decomp-orchestrator/packages/agents/src/pr-review, decomp-orchestrator/knowledge/sources/code_context/past_prs
---

# PR-Review Agent

The PR-review agent is the centralized agent surface for PR analysis and
postmortem-style review knowledge. It lives beside the director and worker
agents so future PR review behavior has one canonical agent slice.

## Files

| File | Purpose |
| --- | --- |
| `packages/agents/src/pr-review/index.ts` | Exposes the PR-review agent definition to the registry. |
| `packages/agents/src/pr-review/prompt.ts` | Builds PR-review prompt inputs. |
| `packages/agents/src/pr-review/schema.json` | Defines the structured output contract. |
| `packages/agents/src/pr-review/templates/system.md` | Defines review role, standards, and output expectations. |
| `packages/agents/src/pr-review/templates/initial_user.md` | Carries the PR-specific user prompt. |
| `packages/agents/src/pr-review/preship.ts` | Pre-ship mode: exhibit loading/rendering and the output-contract validator. |
| `packages/agents/src/pr-review/templates/preship_system.md` | Adversarial pre-ship reviewer role, rules, and workflow. |
| `packages/agents/src/pr-review/templates/preship_user.md` | Per-slice user prompt: standards, exhibits, lint findings, slice diff. |
| `packages/agents/src/pr-review/templates/preship_schema.json` | Pre-ship structured output contract (`melee_pr_preship_review_v1`). |
| `packages/agents/src/pr-review/exhibits/preship_exhibits.json` | Curated maintainer-rejection exhibits from doldecomp/melee PRs #2655–#2659. |

## Pre-Ship Review Mode

The agent has a second mode: the adversarial pre-ship review that is the QA
ship gate's L3 layer (see
[score and PR handoff](../../10-system-design/60-score-and-pr-handoff.md) and
[the plan](../../30-plans/2026-06-11-qa-ship-gate-and-pr-review-wiring.md)).
The runtime id stays `pr-review`; the mode is selected by template
(`preship_system.md` / `preship_user.md`), mirroring how the postmortem mode
is parameterized.

The prompt stance is adversarial and load-bearing: the worker that wrote the
code optimizes for objdiff score, so the reviewer's only job is to find every
reason the maintainer would reject the diff. The review is tool-less — the
agent runs with an empty tool profile and judges only the slice diff plus the
loaded evidence: the global decomp standards, the deterministic L1/L2 lint
findings for the slice (including warnings; an unavailable scanner becomes a
"review with extra suspicion" prompt note, not a skip), and the curated
exhibits. `exhibits/preship_exhibits.json` carries nine exhibits — eight
verbatim maintainer rejections from PRs #2656–#2659 (extern anchors, packed
string blobs, open-coded asserts, the particle.c resubmission) plus one
counter-exhibit, the accepted ftcoll style from #2655, which teaches the
reviewer what not to flag.

Output follows `melee_pr_preship_review_v1`: per-finding `{file, line,
standard_id, verdict: "reject"|"warn", rationale, suggested_fix}` plus a
top-level `slice_verdict: "approve"|"reject"`, `summary`, and `confidence`.
`preship.ts` validates the structure; invalid or unparseable output is an
infrastructure error, not an approval.

Invocation is the `pr-preship-review` CLI command, one agent call per planned
PR slice at handoff time (`--plan` takes saved `pr-split-plan --json` output;
`--all` reviews every shipping slice and skips local-only lanes). Per-slice
artifacts — `slice.diff`, `lint.json`, rendered prompts, `review.json`,
`review.md` — land under `state_dir/preship_reviews/<run-id>/<slice-id>/`.
The command fails closed: any `reject` finding, any `reject` slice verdict, or
any infrastructure failure exits 1 and blocks the handoff. Rejected symbols
follow the standard disposition — `needs_rework`, requeued at repair
priority; the slice ships without them or not at all.

## Knowledge Relationship

The platform owns historical PR data under `knowledge/sources/code_context/past_prs/data/`.
That directory contains per-PR raw slices, extracted text/diff slices,
PR-local postmortems, corpus aggregates, and the search-facing library.
Legacy mirrored PR-agent prompt material can remain there as source data, but
the canonical live PR-review agent definition is in
`packages/agents/src/pr-review/`.

The postmortem builder supports pending-only discovery. `kg-maintain` calls the
builder with `--pending-only`, so newly fetched PRs are auto-discovered from
the active PR corpus and only missing `postmortem/postmortem.json` records are queued.
Live `trigger-agent` maintenance enables the PR-review agent by default for
bounded pending batches. Direct `kg-maintain` enables model-reviewed
postmortems with `--run-pr-agent`; otherwise deterministic scaffold records
keep the corpus indexable.

The default live review runtime is provider `codex-lb`, model `gpt-5.5`, and
thinking `medium`. Root `local.env` remains supported, and selected projects can
load their configured ignored `localEnv` file so PR indexing can be attributed
separately from other projects.

PR-review output is evidence for the resource graph. It is not the final graph
writer. The past-PR graph adapter and knowledge curator ingest the generated
postmortems, attach provenance, and expose file edges, lessons, and source
update proposals.

## Key Rules

- PR-review is a named agent in the same registry as director and worker.
- PR-review prompt/schema changes should happen in the agent slice, not in
  scattered scripts.
- PR knowledge refresh utilities update the evidence library; they do not
  replace the centralized agent definition.
- PR-review records should be processed by graph ingestion/curation rather than
  mutating source corpora directly.

## Related

- [Knowledge implementation](../knowledge/00-overview.md)
- [Agent model](../../10-system-design/20-agent-model.md)
