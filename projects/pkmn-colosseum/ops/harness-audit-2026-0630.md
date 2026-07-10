# Harness uncommitted-changes audit — 2026-06-30

Repo: `/Users/douglaswhittingham/gamecube-decomp-harness` (branch `main`, up to date with origin).
Scope: STRICT READ-ONLY audit of all uncommitted/untracked working-tree changes. No edits, no staging,
no fleet interaction. Live run `618e1435` and the `gamecube-harness` tmux/job-runner were not touched.

## Typecheck

- `bun x tsc --noEmit` at harness root: **PASS (exit 0)**. The root `tsconfig.json` `include` is
  `apps/server/src/**/*.ts`, `apps/frontend/src/**/*.ts`, `apps/server/tests/**/*.ts` — note it globs
  `.ts` only, so it covers `read-model.ts`, the tool-wiring files, `chart-model.ts`, and `types.ts`,
  but NOT the `.tsx` components.
- `bun x tsc --noEmit -p apps/frontend/tsconfig.json` (covers the `.tsx`): **PASS (exit 0)**.
- The pre-existing `bun run check` root-`scripts/` policy failure was not run / is ignored per the
  audit brief.

Net: every changed file type-checks clean.

## Change inventory (12 modified, 6 untracked paths)

Modified: 5 frontend progress-panel files, `read-model.ts`, worker `agent.ts`, 3 tool-wiring files
(`wrappers/metadata/profiles`), `overnight-lanes.sh`, `registry.json`.
Untracked: `research/seedcoder_v3/` (tool.json + api/propose.py + a stray `__pycache__`), three ops
`.md` docs, and `recovery-reports/` (11 `.md`).

---

## Group A — seedcoder_v3 toolpack + server tool wiring — COMMIT (sound)

Files: `toolpacks/gamecube-decomp/research/seedcoder_v3/{tool.json,api/propose.py}`,
`toolpacks/gamecube-decomp/registry.json`, `apps/server/src/core/tools/wrappers/capabilities.ts`,
`.../metadata/capabilities.ts`, `.../profiles/defaults.ts`,
`apps/server/src/core/agent-catalog/agents/running/worker/agent.ts`.

### Proposal-only confirmation — TRUE
`propose.py` only READS: `build/GC6E01/report.json`, `objdiff.json`, the unit `.o`, and a source-file
window; it emits JSON to stdout. There are no `open(..., "w")`, no writes, no patching. Policy string
`"proposal_policy": "external_hint_only_validate_before_editing"` is set (propose.py:232).
`registry.json` declares `"mutates_source": false`, `"blocks_on_failure": false`; `tool.json` sets
`"trust_tier": "external_hint"`, `"operation_mode": "external_model_hint"`, and status text "It never
writes source." Consistent everywhere.

### Security review — SAFE for proposal-only use, with minor notes
- **No shell / no eval.** The one subprocess call is `subprocess.run([objdump, "-d",
  f"--disassemble={function}", str(target_obj)], ...)` (propose.py:99-105) — argv array, no
  `shell=True`. The server side spawns the script via `Bun.spawn(["python3", scriptPath, ...args])`
  (`resolver.ts:366`, `infrastructure/shell/run-command.ts:12`) — argv array, no shell. LLM-supplied
  params (`function`, `draft`, `diff`, `server`) are discrete argv elements, so **no shell/argument
  injection** is possible. `--disassemble={function}` glues the symbol to a flag, so a leading `-`
  cannot smuggle a new objdump option.
- **No secret/token leakage.** The only HTTP header is `Content-Type: application/json`; no auth
  header, no env token is read or forwarded. Nothing sensitive in the payload beyond target asm +
  a source-context window.
- **Network is bounded.** Single POST to `DEFAULT_SERVER = http://100.116.145.17:8780/gen`
  (propose.py:16), timeout clamped 10-900s, and `n`/`temp`/`max_new` are clamped both in the wrapper
  (`boundedNumber`, `Math.min/max`) and again in `main()` (propose.py:213-216).
- **Minor concern 1 (SSRF/exfil surface):** `--server` (and `SEED_SERVER` env) let the caller
  redirect the POST — which carries the target assembly and a source-code window — to an arbitrary
  URL (propose.py:169; wrapper passes `server` through, wrappers/capabilities.ts). Data sensitivity is
  low (GC6E01 decomp asm/source, not secrets), but if you want defense-in-depth, allowlist the host
  or drop the override.
- **Minor concern 2:** `resp.read()` (propose.py:158) has no size cap — a compromised/oversized server
  response could balloon memory. Trusted Tailscale host today; low risk.
- **Minor concern 3:** `source_path` from report metadata is joined as `repo_root / source_path`
  without a traversal guard (propose.py:117). Source is a trusted DTK build artifact, so low risk.

### Wiring trace — a worker DOES see `seedcoder_v3_propose`
Complete vertical slice, all consistent:
1. `registry.json` registers tool id `seedcoder_v3` (research, `mutates_source:false`). Parses OK.
2. `tool.json` present, parses OK.
3. `wrappers/capabilities.ts`: `seedcoderV3ProposeToolRegistration = knowledgeApiTool({ id:
   "seedcoder_v3_propose", toolId: "seedcoder_v3", scriptName: "propose.py", ... })`, and it is added
   to the exported `capabilityToolRegistrations` array.
4. `metadata/capabilities.ts`: `seedcoder_v3_propose` added to `capabilityToolPromptMetadata`
   (`type: "external_hint"`).
5. `profiles/defaults.ts`: `seedcoder_v3_propose` added to `defaultWorkerToolProfile`.
6. `worker/agent.ts`: `"seedcoder_v3_propose"` added to the worker's allowed-capability list.
7. Runtime resolution: `apiRoot = resolve(toolRoot, "api")` (`resolver.ts:258`) → script resolves to
   `research/seedcoder_v3/api/propose.py`, which exists.

JSON validation: `registry.json`, `tool.json`, and `python3 -m py_compile propose.py` all pass.

**Recommendation: COMMIT.** Exclude the untracked `research/seedcoder_v3/api/__pycache__/` bytecode.

---

## Group B — frontend progress-panel rework — COMMIT (complete-and-safe), ships WITH Group C

Files: `progress-panel/index.tsx`, `_components/timeline-chart.tsx`, `_components/mark-tooltip.tsx`,
`_lib/chart-model.ts` (the +320 file), `_lib/types.ts`.

### What changed
- New `ChartMode` (`confirmed-code` | `worker-gain`) and `ChartRange` (`run` | `6h` | `24h` | `all`)
  plus a `ChartDetailRow` type (`types.ts`).
- `chartModel()` refactored from a single confirmed-code series into two series builders:
  `confirmedCodePoints()` (full-board rebuild measurements, unchanged semantics) and new
  `workerGainPoints()` (cumulative accepted per-worker delta, so tentative gains show before the next
  checkpoint rebuild). Shared `makeScale`, `visiblePoints`, range windowing, and **multi-segment**
  line rendering keyed by `segmentId` (so historical-run points don't draw a false connecting line
  across run boundaries in `6h/24h/all`).
- `TimelineChart` signature gains `mode`/`range` props and renders `lineSegments`/`areaSegments`
  arrays instead of a single `linePoints`/`areaPoints`. `mark-tooltip.tsx` now renders
  `mark.valueLabel`/`diffLabel`/`metricLabel` plus `detailRows`.
- `index.tsx` adds mode/range segmented-button tabs, `recommendedMode()` (defaults to worker-gain when
  confirmed delta is ~0 but worker gain is positive), and passes props down. It is the only caller of
  `TimelineChart`.

### Assessment
Client-side only, defensively guarded (`numberValue`, `text`, `Number.isFinite`, `asObject`). Both
typechecks pass. `linePoints`/`areaPoints` are retained on the model for back-compat even though the
component now uses the segment arrays. Internally consistent and complete — not half-finished.

**Coupling:** `workerGainPoints()` reads `improvement.integrationStatus`, `.integrationDisposition`,
`.sourcePath`, `.exactMatches`, `.totalDelta`/`.bestDelta` — the exact fields Group C adds to the
read-model. Committing B without C would make those tooltip rows render "n/a". **B depends on C; ship
them together (or C first).**

**Recommendation: COMMIT together with Group C.**

---

## Group C — dashboard read-model.ts — NEEDS-FIX (fan-out) then commit with B

File: `apps/server/src/application/dashboard/read-model.ts`.

### What changed
1. The worker-state query gains `LEFT JOIN worker_output_integrations AS integration ON
   integration.worker_state_id = worker_state.id` and selects `integration.{id,status,disposition,
   failure_reasons_json}` (read-model.ts:515-523), surfaced as a per-worker `integration` object
   (read-model.ts:606-611).
2. `improvementRowsFromWorkerStates()` now (a) drops any worker whose `integrationStatus` is set and
   is not `applied`/`pending`/`applying` (read-model.ts:924), and (b) stamps `integrationStatus` /
   `integrationDisposition` onto each improvement row.

The referenced table/columns are real: `worker_output_integrations` is defined in
`storage/ddl.ts:276` and `storage/schema.ts` with `worker_state_id`, `status`, `disposition`,
`failure_reasons_json`. So the query will not throw at runtime.

### Two things to flag
- **Behavioral scope is wider than the new chart.** `improvementRowsFromWorkerStates()` feeds
  `runSummary()` (read-model.ts:1716) and the summary aggregates: `totalPositiveDelta`,
  `improvedSymbols`, `improvedFiles`, `positiveAttempts`, `exactMatches` (read-model.ts:1036-1060,
  1515-1530). So the new integration-status filter changes **existing** dashboard numbers — improvements
  whose integration was rejected/reverted/conflict now disappear from the totals, not just from the
  new worker-gain series. This is a defensible semantic ("count what integrated or is in flight"), but
  it is a live-dashboard behavior change, not purely additive.
- **BUG / latent double-count — LEFT JOIN fan-out.** `worker_output_integrations` is UNIQUE only on
  `worker_checkpoint_id` (`schema.ts` `uniqueIndex(...worker_checkpoint_id)`, `ddl.ts:302
  UNIQUE(worker_checkpoint_id)`). `worker_state_id` is `NOT NULL` but **non-unique** (`ddl.ts:282`),
  and integration rows are inserted per checkpoint (`enqueueWorkerOutputIntegration` dedups on
  `worker_checkpoint_id`, `worker-output-integration.ts:146`). A worker_state that persists across
  epochs and has more than one integrated checkpoint therefore has multiple integration rows, so the
  bare `LEFT JOIN ... ON integration.worker_state_id = worker_state.id` **fans the worker_state row
  out into duplicates** — inflating the worker list, the improvement rows, and every summary total.
  The query already solves this shape for the `latest` checkpoint via a correlated `SELECT ... ORDER
  BY ... LIMIT 1` subquery (read-model.ts:524-530); the integration join should use the same
  single-row-per-worker_state pattern (e.g. join to the latest/applied integration id) or `GROUP BY
  worker_state.id`. Incidence today depends on how often one worker_state produces multiple integrated
  checkpoints (likely uncommon), so it is latent, not obviously firing.

**Recommendation: NEEDS-FIX** (collapse the integration join to one row per worker_state) **before
committing**, then **commit together with Group B**. If committed as-is, add a tracking note; do not
rely on the improvement/summary counts for benchmarking until the fan-out is fixed.

---

## Group D — overnight-lanes.sh — COMMIT (safe, ops-only)

File: `projects/pkmn-colosseum/ops/overnight-lanes.sh`.

Adds `ENABLE_CLAUDE="${ENABLE_CLAUDE:-0}"` and gates `claude_scheduler &` behind
`if [[ "$ENABLE_CLAUDE" == "1" ]]`, else logs "Claude lane disabled" (mirrors the existing
`ENABLE_DEEPSEEK` pattern). Net behavior change: the Claude lane is now **OFF by default** and must be
opted in with `ENABLE_CLAUDE=1`. Sensible (Claude lane is the costly/subscription lane) and low-risk.

**Recommendation: COMMIT as its own ops-scoped commit**, separate from the server/frontend changes.

---

## Group E — untracked files

- `escalation-telemetry-design-2026-0630.md`, `claude-handoff-2026-06-30-seedcoder-v3.md`,
  `recovery-plan-2026-0630.md`, and `recovery-reports/*.md` (11 files) — pure ops/design documentation,
  no code impact. **Commit or keep local at your discretion**; if committed, put them in a docs commit.
- `research/seedcoder_v3/api/__pycache__/propose.cpython-314.pyc` — Python bytecode build artifact.
  **Do NOT commit;** ignore it (or add `__pycache__/` to `.gitignore`).
- This audit file itself is untracked.

---

## Collision check vs incoming telemetry + model-escalation feature

Per `escalation-telemetry-design-2026-0630.md` (Track B telemetry additive/first; Track A escalation
behind a flag; telemetry DB `projects/pkmn-colosseum/state/orchestrator.sqlite`):

- **Group C directly intersects Track B.** The telemetry/benchmark track measures accepted
  improvements and deltas — the very aggregates Group C both re-filters (integration status) and can
  inflate (fan-out). Fix the fan-out and settle the filter semantics BEFORE wiring benchmark numbers,
  or Track B will report inflated/shifted gains.
- **Group A vs Track A is adjacency, not conflict.** Both touch worker config
  (`worker/agent.ts` tool list here; escalation logic lands in `worker-cycle.ts`/`worker-state.ts`).
  No semantic collision — just expect these edits to sit near each other.
- **Group D** is orthogonal to both.

## Suggested commit split (all harness-repo commits, none touch the pkmn-colosseum game-repo source)

1. **Group A** — seedcoder_v3 toolpack + tool wiring (registry.json, tool.json, propose.py, wrappers /
   metadata / profiles / worker agent.ts). Exclude `__pycache__`.
2. **Groups B + C together** — frontend progress-panel + read-model integration fields, **after** the
   Group C fan-out fix.
3. **Group D** — overnight-lanes `ENABLE_CLAUDE` gate.
4. **Group E (optional)** — ops/design docs.
