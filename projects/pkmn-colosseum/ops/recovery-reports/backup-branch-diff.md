# Pre-Reset Backup-Branch Diff — Recovery Report

Branch compared: `master` vs `backup/local-master-pre-sync-20260630` (the full pre-reset tree).
Method: STRICT READ-ONLY. Parsed backup `report.json` (pre-reset objdiff state), master `build/GC6E01/report.json`, both `symbols.txt`/`splits.txt`. Classified every backup `src/*.c` body, mapped each backup-matched function onto the DTK address space, and rejected asm-include / inline-asm bodies.

## Headline

- The reset dropped **229 src/*.c files** that existed pre-reset (backup has 296 src .c; master has 134).
- Backup `report.json` claimed **3498 matched functions** (51% of its 6795); master DTK currently shows only **110** (1.28%).
- Address alignment is exact (same DOL): **3479/3479** backup-matched addresses are exact DTK function starts; **3452** are currently UNMATCHED on DTK; **3408** also have identical size.
- Of those, **1135 are asm-include / inline-asm junk (REJECTED** per rules — `#include "*_fn_ADDR.inc"`, `nofralloc`).

### RECOVERABLE (real decompiled C, byte-exact-CLAIMED by pre-reset build, DTK-unmatched, same-size, NOT already reclaimed): **2273 functions / 185,604 bytes**

- **1928** are clean hand-decompiled C → HIGH confidence (byte-exact-claimed).
- **345** are raw "Ghidra import" / register-arg style → LOWER confidence (verify before banking).
- **42** land inside EXISTING named DTK skeleton units (the uncommitted splits batch: crt/mem, crt/printf, crt/string, OSThread, trk/TRK* ranges, hsd ranges) → EASIEST: split already exists, only the C must be dropped in.

Bands: tiny<=80B = 1602, mid 81-220B = 486, big >220B = 185.

## Caveat on "byte-exact"
I cannot rebuild (forbidden), so "byte-exact" = claimed by the pre-reset `report.json` (its own objdiff run), corroborated by: (1) perfect addr+size alignment with the DTK DOL, and (2) the 12 committed "Reclaim exact" commits having ALREADY successfully re-matched 27 of these backup functions under DTK flags — proving the matches transfer. Residual risk is per-file DTK compiler-flag drift; library/runtime code (precedent-proven) is lowest risk.

## Already-reclaimed cross-check
Functions matched by the 12 "Reclaim exact" commits show as matched in master `report.json` and are therefore EXCLUDED by the DTK-unmatched filter. No double-counting. The 42 skeleton-unit candidates are NOT yet sourced (skeletons only) and are valid recovery.

## Wholesale-recoverable translation units (highest leverage)
Entire .c files whose clean real-C functions can be reintroduced as a unit. `COMPLETE_TU` = every function in the backup unit matched.

| recov.bytes | clean realC | raw realC | backup TU completeness | addr range | backup file |
|---:|---:|---:|:--|:--|:--|
| 48484 | 15 | 236 | 251/460 | 0x80212840-0x8023FD44 | src/game/colosseum_script.c |
| 20804 | 218 | 12 | 231/398 | 0x80202810-0x80211A00 | src/game/colosseum_event.c |
| 19584 | 477 | 1 | 620/724 | 0x80114D6C-0x80130CE0 | src/game/gs_field_world.c |
| 18652 | 68 | 61 | 144/615 | 0x802405C0-0x80265EC4 | src/game/colosseum_battle.c |
| 12712 | 342 | 2 | 345/380 | 0x801F7F80-0x80201764 | src/game/trainer.c |
| 9024 | 140 | 1 | 141/185 | 0x801F000C-0x801F7F80 | src/game/pokemon.c |
| 5292 | 64 | 0 | 64/168 | 0x801D1470-0x801DE698 | src/game/battle/battle_waza.c |
| 4768 | 58 | 4 | 63/131 | 0x801019F8-0x80109C88 | src/game/gs_model.c |
| 3156 | 18 | 0 | 19/22 | 0x800056C4-0x80006630 | src/game/main.c |
| 2460 | 4 | 0 | 50/80 | 0x80139934-0x8013F80C | src/game/effect/effect_visual.c |
| 2008 | 12 | 0 | 15/28 | 0x80012D20-0x8001501C | src/game/gs_event_exec.c |
| 1816 | 52 | 0 | 120/193 | 0x80131630-0x80136078 | src/game/effect/effect_util.c |
| 1780 | 21 | 23 | 44/100 | 0x8006A76C-0x80070318 | src/game/menu/menu_middle.c |
| 1720 | 10 | 0 | 10/21 | 0x800D13C4-0x800D3074 | src/game/gs_render_util.c |
| 1636 | 7 | 0 | 8/9 | 0x80130CE0-0x8013151C | src/game/effect/gs_effect.c |
| 1624 | 19 | 0 | 19/21 | 0x801EF02C-0x801F000C | src/game/battle/battle_main.c |
| 1544 | 12 | 2 | 14/25 | 0x80078D38-0x8007C2C0 | src/game/menu/menu_exdisc2.c |
| 1316 | 5 | 0 | COMPLETE_TU | 0x800C4F34-0x800C5458 | src/crt/exit.c |
| 1304 | 1 | 0 | 29/92 | 0x8002F284-0x8002F79C | src/game/gs_worldmap.c |
| 1244 | 28 | 0 | 28/60 | 0x801C0270-0x801C4CB8 | src/game/battle/battle_grid.c |
| 1220 | 11 | 0 | 12/14 | 0x8011432C-0x80114AE0 | src/game/gs_field_resource.c |
| 1120 | 9 | 0 | 9/23 | 0x80072C74-0x8007581C | src/game/menu/menu_tool.c |
| 1104 | 5 | 0 | 9/15 | 0x800A16E8-0x800A26CC | src/dolphin/os/OSThread.c |
| 1076 | 19 | 0 | 51/56 | 0x8000CA34-0x8000D290 | src/game/gs_party_access.c |
| 1044 | 10 | 0 | 11/28 | 0x8010C364-0x8010CBD0 | src/game/gs_colsys.c |
| 924 | 5 | 0 | COMPLETE_TU | 0x800C8174-0x800C8510 | src/crt/mem.c |
| 908 | 7 | 0 | 22/50 | 0x8000DAA8-0x80011EA4 | src/game/gs_npc_interact.c |
| 908 | 19 | 2 | 21/68 | 0x800896B8-0x8008C7B0 | src/game/gba/gba_misc.c |
| 788 | 6 | 0 | 6/24 | 0x80093B04-0x80097FF8 | src/game/late_game.c |
| 724 | 6 | 0 | 6/15 | 0x800345A4-0x80035E04 | src/game/menu/menu_precine.c |
| 692 | 4 | 0 | 4/9 | 0x8013796C-0x801380D4 | src/game/effect/tracefx.c |
| 680 | 3 | 0 | 14/22 | 0x800F75FC-0x800F80B0 | src/game/input/input.c |
| 664 | 10 | 0 | 11/28 | 0x80088428-0x80089048 | src/game/gba/gba_conv.c |
| 632 | 11 | 0 | 39/77 | 0x800205B8-0x80024698 | src/game/gs_title.c |
| 628 | 12 | 0 | 15/55 | 0x8010F6A0-0x801140DC | src/game/gs_field_colquery.c |
| 568 | 15 | 0 | 15/17 | 0x800CDBB8-0x800CE79C | src/crt/extras.c |
| 508 | 3 | 0 | COMPLETE_TU | 0x800C39BC-0x800C3BB8 | src/trk/TRKComm.c |
| 488 | 15 | 0 | 89/129 | 0x801E11CC-0x801EE468 | src/game/battle/battle_logic.c |
| 464 | 3 | 0 | 36/61 | 0x8001D7E4-0x8001F304 | src/game/gs_pcbox.c |
| 456 | 12 | 0 | 12/25 | 0x80075A9C-0x80075F78 | src/game/menu/menu_tool2.c |

## Recommended first batch
1. **42 skeleton-unit fns** (split already exists in DTK): crt/mem (5), crt/printf (2), crt/string (1), crt/wchar (1), crt/stdio (1), dolphin/os/OSThread (5), trk/TRKTarget (8), trk/TRKComm (3), trk/TRKBoard (3), trk/TRKNub (3), trk/TRKDispatch (3), trk/TRKInit/TRKSerial/TRKBuffer (3), hsd/hsd_pobj+hsd_mobj ranges (4). Trivial wire-up, precedent-proven.
2. **Fully-clean library/runtime TUs**: crt/exit (5, COMPLETE_TU), crt/extras (15), dolphin/pad/Pad (15).
3. **Big clean game TUs** for volume: trainer.c (342 clean), gs_field_world.c (477 clean; file interleaves 245 asm-include stubs — carve clean fns), pokemon.c (140), colosseum_event.c (218), battle_waza.c (64), gs_model.c (58).
Defer: colosseum_script.c (236 of 251 are raw Ghidra register-arg — lower confidence) and other raw-heavy files until spot-verified.

## Integration note (conflictsWithDtk)
DTK uses `fn_ADDR` symbol names matching the backup naming, so NO symbols.txt rename is needed (conflictsWithDtk=false). Standard reintroduction: configure.py `Object(Matching)` + a splits.txt `.text` unit carving the file range out of its `main/auto_*_text` unit + the real C. The 42 skeleton-unit fns skip the carve (split exists).