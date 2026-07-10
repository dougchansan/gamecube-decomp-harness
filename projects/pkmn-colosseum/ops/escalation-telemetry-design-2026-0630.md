# Iterative Model-Escalation Scheduling + Telemetry/Stats — Implementation Design

Target repo: `/Users/douglaswhittingham/gamecube-decomp-harness` (harness).
Telemetry DB: `projects/pkmn-colosseum/state/orchestrator.sqlite` (NOT `graph/graph.sqlite`).
All source paths below are under `apps/server/src/` unless noted. Active live run: `618e1435`.

This design is split into two independently shippable tracks. **Track B (telemetry) can and
should land first** — it is additive, low-risk, and makes Track A (escalation) measurable. Track A
changes live scheduler control flow and is the risky part; it ships behind a flag.

---

## Guiding decisions (baked into this design)

1. **Escalation control lives in the WORKER, not the run-loop.** The run-loop spawns *generic*
   workers and does not know which target a worker will claim (the worker self-claims after spawn
   at `worker-cycle.ts:1305`). Putting rung-selection in `run-loop.workerCommand()` would require a
   pre-claim/peek. The worker already holds the claimed target and its ladder level, so the model
   decision is a purely local change there. The run-loop keeps spawning generic workers; its fixed
   `--provider/--model` become the *level-0 fallback* only.
2. **The rung is derived, not stored on a new required column.** The rung index for a target =
   count of prior non-exact `worker_state` rows for that target_key in this run. That is already in
   the DB, so escalation works even with zero schema change (MVP). We still add
   `epoch_targets.model_ladder_level` as an explicit cache + `pi_sessions.escalation_level` for
   clean benchmarking, but correctness does not depend on them.
3. **Re-admission uses the existing, proven primitive.** `closeWorkerState(..., epochTargetStatus:
   "admitted")` already returns a target to the claimable pool (`worker-state.ts:591-592`,
   precedent `recover-claims.ts:94-121`). The escalation change is: on non-exact, pass
   `"admitted"` instead of the current implicit `"finished"` — until the ladder is exhausted.
4. **Cost = quota/latency, not dollars.** codex/claude are subscription OAuth; zai/deepseek carry
   `cost:{0,0}` in models.json. We still capture token counts (they are the real scarce resource +
   the benchmark currency); `cost_usd` is populated only where the provider reports it
   (claude-code `total_cost_usd`), else NULL.

---

# TRACK A — Iterative Model-Escalation Scheduling

## A0. Ladder config shape

New file `projects/pkmn-colosseum/ladder.json`, loaded once per run. TypeScript shape lives in a
new `core/session-runtime/escalation/ladder.ts`:

```ts
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface RungBudget {
  agentTimeoutSeconds: number;   // -> runPiAgent timeoutMs
  ttlSeconds: number;            // -> claim hold (claimNextEpochTarget ttl)
  maxAttempts: number;           // per-rung repair-loop cap (see A4)
}
interface LadderRung {
  provider: string;              // -> runPiAgent.provider
  model: string;                 // -> runPiAgent.model
  thinking: ThinkingLevel;       // -> runPiAgent.thinkingLevel
  budget: RungBudget;
  targetFilter?: { minSize?: number; maxSize?: number; minFuzzy?: number; maxFuzzy?: number };
}
type LadderMode = "escalation" | "full-matrix" | "hybrid";
interface LadderConfig {
  id: string;
  mode: LadderMode;
  hybridSampleRate?: number;     // full-matrix probability for a target when mode=hybrid (0..1)
  rungs: LadderRung[];
}
```

Weak→strong rung order (from `providers-models.md §5`): glm-5.2/low → deepseek-v4-flash/off →
deepseek-v4-flash/high → glm-5.2/xhigh → claude sonnet/low → sonnet/high → codex gpt-5.5/medium →
gpt-5.5/high → gpt-5.5/xhigh → gpt-5.2-codex/high. SeedCoder is NOT a rung — it is the existing
proposal-only `seedcoder_v3_propose` tool available inside every rung.

The current fleet = N degenerate 1-rung ladders partitioned by size band. This collapses them into
one per-function escalation and can be rolled out lane-by-lane (a lane with `rungs.length===1` is
behaviorally identical to today).

## A1. Rung selection (the core function)

New `core/session-runtime/escalation/select-rung.ts`:

```ts
// failedAttempts = COUNT(worker_state WHERE session_id=:runId AND target_key=:k AND exact=0)
function pickRung(ladder: LadderConfig, failedAttempts: number): { index: number; rung: LadderRung } {
  const index = Math.min(failedAttempts, ladder.rungs.length - 1);
  return { index, rung: ladder.rungs[index] };
}
function ladderExhausted(ladder: LadderConfig, failedAttempts: number): boolean {
  return failedAttempts >= ladder.rungs.length - 1; // at/over last rung -> stop after this run
}
```

The `failedAttempts` count query (evidence `providers-models.md §6`):
```sql
SELECT COUNT(*) FROM worker_state
WHERE session_id = :runId AND target_key = :targetKey AND exact = 0;
```

## A2. Hook point — consume the rung in the worker

**File:** `core/session-runtime/phases/running/workers/worker-cycle.ts`
**Function:** `runWorkerCycle`, at the `runPiAgent({...})` call — currently `:1405-1416`.

After the target is claimed (`claimNextEpochTarget` at `:1305`, `claimed.target` / `claimed.targetKey`
in scope), compute the rung once per worker cycle:

```ts
const ladder = loadLadder(globals);                 // cached module-level, reads ladder.json
const failedAttempts = countNonExactWorkerStates(store, runId, claimed.targetKey);
const { index: escalationLevel, rung } = pickRung(ladder, failedAttempts);
```

Then replace the three fixed knobs in the `runPiAgent` call (`:1413-1416`):

```ts
provider:     rung.provider,        // was globals.provider
model:        rung.model,           // was globals.model
thinkingLevel: rung.thinking,       // was globals.thinkingLevel
timeoutMs:    rung.budget.agentTimeoutSeconds * 1000,   // was globals.agentTimeoutSeconds*1000
```

Guard behind `globals.escalationEnabled` (new `--escalation` flag, default OFF): when off, keep
`globals.provider/model/thinkingLevel` exactly as today. This makes the change a no-op for
un-migrated lanes and de-risks the live run.

`providerWorkerPromptGuidance(globals.provider)` at `:1404` must become
`providerWorkerPromptGuidance(rung.provider)` so the per-provider prompt matches the rung's model.

## A3. Hook point — re-admit on non-exact (working around the per-session target guard)

**File:** `worker-cycle.ts` `closeWorkerState(...)` call at `:1776-1782` (currently passes no
`epochTargetStatus`, so it defaults to `"finished"` at `worker-state.ts:555` for BOTH exact and
timeout — this is why a non-match is never re-attacked today).

Change to:
```ts
const exhausted = ladderExhausted(ladder, failedAttempts);
const reAdmit = globals.escalationEnabled
  && ladder.mode !== "escalation-off"
  && lifecycleStatus === "timeout"        // non-exact, non-infra-error
  && !exhausted;
closeWorkerState(store, {
  workerStateId: claimed.workerStateId,
  lifecycleStatus,
  timeoutSummary: lifecycleStatus === "timeout" ? summaryText : null,
  errorSummary: lifecycleStatus === "error" ? summaryText : null,
  summary: workerStateSummary,
  epochTargetStatus: reAdmit ? "admitted" : "finished",   // NEW
});
```

Why this bypasses the `existingTargetKeys` admission guard: that guard
(`epochs.ts:121-139`) only blocks *board re-admission across epochs* of an already-present
target_key. Setting `epoch_targets.status='admitted'` on the SAME row (`worker-state.ts:592`) makes
it immediately re-claimable within the current epoch by the next generic worker — no new admission
needed, exactly like `recover-claims.ts:94-121` already does. The next worker to claim it runs
`countNonExactWorkerStates` again, gets `failedAttempts+1`, and picks the next rung up. Loop
terminates when `ladderExhausted` → close as `"finished"`.

- `lifecycleStatus === "error"` (infra/provider failure) is NOT a rung failure → do NOT bump the
  ladder; let existing recovery/`recover-claims` re-run the SAME rung. (Provider failures already
  pause the pool at `run-loop.ts:1044-1056`.) This prevents an outage from silently burning the
  whole ladder.

## A4. Per-rung budget (optional, second increment)

`rung.budget.ttlSeconds` and `maxAttempts` are enforced inside the worker: TTL is read at claim
(`worker-cycle.ts:1298,1375`); the repair-loop caps (`WORKER_ATTEMPT_TAIL_POLICY`,
`worker-cycle.ts:394-410`) are currently code-constants. To honor per-rung `maxAttempts`, thread
`rung.budget.maxAttempts` into the attempt-loop bound at `:1376`. Ship this AFTER A2/A3 work —
it is a refinement, not required for escalation to function.

## A5. Record which model cracked it

Two layers:
- **Derivable with zero schema change** (works day one): join the exact `worker_state` to its
  `pi_sessions` — `SELECT ps.provider, ps.model FROM worker_state ws JOIN pi_sessions ps ON
  ps.target_claim_id = ws.target_claim_id WHERE ws.exact=1` (`scheduler-worker.md (c)`).
- **Denormalized cache** (Track B schema): at the exact-accept transition, set
  `epoch_targets.cracked_by_provider/cracked_by_model/cracked_at_escalation/tokens_to_crack/
  time_to_crack_ms`. Best written in the same `closeWorkerState` path when `lifecycleStatus==="exact"`,
  reading the winning claim's `pi_sessions` and summing tokens for that target_key across all its
  prior claims.

## A6. The three modes

All three are the SAME re-admit machinery; only the **stop condition** differs. Selected by
`ladder.mode` and a per-target `benchmark_mode` decided at first admission:

| Mode | Stop condition (in A3) | Cost | Use |
|---|---|---|---|
| **escalation** | stop as soon as `lifecycleStatus==='exact'` OR ladder exhausted. Re-admit only on timeout. | cheap | production: reserve strong models for hard fns |
| **full-matrix** | NEVER stop on exact — always re-admit until every rung has one `worker_state` for this target (track a bitmask of rungs attempted). | expensive (N× per fn) | complete per-model benchmark grid |
| **hybrid** | escalation for all; but a `hybridSampleRate` fraction of targets are flagged `benchmark_mode='full-matrix'` at admission and run the full grid. | moderate | escalate generally + dense benchmark on a sampled hard subset |

Implementation of full-matrix stop: replace the "stop on exact" test with "stop when all rungs
tried". Track tried-rungs as the set of distinct `escalation_level` values already present in
`pi_sessions` for this target_key (or a `rungs_attempted` bitmask column on `epoch_targets`). In
full-matrix, `reAdmit = !allRungsTried` regardless of exact.

Hybrid sampling: at first admission of a target, roll `Math.random() < hybridSampleRate` (seed by
target_key hash for reproducibility) → set `epoch_targets.benchmark_mode`. Bias sampling toward
"hard" (low `baseline_score`) targets so the expensive grid lands where model differences matter.

---

# TRACK B — Telemetry / Stats Layer

## B1. Schema additions (idempotent, via `ensureColumn` at `ddl.ts:409-417`)

Append to the `ensureColumn(...)` block at the end of the migration (mirror new cols in
`storage/schema.ts` drizzle defs + `NewPiSessionRow`):

```sql
-- pi_sessions: per-agent-invocation tokens / cost / rung / per-call duration
ensureColumn "pi_sessions" "input_tokens"        "INTEGER"
ensureColumn "pi_sessions" "output_tokens"       "INTEGER"
ensureColumn "pi_sessions" "cache_read_tokens"   "INTEGER"
ensureColumn "pi_sessions" "cache_write_tokens"  "INTEGER"
ensureColumn "pi_sessions" "cost_usd"            "REAL"
ensureColumn "pi_sessions" "attempt_index"       "INTEGER"
ensureColumn "pi_sessions" "escalation_level"    "INTEGER"
ensureColumn "pi_sessions" "ended_at"            "TEXT"

-- epoch_targets: escalation ladder + "who cracked it" benchmark keys
ensureColumn "epoch_targets" "model_ladder_level"     "INTEGER"   -- explicit rung cache (A2)
ensureColumn "epoch_targets" "benchmark_mode"         "TEXT"      -- 'escalation'|'full-matrix'
ensureColumn "epoch_targets" "rungs_attempted"        "INTEGER"   -- bitmask for full-matrix stop
ensureColumn "epoch_targets" "cracked_by_provider"    "TEXT"
ensureColumn "epoch_targets" "cracked_by_model"       "TEXT"
ensureColumn "epoch_targets" "cracked_at_escalation"  "INTEGER"
ensureColumn "epoch_targets" "tokens_to_crack"        "INTEGER"
ensureColumn "epoch_targets" "time_to_crack_ms"       "INTEGER"

-- save_points: promote data/function percents for over-time charts (data already in payload_json)
ensureColumn "save_points" "matched_data_percent"      "REAL"
ensureColumn "save_points" "matched_functions_percent" "REAL"
```

Plus one new append-only table for dense match-over-time (epoch snapshots are only ~6/run):

```sql
CREATE TABLE IF NOT EXISTS report_snapshots (
  id                        TEXT PRIMARY KEY,
  run_id                    TEXT NOT NULL,
  at                        TEXT NOT NULL,
  source                    TEXT NOT NULL,          -- 'epoch' | 'save_point' | 'periodic'
  fuzzy_match_percent       REAL,
  matched_code_percent      REAL,
  complete_code_percent     REAL,
  matched_data_percent      REAL,
  matched_functions_percent REAL,
  complete_units            INTEGER,
  total_units               INTEGER,
  report_path               TEXT
);
CREATE INDEX IF NOT EXISTS report_snapshots_run_at ON report_snapshots (run_id, at);
CREATE INDEX IF NOT EXISTS pi_sessions_claim_model ON pi_sessions (target_claim_id, model);
```

`ensureColumn` is idempotent (`ddl.ts:8-11`) so this is safe to run against the LIVE
`orchestrator.sqlite`; adding NULLable columns does not rewrite existing rows.

## B2. Write-point 1 — surface token usage out of the agent runtime

**File:** `infrastructure/agent-runtime/runtime/pi-agent.ts`.
**Type change:** add to `PiRunResult` (`core/shared/types/pi.ts:3-18`):
```ts
usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number;
          cacheWriteTokens?: number; costUsd?: number };
endedAt?: string;
```

- **Pi SDK path:** the `agent_end` handler at `:155-162` already reads
  `event.messages.at(-1).usage.input/output`. Hoist those into a closure var
  (`let lastUsage`) captured in `attachPiLifecycleLogger`, and return it in `PiRunResult.usage`
  from `runPiAgent`. Set `endedAt = new Date().toISOString()` at return.
- **claude-code path:** `runClaudeCodeAgent` (`:334-447`) parses the `claude -p` JSON but ignores
  `parsed.usage` / `parsed.total_cost_usd`. Read `parsed.usage.{input_tokens,output_tokens,
  cache_read_input_tokens,cache_creation_input_tokens}` and `parsed.total_cost_usd` into
  `result.usage`.

This is pure plumbing — the tokens are already observed; nothing new is measured. The optional
external agent-kernel Postgres (`tailer.ts:410-482`) is NOT wired into this fleet
(no `ORCH_AGENT_KERNEL_DATABASE_URL`); we bypass it and land tokens directly in
orchestrator.sqlite. Leave the tailer untouched.

## B3. Write-point 2 — persist in addPiSession

**File:** `core/session-runtime/run-state/pi-sessions.ts:5-39`. Extend `addPiSession` params +
`.values({...})` with `inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/costUsd/
attemptIndex/escalationLevel/endedAt`.

**Caller:** `worker-cycle.ts:1471-1483` — pass `result.usage.*`, `attemptIndex` (already in scope
at `:1430`), `escalationLevel` (from A2), and `result.endedAt`. Keep `provider/model/thinkingLevel`
= the RUNG's values (not `globals.*`) when escalation is on, so the recorded model matches what
actually ran.

## B4. Write-point 3 — cracked-by + tokens-to-crack denormalization

In the `closeWorkerState` path (A3) when `lifecycleStatus==='exact'`, before closing, compute and
set on `epoch_targets`: `cracked_by_provider/model` = the winning rung; `cracked_at_escalation` =
`escalationLevel`; `tokens_to_crack` = `SUM(input_tokens+output_tokens)` across ALL `pi_sessions`
for every claim on this target_key this run; `time_to_crack_ms` = first-claim `started_at` →
this `ended_at`. Cheapest as a small SQL UPDATE inside the same `immediateTransaction`.

## B5. Write-point 4 — report_snapshots

At each epoch save-point (where `save_points` is written — the `runningEpochHistory` producer,
`phases/running/epochs/projection.ts` and `read-model.ts:255-316 loadCurrentBoard`), also insert a
`report_snapshots` row from the same `payload.measures` block (which already carries
`matched_code/matched_data/matched_functions_percent` + totals — `telemetry.md §4`). Optionally add
a lightweight periodic writer (e.g. on each fast-refresh `epoch_fast_refresh_finished` event) for
denser lines. Also promote `matched_data_percent`/`matched_functions_percent` onto the `save_points`
insert (columns added in B1).

## B6. Read-model + dashboard

**Server** (`application/dashboard/read-model.ts`):
- Extend `piSessionsForRun()` (`:1112-1138`) to select the new token/cost/escalation columns.
- Add a new aggregation `modelBenchmark(runId)` — the leaderboard rollup:
```sql
SELECT ps.provider, ps.model, ps.thinking_level,
       COUNT(DISTINCT ws.target_claim_id)                    AS attempts,
       SUM(ws.exact)                                         AS exacts,
       1.0*SUM(ws.exact)/COUNT(DISTINCT ws.target_claim_id)  AS success_rate,
       SUM(ps.input_tokens+ps.output_tokens)                 AS total_tokens,
       SUM(ps.cost_usd)                                      AS total_cost_usd
FROM pi_sessions ps
JOIN worker_state ws ON ws.target_claim_id = ps.target_claim_id
GROUP BY ps.provider, ps.model, ps.thinking_level;
```
  Median tokens-to-crack / time-to-crack: read `epoch_targets.tokens_to_crack` /
  `time_to_crack_ms` grouped by `cracked_by_model` (SQLite has no MEDIAN → compute in JS from the
  returned per-target rows, or approximate with AVG for v1).
- Add `reportSnapshots(runId)` reading the new table for over-time series.
- Surface `epoch_targets.cracked_by_model` + `tokens_to_crack` in the existing `workerStates`
  targets view (`read-model.ts:454-536`).

**Frontend** (uncommitted `progress-panel/_lib/chart-model.ts`):
- Add chart modes `data` and `functions` — marks already carry full `measures`
  (`types.ts:24`), so this is a frontend-only change plotting
  `matched_data_percent`/`matched_functions_percent` (no server change needed beyond feeding
  `reportSnapshots`).
- New **Model Benchmark panel** next to `progress-panel/index.tsx`: leaderboard table
  (model | attempts | success% | median tokens-to-crack | median time-to-crack | total tokens),
  plus a tokens-per-function / per-agent / per-model breakdown fed by the extended
  `piSessionsForRun`.
- `run-details-panel.tsx` per-session timeline gains a tokens + escalation_level badge.

---

## Ordering of work (dependency-ordered)

1. **B1 schema** (idempotent `ensureColumn` + `report_snapshots`). Safe against live DB. No behavior
   change. *Ship first.*
2. **B2+B3+B5 token capture** (pi-agent → PiRunResult → addPiSession; report_snapshots writer).
   Pure additive telemetry; still fixed-model-per-lane. Validates token plumbing before touching
   the scheduler.
3. **B6 read-model/dashboard** for tokens + match-over-time (data/functions) + a benchmark
   leaderboard that already works off existing model×outcome joins.
4. **A2 rung consume behind `--escalation` flag (default OFF)** + `escalation/ladder.ts` +
   `select-rung.ts` + `ladder.json`. No live impact while flag is off.
5. **A3 re-admit on non-exact** (the one control-flow change). Test on a scratch run first.
6. **B4 cracked-by denormalization** (piggybacks A3's exact path).
7. **A4 per-rung budgets** and **A6 full-matrix/hybrid** modes (refinements).
8. Cut over lanes one at a time in `overnight-lanes.sh` (start with a small size band): replace the
   fixed `--provider/--model` lane with a single `--escalation --ladder ladder.json` lane; a
   1-rung ladder reproduces current behavior for a safe A/B.

---

## Risks to the LIVE run (618e1435)

- **DDL against a hot DB.** `ensureColumn` adds NULLable columns (no table rewrite) and the tool
  already runs migrations idempotently at startup; low risk, but run during a quiet window and back
  up `orchestrator.sqlite` first. `report_snapshots` is a new table — zero risk.
- **A3 is the dangerous change.** Passing `epochTargetStatus:"admitted"` on every timeout means a
  target is re-claimed repeatedly. Failure modes: (a) infinite loop if `ladderExhausted` is wrong →
  guard with a hard cap = `rungs.length` and treat `error` (not `timeout`) as non-escalating;
  (b) board never drains / epoch never closes if too many targets keep re-admitting → watch
  `epochs.finished_count`. Keep A3 behind `--escalation`.
- **Model identity mismatch in telemetry.** If A2 runs the rung model but B3 still logs
  `globals.model`, benchmarks lie. B3 MUST log the rung's provider/model. Land A2 and B3 together
  or keep escalation off until both are in.
- **Provider-failure amplification.** A provider outage classified as `timeout` (not `error`) would
  wrongly burn a rung. Verify `classifyWorkerError` (`worker-cycle.ts:183-239`) marks endpoint
  failures as `error`; only true "ran, no exact" should escalate.
- **Concurrency race on re-admit.** Two workers could both act on the same target across the
  claim/close boundary. The existing UNIQUE `target_claims(epoch_target_id)` + closed-claim recycle
  logic (`worker-state.ts:273-336`, which throws on real selectable evidence) already guards this;
  confirm the re-admit path cannot resurrect a claim that has an exact checkpoint.
- **claude-code token/cost shape drift.** `parsed.usage` field names differ from Pi's
  `usage.input/output`; guard with optional chaining and default NULL so a parse miss never crashes
  the worker.
- **Cost is mostly meaningless** for subscription providers (all `cost:0`); do not gate any policy
  on `cost_usd`. Use token counts + quota as the real budget signal.

---

## Open questions (real decisions only)

1. **Escalation ownership final call:** worker-inline (this design, simplest) vs scheduler-driven
   re-admit in `run-loop.ts:1089-1117`. Worker-inline is recommended; scheduler-driven gives
   cleaner policy/execution separation but more moving parts. Pick one before A3.
2. **What counts as a rung "failure" that escalates?** Timeout only (recommended), or also
   partial-improvement stalls? And should `error` ever escalate after K infra retries on the same
   rung?
3. **full-matrix stop granularity:** one attempt per rung, or per-rung `maxAttempts` attempts before
   moving on? Affects benchmark denominator and cost.
4. **Hybrid sampling policy:** sample rate + whether to bias toward low-`baseline_score` (hard)
   targets, and whether the sample is fixed at admission or re-rolled per epoch.
5. **Ladder scope:** one global ladder, or per-size-band ladders (tiny fns skip codex entirely;
   large fns start higher)? The `targetFilter` field supports per-rung banding either way.
6. **report_snapshots cadence:** epoch-boundary only (sparse, cheap) vs periodic/fast-refresh
   (dense, more writes). Decide the writer trigger in B5.
7. **Median in SQLite:** compute medians in JS from per-target rows (accurate) vs AVG approximation
   in SQL (cheap) for the leaderboard v1.
