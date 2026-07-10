# Overnight Escalation Campaign Report — Pokémon Colosseum Decomp

**Run:** `0254b3f0-3324-45f6-a627-8d13021040d7` · window ~11:35–18:14Z (~6.6h) · status: `active` (snapshot; 4 workers still in-flight)
*Produced by a 10-agent verification workflow (5 analysis dimensions + 4 adversarial verifiers + synthesis), 2026-07-01.*

## 1. Verdict

**Partial success, poor paid-ROI.** The run landed exactly **2 genuine byte-exact cracks** (`battle_waza::fn_801DD0C8`, `menu_middle::fn_8006DAE4`), both from **glm-5.2 at ladder level 0** — the cheapest, un-costed rung. Every paid escalation rung (sonnet-5, opus, fable) and the codex rung produced **0 credited cracks** while burning **$127.59** of captured Claude spend. Both wins sit **uncommitted**, interleaved with 5 non-exact "pollution" patches across 5 files, and `report.json` was never regenerated — so nothing is cleanly committable as-is.

## 2. Scoreboard

| Model (rung) | Provider | Att | Distinct tgt | Credited cracks | Byte-exact reached (gated-out) | Tokens (in/out) | Captured $ | Median s/att | Timeout | Error |
|---|---|---|---|---|---|---|---|---|---|---|
| **glm-5.2** (L0) | zai | 46 | 18 | **2** | — | NULL (SDK gap) | $0 (uncosted) | 832 | 0 | 0 |
| claude-sonnet-5 (L1) | claude-code | 40 | 14 | 0 | 0¹ | 229,900 / 940,096 | **$114.28** | 306 | 0 | 0 |
| gpt-5.5/codex (L2) | openai-codex | 40 | 14 | 0 | **3**¹ | NULL (SDK gap) | uncosted | 162 | **11** | 0 |
| claude-opus-4-8 (L3) | claude-code | 6 | 3 | 0 | 0 | 31,867 / 90,920 | $13.31 | 151 | 0 | 0 |
| claude-fable-5 (L4) | claude-code | 3 | 3 | 0 | 0 | NULL (3× failed) | $0 | — | 0 | **3** |
| **TOTAL** | | **135** | | **2** | 3 | — | **$127.59** | | 11 | 3 |

Worker outcomes (n=20): exact=2 / timeout=11 / error=3 / running=4. Cracks confirmed by two independent signals (`epoch_targets.cracked_by_model` and `worker_state.exact=1`).

**¹** The 3 gated-out byte-exacts are attributed to **codex/L2** (adversarial verdict B: each checkpoint's `validation_time` aligns within ~1s of a codex L2 session; glm-L0/sonnet-L1 produced no checkpoints for them). Attribution is circumstantial — `worker_checkpoints` has no FK to `pi_sessions`.

## 3. What happened

**Cracks (real but not durable).** Both are byte-identical (`exact_match=1`, `hard_gates_passed=1`, `selected=1`), applied clean to the working tree, substantive improvements (fn_801DD0C8 replaces raw pointer arithmetic with typed struct access). But the RUN **committed 0 times**; the wins live only as uncommitted edits (recoverable from `state/runs/0254b3f0/.../attempt-1.write_set.diff`).

**Escalation funnel — the tail cracked nothing.** 16 finished targets: 2 cracked at rung 0 (12.5%), 14 climbed. Rungs 1 (sonnet) and 3 (opus) were pure pass-through, 0 cracks. The entire paid tail (40 sonnet + 40 codex + 6 opus + 3 fable sessions) bought 0 credited cracks.

**"Fuzzy-100-stuck" — partly true, not dominant.** Of 14 exhausted: 3 hit byte-exact but were gate-rejected; ~5 sit at 99.0–99.94 (compiler-flag territory); 6 peak at only 85–94% (genuine decompilation difficulty). Flag hypothesis explains ~8/14, not the bottom 6.

**Throughput bottleneck is NOT wall-clock caps.** All 11 "timeout" workers did real work (34 compiled checkpoints, all improved fuzzy). Real killers: **serialization** (avg 0.84 concurrent vs 4 slots; 43% zero-worker wall-time incl. a 79min trim/restart stall) and **ladder burn** (88% pay the full 3-rung tax for a 12.5% payoff). Saturated 4-wide → ~13 tgt/h (~18h for the board) vs observed ~2 tgt/h → **5–6× left on the table**.

**Cost + the sonnet-5 burn.** sonnet-5 = 89.6% of captured spend ($114.28) for 0 cracks, and $99.49 of that is cache read+write (227M cache-read tokens) — prompt-caching being rebuilt rather than reused. Both wins came from the $0-captured glm lane.

**Stability — clean.** 0 in-run guardian incidents (all 2353 predate 11:35Z). 0 crash-restarts. The 12:35 trim held (0 opus/fable after 12:30).

## 4. Corrections vs the earlier headline

- **"Escalation burned attempts for nothing" → refuted.** 3 targets reached byte-exact during escalation (`fn_801D167C`, `fn_801DB088`, `GSbezierCalculateVector`) and were discarded by the hard gate (QA lint / same-unit non-repro), not model incapability. Attributed to codex/L2.
- **`fn_80112F8C` "exhausted" → wrong.** It's a genuine prior-session glm crack; its patch is uncommitted residue. The run's actual gs_field_colquery near-miss was `fn_80111864`.
- **`matched_functions=3308` "== baseline, so cracks failed" → misleading.** report.json is stale (mtime 09:57Z, pre-run, gitignored, never regenerated). 3308 = "nothing re-measured," NOT "cracks failed."
- **`exact_match=1` = crack → imprecise.** 8 exact checkpoints span 5 targets; the real criterion is `exact_match=1 AND hard_gates_passed=1 AND selected=1` → exactly 2.
- **Cost NULL assumption → corrected.** Cost IS populated for Claude models ($127.59); glm+codex (86/135 sessions) are the NULL lanes, so true cost is a floor.

## 5. Root cause: why escalation cracked nothing

**Primary — a selection/hard-gate defect, not model capability.** A byte-identical objdiff match does NOT crack a target; passing the QA-clean hard gate does. Both real cracks needed **two** byte-exact attempts: att_0 came back `qa=warnings` → gate-fail; att_1 was a **repair to `qa=clean`** → selected. The ≥3 escalation byte-exacts (incl. `fn_801DB088`, which was even `qa=clean` but failed same-unit re-validation) never got that clean repair, so they escalated and exhausted. **Already-achieved byte-exact wins were thrown away by the gate.**

**Secondary — compiler-matching wall on the near-100 tail.** ~5 exhausted targets sit at 99.0–99.94% (per the MWCC compiler-map memory, likely need correct per-library MWCC version / reg-alloc / literal-pool nudges). No ladder rung addresses this; more compute won't convert them.

**Structural — the ladder is inverted for this failure mode.** Expensive paid models sit *above* the only productive rung (free glm@L0). Since the bottleneck is gating + compiler-matching (not raw capability), escalation pays premium rates for 0% yield.

## 6. Recommendations (ranked)

1. **FIX THE HARD GATE FIRST — highest leverage, converts wins already in hand.** Investigate why QA-lint findings on byte-identical output hard-block selection, and why `fn_801DB088` failed same-unit re-validation despite `qa=clean`. Standardize the auto-repair-to-clean-then-select loop that worked for the 2 real cracks. Likely recovers ≥3 cracks with **zero additional model spend**.
2. **CAPTURE THE 2 DURABLE WINS.** Tree not committable as-is: (a) revert pure pollution (`gs_render.c` entirely, `hsd_cobj.c` delta); (b) revert `fn_80111864` in gs_field_colquery.c, `fn_8006BB34` in menu_middle.c, drop the 84% `fn_80195A6C` edit; (c) rebuild + **regenerate report.json** to prove the cracks byte-match once layered; (d) commit. Source `.diff`s persist under `state/runs/0254b3f0/`.
3. **PAUSE / DEMOTE THE PAID LADDER.** 0 credited cracks for $127.59. Add early-exit when glm@L0 plateaus (byte-exact-but-gated, or fuzzy stalls) instead of escalating into paid rungs. Route >99% near-misses to a compiler-matching specialist (MWCC version per compiler-map), not the whole ladder.
4. **KILL THE SONNET-5 CACHE BURN.** 89.6% of spend, ~$99.49 cache, 0 cracks. Fix prompt-caching/context reuse or drop sonnet from the ladder.
5. **FIX SCHEDULER SERIALIZATION.** 0.84 concurrent vs 4 slots, 43% idle → ~5–6× speedup, no model change. Lower priority than the gate (crack-rate is gate-bound, not compute-bound) but needed to clear the 240-of-256 remaining board (~4–5 days at serial pace).
6. **CLOSE THE TOKEN-CAPTURE GAP.** glm(zai)+codex(openai-codex) = 86/135 sessions log NULL; true cost unknown. Fix the SDK adapters before any $/crack decision.
7. **RETRY THE 3 FABLE-CRASHED TARGETS.** All 3 errored via infra ("Claude Code exited with code 1"), zero real attempts, silently burned at L4.

**Bottom line:** don't spend more on the paid tail until the gate is fixed and the wins are captured. The only lane with positive yield this run was free.
