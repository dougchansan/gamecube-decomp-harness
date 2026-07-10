# Harness Change Audit — gamecube-decomp-harness

Repo: /Users/douglaswhittingham/gamecube-decomp-harness (branch main, up to date with origin/main)
Date: 2026-06-30
Scope: enumerate + judge all uncommitted/untracked changes; deep-audit seedcoder_v3; judge frontend rework; run tsc.

## 0. Enumeration (git status / git diff --stat)

Modified (tracked):
- apps/frontend/.../progress-panel/_components/mark-tooltip.tsx        (+14/-)
- apps/frontend/.../progress-panel/_components/timeline-chart.tsx       (+18/-)
- apps/frontend/.../progress-panel/_lib/chart-model.ts                  (320 changed — major refactor)
- apps/frontend/.../progress-panel/_lib/types.ts                        (+21/-)
- apps/frontend/.../progress-panel/index.tsx                            (+84/-)
- apps/server/src/application/dashboard/read-model.ts                   (+18/-)
- apps/server/src/core/agent-catalog/agents/running/worker/agent.ts     (+1)
- apps/server/src/core/tools/metadata/capabilities.ts                   (+5)
- apps/server/src/core/tools/profiles/defaults.ts                       (+1)
- apps/server/src/core/tools/wrappers/capabilities.ts                   (+54)
- projects/pkmn-colosseum/ops/overnight-lanes.sh                        (+7/-1)
- toolpacks/gamecube-decomp/registry.json                              (+20)

Untracked:
- projects/pkmn-colosseum/ops/claude-handoff-2026-06-30-seedcoder-v3.md
- toolpacks/gamecube-decomp/research/seedcoder_v3/  (tool.json, api/propose.py, api/__pycache__/*.pyc)

Note: api/__pycache__/propose.cpython-314.pyc is git-ignored (.gitignore lines 59-60 `__pycache__/`, `*.pyc`), so `git add toolpacks/.../seedcoder_v3/` will NOT include it. No commit hygiene problem.

## 1. tsc

Command: `bun x tsc --noEmit` at harness root → EXIT 0, zero output. PASSES.
(`timeout` is not available on macOS; ran bun directly. `tsc` is not on PATH standalone; `bun x tsc` resolves it.)
`bun run check` NOT run; per handoff it fails on a pre-existing root-`scripts/`-dir repo-policy expectation, unrelated to any of these changes.

## 2. Group A — seedcoder_v3 toolpack (PROPOSAL-ONLY external hint)

Files: api/propose.py (new), tool.json (new), registry.json (+entry), wrappers/capabilities.ts,
metadata/capabilities.ts, profiles/defaults.ts, worker/agent.ts.

### PROPOSAL-ONLY confirmation — CONFIRMED
- propose.py performs ZERO source/file writes. It only READS report.json + objdiff.json + the unit
  source file, runs objdump to dump target asm, POSTs to the /gen endpoint, and prints JSON to stdout.
- Output payload carries `"proposal_policy": "external_hint_only_validate_before_editing"` (propose.py L232).
- tool.json: trust_tier "external_hint", operation_mode "external_model_hint", status_message "...It never
  writes source.", limitations enumerate "proposer only ... validate through DTK/checkdiff/objdiff".
- registry.json entry: mutates_source=false, process_role "trained_candidate_proposer",
  blocks_on_failure=false, agent_guidance "external hint generator only ... naturalized and validated".

### Safety audit of propose.py
- eval/exec: NONE.
- shell-out: subprocess.run uses LIST argv (shell=False) → no shell injection. objdump path is resolved
  from a fixed candidate list or shutil.which. The user-controlled `function` is embedded as the single
  argv token `--disassemble={function}`, so it cannot be split into a separate objdump flag (no argument
  injection). cwd=repo_root. SAFE.
- file writes: NONE (proposal-only).
- secret leak: NONE. Reads only ORCH_PROJECT_REPO_ROOT / SEED_SERVER env (benign config). The POST body
  contains only target asm + local source context + optional draft/diff — no credentials.
- unbounded net: bounded. Default server is a private Tailscale IP (http://100.116.145.17:8780/gen). Body
  clamped (asm 30k, context 12k chars), n 1-6, temp 0-1.5, max_new 32-3000, HTTP timeout 10-900s, objdump
  timeout 10-120s, each returned candidate clamped to 12k. Wrapper independently re-bounds the same args
  (boundedNumber n 1-6, temp clamp 0-1.5, max_new 32-3000, timeout 10-900).
- MINOR hardening note (not a blocker): `--server` is agent-overridable with no URL-scheme allowlist;
  urllib would accept non-http schemes. Only non-secret asm/context is ever sent, and a POST body on
  file:// fails, so practical risk is low. Optional follow-up: enforce http(s) on --server.

### JSON validity — PASS
python json.load on both registry.json and tool.json: "both parse OK".

### Registration end-to-end — REGISTERED (worker WILL see `seedcoder_v3_propose`)
Complete wiring chain, all present, tsc-clean:
- registry.json: toolpack id "seedcoder_v3" (category research, on_demand).
- wrappers/capabilities.ts: `seedcoderV3ProposeToolRegistration = knowledgeApiTool({ id:"seedcoder_v3_propose",
  toolId:"seedcoder_v3", scriptName:"propose.py", ... })` AND appended to exported `capabilityToolRegistrations`.
- metadata/capabilities.ts: prompt metadata keyed `seedcoder_v3_propose` (provider seedcoder_v3, type external_hint).
- profiles/defaults.ts: `"seedcoder_v3_propose"` added to `defaultWorkerToolProfile`.
- worker/agent.ts: `"seedcoder_v3_propose"` added to the worker `coreTools` list.

Recommendation: COMMIT. Complete, type-clean, proposal-only, safe. Commit with Group E (its runbook).
Must be SEPARATE from any game-repo (pkmn-colosseum) decomp source-win commits — different repo anyway.

## 3. Groups B + C — integration-aware progress panel (coupled feature)

### Group B — frontend progress-panel rework — COMPLETE-SAFE
chart-model.ts refactored from a single confirmed-code line into a model with TWO modes
("confirmed-code" full-rebuild measurements vs "worker-gain" cumulative accepted worker delta) and a
time-range selector (run/6h/24h/all). Adds per-run line SEGMENTS (segmentId) so cross-run ranges don't
draw spurious connecting lines. types.ts extends ChartMark/ChartModel (segmentId, valueLabel, diffLabel,
metricLabel, detailRows, kind "worker", lineSegments/areaSegments, mode, range, workerPointCount).
mark-tooltip.tsx renders valueLabel/diffLabel/metricLabel + detailRows (dropped now-unused `delta` import).
timeline-chart.tsx takes new required mode/range props and maps multiple line/area segments (dropped now-
unused `pct` import). index.tsx adds the mode toggle, range toggle, and a 4-stat header (Code/Worker/
Symbols/Checkpoint) with auto-recommended default mode.

Why complete-safe:
- Only consumer of TimelineChart is index.tsx (passes the new mode/range props); only consumer of
  chartModel is timeline-chart.tsx. No other callers break. Legacy linePoints/areaPoints retained.
- Every Dashboard field the UI reads EXISTS in the backend read-model: improvements[] (totalDelta,
  bestDelta, sourcePath, symbol, exactMatches, integrationStatus, integrationDisposition),
  runSummary.{matchedCodeDelta,totalPositiveDelta,improvedSymbols}, checkpointProgress.{remaining,interval},
  current.measures. integrationStatus/integrationDisposition are supplied by Group C; absent them the two
  tooltip rows simply show "n/a" (graceful degradation).
- All @/lib/format helpers imported (delta, pct, numberValue, asObject, asArray, text, clock) are exported.
- tsc --noEmit passes clean → types consistent. (No dev server run, per instructions; static analysis sufficient.)

### Group C — read-model.ts — COMMIT (with B)
Adds `LEFT JOIN worker_output_integrations` and an `integration` block {id,status,disposition,failureReasons}
per worker state, and surfaces integrationStatus/integrationDisposition on improvement rows. ALSO adds a
filter: improvement rows whose integration status is set and NOT in {applied,pending,applying} are now
EXCLUDED (hides conflict/needs_rework/blocked/resolver_failed/rejected from the improvements list).
- Safety: worker_output_integrations table exists (storage/ddl.ts CREATE TABLE IF NOT EXISTS + schema.ts),
  so the LEFT JOIN cannot throw. Helpers stringValue/stringArrayValue/asObject defined in read-model.ts. tsc clean.
- Behavioral change worth noting: the dashboard improvements list now suppresses failed/conflicting
  integrations. Deliberate and consistent with the worker-gain UI intent; just call it out to the user.

Recommendation B+C: COMMIT together — they form one "integration-aware worker-gain" feature. Separate
from the seedcoder commit and separate from any game-repo source-win commit.

## 4. Group D — overnight-lanes.sh — COMMIT

Adds `ENABLE_CLAUDE="${ENABLE_CLAUDE:-0}"` and gates `claude_scheduler &` behind ENABLE_CLAUDE==1 (else logs
"Claude lane disabled"). Matches handoff: the Sonnet/Claude lane hit a 5-hour usage cap and was pulled; the
launcher now defaults the lane OFF. Small, safe, intentional ops guard. Operational script, not source.
Recommendation: COMMIT (campaign/ops infra). Could ride with A or stand alone; keep out of source-win commits.

## 5. Group E — claude-handoff-2026-06-30-seedcoder-v3.md — COMMIT

New runbook documenting the seedcoder_v3 tool, the 3090 trained-server facts, the ENABLE_CLAUDE gate, dirty
state, and validation commands. No credentials/keys. It does embed the internal Tailscale IP (100.116.145.17)
and host name — internal infra detail, acceptable for a private repo (informational only).
Recommendation: COMMIT alongside Group A (documents A and D). Keep out of source-win commits.

## 6. Separate-commit requirement

All A-E are HARNESS-repo changes; game-repo decomp source wins live in a DIFFERENT repo
(/Users/douglaswhittingham/pkmn-colosseum), so they are already physically un-mixable. The handoff
explicitly instructs "Commit/push harness integration separately from any Colosseum source wins."
Suggested harness commit grouping (3 logical commits, none mixed with game source):
  1. A + E  — seedcoder_v3_propose tool + its runbook
  2. B + C  — integration-aware worker-gain progress panel (frontend + read-model)
  3. D      — overnight-lanes ENABLE_CLAUDE gate

## 7. Bottom line

- Nothing here is broken, dangerous, or half-finished. tsc passes. seedcoder is proposal-only and fully
  registered. The frontend rework is complete and type-safe with graceful fallback.
- Recommended action for every group: COMMIT (grouped as above). No reverts, no needs-fix blockers.
- Optional, non-blocking follow-ups: (a) add http(s) scheme guard on propose.py --server; (b) note the
  read-model improvements-filter behavior change to the user.
