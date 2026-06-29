---
covers: Worker target packet lifecycle, target claims, runner validation, checkpoints, timeout/error classification, and continuation policy
concepts: [worker, target-packet, target-claim, worker-state, checkpoints, validation, qa-lint, write-safety]
---

# Worker Lifecycle

A worker is a bounded decompilation attempt for one claimed epoch target. The
worker keeps trying to reach an exact match; the runner owns lifecycle,
validation, checkpointing, best-attempt selection, timeout handling, and final
classification.

## Lifecycle

1. Receive one target packet and active target claim.
2. Build a compact context pack from local source, report/objdiff evidence,
   resources, and PR evidence.
3. Attempt source edits or focused experiments inside the explicit write set.
4. Signal validation readiness with a compact checkpoint note, or simply reach
   a worker turn boundary for runner validation.
5. Runner validates the current workspace, records a checkpoint, and selects
   the best selectable checkpoint so far.
6. Exact checkpoints close the worker state as exact. Non-exact checkpoints
   continue the same worker conversation while budget remains.
7. Runner timeout closes with the best prior selectable checkpoint, or baseline
   if none improved. Provider, infrastructure, or tool failures close as error
   while preserving any prior selectable checkpoint.
8. The closed worker state emits a wake event for scheduler and dashboard
   follow-up.

## Worker Cycle

```text
+------------------+     +--------------------+     +------------------+
| Target packet    |---->| Collect context    |---->| Hypothesis plan  |
| - unit/symbol    |     | - report/objdiff   |     | - constraints    |
| - claim id       |     | - target asm       |     | - capabilities   |
| - stop rule:     |     | - current C        |     | - exact target   |
|   exact only     |     | - siblings         |     +--------+---------+
| - write set      |     | - headers/types    |              |
+------------------+     | - PRs/docs         |              v
                         | - checkpoints      |     +--------+---------+
                         +--------------------+     | Attempt loop     |
                                                    | - focused edit   |
                                                    | - duplicate      |
                                                    |   adaptation     |
                                                    | - experimental   |
                                                    |   search         |
                                                    | - permuter       |
                                                    |   handoff        |
                                                    | - cleanup        |
                                                    +--------+---------+
                                                             |
                                                             v
                                                    +--------+---------+
                                                    | Runner validate |
                                                    | - compile       |
                                                    | - objdiff       |
                                                    | - QA lint       |
                                                    | - baseline cmp  |
                                                    +--------+---------+
                                                             |
                                +----------------------------+----------------+
                                |                                             |
                                v                                             v
                      +---------+--------+                         +----------+-------+
                      | Continue same    |                         | Close worker    |
                      | worker session   |                         | state           |
                      | with repair      |                         | - exact         |
                      | feedback         |                         | - timeout       |
                      +---------+--------+                         | - error         |
                                |                                  +----------+-------+
                                +-------> attempt loop                         |
                                                                               v
                                                        scheduler/dashboard consume
                                                        worker-state evidence
```

The worker can loop from validation back into planning while evidence is getting
sharper and budget remains. New facts and blockers are evidence attached to the
worker state; workers do not coordinate through direct worker-to-worker chat.

## Capabilities

Capabilities are tactics available to a worker. They are not separate worker
types. A single worker can combine context packaging, type and symbol
resolution, duplicate adaptation, focused source editing, fact research,
isolated check loops, review cleanup, experimental search, and permuter handoff
when the target packet and evidence justify them.

Experimental search is opt-in. It is useful when a worker can define a bounded,
measurable matrix of source-shape variants. It should produce shards, negative
results, and learned patterns rather than unreviewable random mutations.

The full capability table and guardrails live in
[worker capabilities](45-worker-capabilities.md).

## Runner Validation

Runner validation is the source of truth for progress. The runner captures a
pre-worker baseline, diffs the claimed write set after each attempt, runs local
validation, records a checkpoint, and decides whether that checkpoint is
selectable.

A checkpoint records:

- Validation status, score before/after, delta, and exact-match flag.
- Hard-gate result, build status, QA status, objdiff status, and failure
  reasons.
- Artifact paths for validation summaries, patches, and diffs.
- Worker note metadata, facts, blockers, and post-validation feedback.

Only checkpoints that pass hard gates and improve over the worker state's
baseline are selectable. Best-checkpoint selection is deterministic: exact match
wins, then highest target score, then earliest validation time. Failed or
neutral checkpoints remain useful evidence, but they are not integration
candidates.

Runner-owned validation also runs the worker-side QA lint (the QA ship gate's
L1 layer; see [score and PR handoff](60-score-and-pr-handoff.md)). The runner
diffs the attempt's touched files against the pre-worker source snapshot and
runs the deterministic maintainer-rejection scan over that diff. Findings
become repair feedback. A score-improving attempt that re-adds or leaves a QA
finding is rejected because the finding may be what inflated the score.

Scanner infrastructure errors are recorded as blind spots rather than mass
worker failures. The PR handoff gate remains stricter and fails closed.

Global score integration happens outside the worker's local loop. A worker can
produce a selectable checkpoint, but the run baseline changes only after the
integration and epoch gates validate it.

## Worker State Outcomes

Worker state lifecycle status describes why execution ended:

- **Exact**: runner validation selected an exact checkpoint.
- **Timeout**: the runner-controlled timeout ended the attempt; the best prior
  selectable checkpoint is preserved, or baseline is selected when none
  improved.
- **Error**: a provider, infrastructure, tool, build, parse, or session failure
  blocked trustworthy evaluation. Prior selectable checkpoints remain usable.
- **Cancelled**: an operator or process-control path stopped the worker before
  normal lifecycle close.

Improvement, neutrality, regression, and exactness are validation/verdict facts,
not worker-authored stop claims. The dashboard and knowledge curator read
worker states and checkpoints rather than asking the worker to classify its own
durable outcome.

## Continuation Policy

A worker should continue while it has evidence-backed paths toward exact match
and the runner keeps the session alive. When the runner rejects a checkpoint or
accepts a non-exact checkpoint, the same worker conversation receives repair or
continuation feedback. That feedback names the validation failure, QA finding,
or non-exact score so the worker can refine without losing context.

Workers should not keep spending effort on unsupported guesses after PRs, docs,
source siblings, duplicate groups, resource evidence, and measured diff signal
stop supporting a clear next move. At timeout, the runner chooses the best
validated state rather than trusting the worker's self-assessment.
