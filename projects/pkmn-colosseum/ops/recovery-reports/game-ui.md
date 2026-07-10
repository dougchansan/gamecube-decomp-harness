# Recovery Inventory — Subsystem: game ui (menu / people / effect / sound)

Scope: `archive/previous_campaign/src/game/{menu,people,effect,sound}` + backup branch
`backup/local-master-pre-sync-20260630`. Read-only analysis. No builds run.
Date: 2026-06-30.

---

## 1. Executive summary

The game-UI subsystem is almost entirely **unrecovered in the live DTK**: of the
menu/people/effect/sound code, the only source-bearing DTK split units today are
`menu_bag.c` (6 fns, partial, **worker-owned — do not touch**), `sound.c` (2 tiny
stubs, already 100%), and a few `*_sdata2_*.c` data units. Everything else in this
subsystem is "board-invisible" in `report.json` (no source, raw asm in
auto-generated units) and therefore **currently UNMATCHED**.

The prior 3-month campaign left a large, clean, real-C corpus for this exact
subsystem in both the archive and the backup branch. After preprocessor-aware
analysis (the `#if 0 … #include "*.inc" … #else <real C> #endif` pattern is
disabled-asm-then-real-C; the active body is real C), I found:

- **872 real-C function bodies** across 29 files, **every one mapping to a
  currently-UNMATCHED DTK address** (0 already matched, 0 already in active src/,
  0 in the 12 reclaim commits — those were OS/DVD/TRK/GX/SI/VI/HSD/CRT/SDK/PPC only).
- The **backup branch** versions are the best source: they are post-fix (e.g. the
  `_GetInputValue` reloc renames are applied — 15 refs in backup `people_field.c`)
  and the dead `#if 0 .inc` reference blocks are stripped (active_inc = 0 in every
  backup file). Use backup-branch source, not the older archive snapshot.

### Why confidence is high (and what the caveat is)

Two facts make these strong byte-exact candidates rather than guesses:

1. **`config/GC6E01/symbols.txt` is byte-identical to the campaign's
   `symbols.build.txt`** (verified `diff` → IDENTICAL, both 937,513 B), and the
   campaign's canonical names (`_GetInputValue`, `ReverbHICreate`, `sndBSearch`,
   `_msgctrlSideName__FP15FightOutPokemonUc`, …) are already present in the DTK
   `symbols.txt`. So the campaign's "name-only" reloc fixes are **already baked into
   the DTK source of truth → no symbols.txt rename needed → conflictsWithDtk = false**
   for the naming dimension.
2. The campaign's own `docs/matching_status.md` records these modules as
   **byte-identical at 100%** (see §3 evidence), against the **same base DOL**
   (hash `870e8b96…`).

**The one real caveat (applies to all candidates):** the campaign built game TUs
with **CodeWarrior GC/1.3 (mwcc_247_108)** and flags
`-O4,p -nodefaults -proc gekko -fp hard -Cpp_exceptions off -enum int -warn off
-use_lmw_stmw on -sdata 8 -sdata2 8`. The DTK template's `cflags_base` differs
(adds `-align powerpc -inline auto -pragma "cats off" -RTTI off -fp_contract on
-str reuse -multibyte`, no `-use_lmw_stmw`/`-sdata`/`-sdata2`) and defaults
`mw_version` to GC/1.2.5n. Reintroduction therefore needs each `Object(...)` to set
`mw_version="GC/1.3"` and `extra_cflags` to reproduce the campaign flag set.
Confidence label **"byte-exact-claimed"** = the campaign verified byte-exact under
its config; a one-shot DTK rebuild confirms it banks. This is the normal "reclaim"
risk and matches how the 12 prior reclaim commits worked.

---

## 2. Current DTK state for this subsystem (from report.json)

| DTK unit | source? | fns | state |
|---|---|---|---|
| game/menu/menu_bag.c | yes | 6 | 72.9% / 97.2% on 2 fns, 4 at 0% — **worker-owned, exclude** |
| game/sound/sound.c | yes | 2 | 0x801653BC, 0x801653C4 both **100% (done)** — stub split only, range 0x801653BC-0x801653CC |
| game/effect/effect_visual_sdata2_8047D198.c | yes | 0 | data |
| game/effect/effect_visual_sdata2_8047D298.c | yes | 0 | data |
| game/people/people_sdata2_8047D790.c | yes | 0 | data |

Global: 8603 fns, 110 matched (1.28%), 129 measured. **No game-UI .text function is
matched except the 2 sound stubs.** All 872 candidates below are unmatched.

---

## 3. Authoritative campaign evidence (docs/matching_status.md + decomp_notes)

- `matching_status.md` "100% Matching Modules": **gs_effect.c 18/18**,
  **effect_visual.c 24/24**, **people_field.c 14/14**, **sound_se.c 25/25**
  (counts as of an early 2026-04-11 snapshot; files grew larger by campaign end).
- `matching_status.md` blanket: *"Game code (Genius Sonority): Matches perfectly.
  Every GS engine module, battle system, **menu, sound**, NPC, FSYS, and HSD module
  tested has matched 100%."*
- `automatch_effect_util.md`: **effect_util.c baseline 141/207 @ 100%**, plus
  deterministic pushes to 100%: `fn_80131714, fn_80132570, fn_8013264C` (via
  `#pragma peephole off`), `fn_80131630, fn_80131660` (via
  `#pragma optimization_level 2`), `fn_80132A38` → 99.92, `fn_80136050` already 100.
  ~30 listed near-misses (88–99.9%) remain non-exact and should stay asm for now.
- `people_field.md`: 11-fn family `peopleFieldMotionResolveInput23C…3C8` (stride
  0x48) → **100%** (byte-identical; only a `bl _GetInputValue` reloc name, already in
  symbols.txt). Audio cluster renames to 100%: `fn_80164520→ReverbHICreate`,
  `fn_801652DC→ReverbHICallback`, `fn_80164A2C→ReverbHIModify`,
  `fn_80162118→sndBSearch`, `fn_8015A870→salExitDspCtrl`,
  `fn_80163DE8→aramFreeStreamBuffer`, `fn_8015A950→salActivateStudio`.
  **Critical build flag:** `people_field.c` only matches with `-use_lmw_stmw off`
  (target uses `_savegpr_/_restgpr_` helpers; verified byte-match of `fn_80162118`).

---

## 4. Candidate inventory (per recoverable TU)

Source = backup branch unless noted. Range = `.text` start–end for the new split.
"realC" = active real-C bodies found by the analyzer (multi-line signatures may be
undercounted; treat as a lower bound). Confidence/value/ease/conflict per the
framework in §1.

### Tier A — high value, explicit byte-exact record, clean free range (FIRST)

| TU | range | realC | conf | value | ease | conflict | evidence |
|---|---|---|---|---|---|---|---|
| effect/effect_util.c | 0x8013151C–0x80137114 | 207 | byte-exact-claimed | high | easy | no | 141/207 baseline @100% + 7 pragma-solved; range is a FREE contiguous gap between gs_effect and tracefx |
| effect/effect_visual.c | 0x801380D4–0x801402AC | 95 | byte-exact-claimed | high | easy | no | matching_status 24/24 (grew); blanket game-100% |
| effect/gs_effect.c | 0x80130CE0–0x8013151C | 18 | byte-exact-claimed | medium | easy | no | matching_status **18/18** |
| people/people_field.c | 0x80144574–0x801652DC | 114 | byte-exact-claimed | high | moderate | no* | 14/14 + 11-fn ResolveInput family + audio renames. *needs extra_cflags `-use_lmw_stmw off` |
| people/people_data.c | 0x80140588–0x80144574 | 62 | byte-exact-claimed | high | easy | no | blanket game-100%; clean real C |
| sound/sound_se.c | 0x80166098–0x80166670 | 7–25 | byte-exact-claimed | medium | easy | no | matching_status **25/25**; range after sound.c stub split, no overlap |
| menu/menu_middle.c | 0x80069C0C–0x8007109C | 100 | byte-exact-claimed | high | easy | no | blanket "every menu module matched 100%"; 0 asm, 0 inc; range matches splits_refined exactly |

### Tier B — blanket byte-exact claim, clean code, ranges from splits_refined/computed

| TU | range | realC | conf | value | ease | conflict | note |
|---|---|---|---|---|---|---|---|
| effect/tracefx.c | 0x80137114–0x801380D4 | 14 | byte-exact-claimed | medium | easy | no | splits_refined range |
| sound/sound_bgm.c | 0x80166670–0x80166E88 | 15–20 | byte-exact-claimed | medium | easy | no | splits_refined range |
| menu/menu_carde_matrix.c | 0x8007C300–0x8007FD64 | 15 | byte-exact-claimed | medium | easy | no | splits_refined range |
| menu/menu_precine.c | 0x80034280–0x80035E04 | 15 | byte-exact-claimed | medium | easy | no | computed range |
| menu/menu_common.c | 0x8007109C–0x8007162C | 5–17 | byte-exact-claimed | medium | easy | no | splits_refined 5 fns; campaign split common/common_ext |
| menu/menu_tool.c | ~0x80072A00–0x8007581C | 24 | byte-exact-claimed | medium | moderate | no | boundary vs menu_common_ext/menu_tool_battle needs check |
| menu/menu_tool2.c | ~0x8007581C–0x800767B8 | 25 | byte-exact-claimed | medium | moderate | no | overlaps menu_tool_battle 0x8007581C–0x80075A34 (campaign sub-split) |
| menu/menu_exdisc.c | ~0x80077A5C–0x80078D38 | 20 | byte-exact-claimed | medium | moderate | no | campaign split exdisc/exdisc2/shrine/coupon |
| menu/menu_exdisc2.c | ~0x80078D38–0x8007C2C0 | 25 | byte-exact-claimed | medium | moderate | no | computed |
| menu/menu_common_ext.c | ~0x8007162C–0x80072A00 | 23 | byte-exact-claimed | medium | moderate | no | boundary needs verification |
| menu/menu_rule.c | 0x800767B8–0x80077A5C | 6 | byte-exact-claimed | low | easy | no | splits_refined range |
| menu/menu_carde.c | 0x80033278–0x80034280 | 11 | byte-exact-claimed | low | easy | no | splits_refined range (menuCardE_Main) |
| menu/menu_carde_main.c | 0x8007FD64–0x80082650 | 5 | byte-exact-claimed | low | easy | no | computed |
| menu/menu_pokecoupon.c | 0x8007C2C0–0x8007C300 | 1–9 | near | low | moderate | no | splits_refined 1 assert; computed 9 — ambiguous boundary |
| menu/menu_battle.c | 0x80069A60–0x80069C0C | 1 | near | low | easy | no | splits_refined 1 assert fn; rest of file is externs |
| menu/menu_status.c | 0x80054914–0x80056A80 | 3 | near | low | easy | no | computed; 2 asm-wrapper fns in archive |
| menu/menu_shop.c | 0x8003AEF0–0x8003BF54 | 2 | near | low | easy | no | computed; archive had asm wrappers |
| menu/menu_dialog.c | 0x80057B34–0x800599AC | 2 | near | low | easy | no | computed |
| menu/menu_msgbox.c | 0x80056C54–0x800573C0 | 2 | near | low | easy | no | computed |
| menu/menu_pokemon.c | 0x8003D1FC–0x80046168 | 2 | near | low | moderate | no | computed; large span, mostly asm |
| effect/generator.c | 0x8017424C–0x8017572C | 2–5 | near | low | easy | no | splits_refined range |

### Tier C — conflicts / incomplete (handle later)

| TU | range | realC | conf | value | ease | conflict | note |
|---|---|---|---|---|---|---|---|
| sound/sound.c (core) | 0x801652DC–0x80166098 | ~25 | byte-exact-claimed | high | moderate | **yes** | existing DTK `sound.c` stub split (0x801653BC–0x801653CC, 2 matched fns) must be **expanded** to this full range; touches an active matched unit |
| people/people.c (merged TU) | 0x80180C78–0x8018FE30 | 13 (+ many still .inc) | candidate-only | medium | hard | partial | backup real-C is INCOMPLETE (most fns still asm); overlaps loose active `people_fn_*.inc` skeletons (0x80181478–0x8018FC50, not in any declared split) |

**Notable individually-recorded byte-exact functions** (subset, for spot-banking
without taking a whole TU):
- effect_util: `fn_80131714, fn_80132570, fn_8013264C, fn_80131630, fn_80131660,
  fn_80136050` (+ the 141-fn baseline).
- people_field: `peopleFieldMotionResolveInput23C, …260, …284, …2A8, …2CC, …2F0,
  …338, …35C, …380, …3A4, …3C8` (11 fns, 100%), and `fn_80164520, fn_801652DC*,
  fn_80164A2C, fn_80162118, fn_8015A870, fn_80163DE8, fn_8015A950`.
  (*0x801652DC is the boundary; verify which TU owns it.)

---

## 5. Exact DTK pipeline to reintroduce a TU (generic)

For a unit like `effect/effect_util.c`:

1. **Source:** copy the backup-branch file into the live tree:
   `git show backup/local-master-pre-sync-20260630:src/game/effect/effect_util.c
   > src/game/effect/effect_util.c`  (backup is post-fix & .inc-stripped).
2. **Split:** add a unit block to `config/GC6E01/splits.txt` (do not alter existing
   ranges):
   ```
   game/effect/effect_util.c:
       .text       start:0x8013151C end:0x80137114
   ```
   (Add `.rodata`/`.sdata`/`.sdata2`/`.data` lines if the unit owns pooled
   constants — check the campaign `splits_refined.txt` / the file's `lbl_*`
   externs; effect_util references `lbl_8047AE…`/`lbl_8042…` pools.)
3. **Object:** add to `configure.py` inside the GameLib objects list:
   ```python
   Object(
       Matching,                       # or CodeCandidate to objdiff-compare before linking
       "game/effect/effect_util.c",
       progress_category="game",
       mw_version="GC/1.3",
       extra_cflags=["-use_lmw_stmw on", "-sdata 8", "-sdata2 8"],
   ),
   ```
   - `people_field.c` instead uses `extra_cflags=["-use_lmw_stmw off","-sdata 8","-sdata2 8"]`.
   - If a near-miss needs it, append `-pragma peephole off` (effect_util) or
     `-opt nopeephole` (gs_title-style) per the decomp notes — but Tier-A files
     matched without these.
4. **Build & verify (USER runs — not in this read-only pass):**
   `python configure.py && ninja`, then read `build/GC6E01/report.json` for the new
   unit; confirm the functions report `fuzzy_match_percent == 100`. Use
   `Matching` if all link; `CodeCandidate` while any function is still < 100.

For the **sound.c core** conflict: edit the existing `game/sound/sound.c` split to
`start:0x801652DC end:0x80166098` (it currently ends at 0x801653CC) and replace the
2-stub active source with the backup `sound.c`, preserving the already-matched
0x801653BC/0x801653C4 bodies.

---

## 6. Recommended first batch

**Pilot (validate pipeline + GC/1.3 flag parity on small, explicitly-100% units):**
1. `effect/gs_effect.c` (0x80130CE0–0x8013151C, 18/18 recorded) — smallest explicit-100% unit.
2. `sound/sound_se.c` (0x80166098–0x80166670, 25/25 recorded) — isolated range, no overlap.

If those two rebuild to 100% in the DTK, flag parity is proven; then take the big
value units in order:
3. `effect/effect_util.c` (207 fns, free contiguous range, 141+ recorded) — largest single win.
4. `menu/menu_middle.c` (100 fns, clean range, blanket claim).
5. `effect/effect_visual.c` (95 fns, 24/24+ recorded).
6. `people/people_data.c` (62 fns) and `people/people_field.c` (114 fns, with
   `-use_lmw_stmw off`).

This sequences risk-cheap validation first, then ~600 banked functions across six
files — all currently unmatched, none worker-owned, none conflicting with the DTK
source of truth (symbols.txt already matches; only `sound.c` core and `people.c`
are deferred for the conflicts noted in Tier C).
