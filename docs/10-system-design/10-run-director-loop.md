---
covers: Run director responsibilities, trigger actor semantics, cycle, wake conditions, and worker report contract
concepts: [director, trigger-actor, board, queue, target-packets, wake-events, reports]
---

# Run Director Loop

The run director is the central board-level agent. It reads the current run
state, decides which target packets are most useful next, writes decisions, and
then goes idle. It does not perform source archaeology or source edits.

## Behavior

Each director cycle has four phases:

1. Board read: absorb progress, active leases, queued targets, worker reports,
   accepted facts, rejected hypotheses, duplicate groups, and recent stalls.
2. Prioritization: use helper scores and recent evidence to identify targets
   that can create useful information.
3. Delegation: emit bounded target packets and worker-slot intent.
4. Sleep: write decisions and stop until a durable event wakes the director.

The director's job is to choose the next valuable square on the board. Helper
scores can rank likely targets, but the final scheduling decision belongs to the
director because it has the full context of the run.

## Director Cycle

```text
+------------------+     +------------------+     +------------------+
| Wake event       |---->| Board snapshot   |---->| Pi director      |
| - run started    |     | - run target     |     | choose next      |
| - worker stalled |     | - indexer output |     | influence point  |
| - worker done    |     | - reducer output |     | under budget     |
| - refill needed  |     | - leases/stalls  |     | and locks        |
+--------+---------+     +------------------+     +--------+---------+
         ^                                                 |
         |                                                 v
         |                  +------------------+     +-----+------------+
         |                  | Write state      |<----| Decision bundle  |
         |                  | - queue rows     |     | - target packets |
         |                  | - lease intents  |     | - priorities     |
         |                  | - fact requests  |     | - budgets        |
         |                  | - cooldowns      |     | - cooldowns      |
         |                  | then sleep       |     | - fact packets   |
         |                  +--------+---------+     +------------------+
         |                           |
         |                           v
         +------ director inactive until another durable event wakes it
```

The cycle is intentionally short. The director does one board read, writes one
decision bundle, and exits. It is resumed by durable events rather than kept
alive as a hidden strategic loop.

The trigger actor is the non-agent process component that gives this a
resting-agent feel. It checks durable events, activates one director turn when a
wake event exists, maintains the queued target pool from board snapshots,
realizes worker-slot intent as worker processes, and then sleeps without
keeping a Pi director session alive.

The director does not directly own process spawning. It decides what should be
worked next; the trigger/runtime layer makes that process work happen under
leases.

## Epoch Queue Cycle

The trigger actor treats the queue as one epoch batch rather than a
continuously topped-up pool. Each epoch:

1. Refill fills the queue to the configured queue target from the freshest
   board ranking.
2. Workers lease and drain the batch. No new targets are inserted while it
   drains, but queued-but-not-leased targets still receive periodic priority
   refreshes from the graph-ranked board.
3. When queued work reaches zero, the epoch pipeline runs while in-flight
   workers finish: commit validated work (excluding files under active
   leases, so half-finished attempts never poison the checkpoint), rebuild
   the full objdiff report in a persistent epoch worktree, publish the fresh
   report for board scoring, record an `epoch` save point as the run's
   measured progress checkpoint, and requeue regressed functions as
   priority repair targets.
4. Refill grabs the next batch from the re-scored board and the cycle
   repeats.

The epoch boundary is therefore both the rescoring point and the progress
checkpoint: every batch is ranked against the codebase as it actually stands,
not against a stale report, and the run's history is the sequence of epoch
save points. Work still in flight when the queue empties simply counts toward
the next epoch's checkpoint.

Two safety valves shape the boundary. If one epoch regresses more report rows
than the pause threshold, the pipeline records the checkpoint but withholds
the refill and emits an `epoch_regression_pause` event instead of building on
a damaged base. If refill after a rebuild finds no fresh board work, the
trigger emits `pool_below_target` so the director can replan the long tail,
and backs off before rebuilding again.

Refill itself prefers candidates that have not already been queued, leased,
reported, or stalled in the run, and prefers distinct unlocked source paths
before adding additional functions from an already queued source. Director
target packets can requeue a previously attempted target when new facts make
it worth another pass; the epoch pipeline uses that same requeue authority for
regression repairs, while batch refill stays biased toward fresh work.

`--no-epoch-cycle` restores the legacy continuous mode, where the trigger tops
the queue back up toward the target on every pass and watermark policies
(queue low, schedulable low, active low, long tail) emit `pool_below_target`
replans as the pool runs down.

## Wake Events

The director wakes when durable state says it should act:

- A run starts.
- Active workers drop below the desired count.
- A worker finishes, stalls, asks for a fact, or produces a score candidate.
- New facts are accepted.
- A score integration changes the board.
- The run checkpoint goal is reached and the system should pause for handoff.

Workers do not need the director to be live while they work. They write reports
and events, then the runner invokes the director again when the next decision is
needed.

## Target Packets

A target packet is the director's bounded delegation contract. It should name
the target, write set, context to read first, relevant facts, rejected
hypotheses, budget, capability hints, validation expectations, and stop
conditions. The packet gives the worker enough shape to act without giving it
board-level authority.

## Worker Report Contract

A worker report should tell the board what changed:

- Progress: verified source improvement or a candidate ready for the score
  integration gate.
- Facts: reusable type, symbol, source-shape, duplicate, resource, or PR-derived
  evidence.
- Negative results: grounded hypotheses that failed and should not be repeated.
- Blockers: exact missing constraints that justify a fact-research packet.
- Stall state: evidence is exhausted and the worker should stop before random
  mutation.

The report is more important than the worker session. Future decisions consume
durable evidence, not hidden conversation state.
