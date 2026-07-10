# Pokemon Colosseum (GC6E01) — Consolidated Archive Recovery Plan

DTK config is SOURCE OF TRUTH. Goal: reintroduce prior-campaign decompiled C for currently-UNMATCHED DTK functions via the standard pipeline (configure.py Object + splits.txt unit + real C -> configure.py -> ninja -> report.json), banking matches without altering DTK metrics. Do NOT re-propose the 12 already-committed "Reclaim exact" units.

## Totals (rough, de-duplicated)

- **totalRecoverable ~= 2,300 unique real-C functions.** The backup-branch diff (2,273 unique hand-decompiled-C fns, ~185.6 KB) is the master superset; the per-subsystem reports (os 79, trk 56, hsd 49, gx/si/vi/exi 41, game-ui 872, game-core 32, dvd/db 11, crt 12) are curated subsets of it, PLUS ~30-50 archive-only fns the backup diff did not surface (dvd ErrorCode2Num, crt printf/stdio leaves, game-core 8-byte pattern fns).
- **totalByteExactReady ~= 1,930** ("byte-exact-claimed" = prior objdiff/commit claim + exact addr/size alignment to the same DOL; backup-branch 1,928 dominate; subsystem claims — os 14, game-ui 240, trk 18, hsd 5, gx 3, game-core 28 — overlap inside that figure).
- HARD CAVEAT: NOTHING here is build-verified in this session (build out of scope). Every batch is GATED on a configure.py+ninja+report.json round-trip that must show matched_functions rise AND the freeze guard pass. Treat "byte-exact-claimed" as high-prior, not proven.

## How the validation gate works (every batch)
1. Copy real C to src/ path. 2. Add/flip configure.py Object (CodeCandidate->Matching, set mw_version/extra_cflags where noted). 3. Add or extend splits.txt .text unit (skeleton ranges already reserved -> no edit). 4. `configure.py && ninja`. 5. Read build/GC6E01/report.json: matched_functions must increase; objdiff fuzzy=100 on the unit. 6. Freeze guard / symbols.txt unchanged. If a fn lands <100, demote that one fn to .inc and keep the rest. One coherent commit per batch.

---

## Ahead-of-source 39-split SKELETONS with archived C READY (fastest wins — DO FIRST)
These DTK skeleton units already have the splits.txt range AND symbols.txt names reserved (src=None). Reintroduction = drop C + flip one Object line. ZERO symbols/splits edits, conflictsWithDtk=FALSE:
- **os/OSThread.c** (0x800A1404-0x800A2778, 20 fns) — backup has real C for all 20. Biggest single zero-edit bank.
- **os/OSInterrupt** (4 C fns: __OSInterruptInit/__OSMaskInterrupts/__OSUnmaskInterrupts/fn_8009E414; asm .inc fallback for SetInterruptMask + ExternalInterruptHandler).
- **os/OSTime_range_800A2778** (__OSGetSystemTime).
- **dvd/DVDError_ErrorCode2Num.c** (0x800A7FE0-0x800A80FC, 1 fn) — archive DVDError.c drop-in, single Object line.
- **db/DB.c** reserved split (__DBExceptionDestinationAux + its 0x10 asm companion).
- **crt/stdio_range_800C7558.c** (fn_800C7558 + fwrite) and **crt/printf.c** (__FileWrite, vprintf, fn_800C8600, fn_800C87F8).
- **trk** 8 whole-unit clean skeletons: ddh_cc_range_800C3C00 (6), ddh_cc_range_800C3E90 (1), gdev_cc_range_800C41AC (6), gdev_cc_range_800C4444 (1), TRKBuffer (2), TRKSerial_range_800BF088 (1), TRKTarget_range_800C1310 (1), TRKComm_range_800C3678 (4).
- **hsd** reserved ranges: hsd_mobj_range_801A84F0 (4: MtxFree/MtxAlloc/VecFree/VecAlloc), hsd_mobj_range_801A86B4 (5 byte-exact-claimed mtx fns), plus 1-fn init ranges.
- **si/SI_range_800D0F68.c** (SISetSamplingRate) + tiny leaves fn_800D0338/fn_800D034C.

---

## RANKED EXECUTION BATCHES (cleanest "bank first" at top)

### B1 — os/OSThread.c skeleton (FLAGSHIP / proof-of-pipeline) [~20 wins]
Backup real C for all 20 fns of reserved split 0x800A1404-0x800A2778. Start by sourcing the trivial/easy leaf set (OSDisableScheduler, OSEnableScheduler, __OSReschedule, OSClearStack, fn_800A1484, fn_800A14EC, fn_800A16E8), confirm 100%, then add the larger bodies (fn_800A1F94 is the one "near"). NO symbols/splits edit; just Object(Matching,"dolphin/os/OSThread.c"). Must reassemble fns in ADDRESS ORDER + struct headers (backup is per-fn scratch TUs). conflict=false.

### B2 — TRK Path-A whole-unit skeletons [~18 wins]
8 reserved units, every fn real clean C, no asm/vomit, names match symbols.txt. ddh_cc + gdev_cc (archive), TRKBuffer/TRKTarget (archive), TRKSerial/TRKComm (prefer BACKUP branch — strictly cleaner, adds Board/Comm/Serial archive lacks). Flip each Object CodeCandidate->Matching; ranges reserved. conflict=false.

### B3 — HSD reserved mtx/vec/obj ranges [~14 wins]
B3a: hsd_mobj_range_801A84F0 fill (MtxFree/MtxAlloc/VecFree/VecAlloc) + MtxInitAllocData + VecInitAllocData, all DTK-named trivial, from hsd_mobj_ext.c. B3b: 5 byte-exact-claimed hsd_mtx.c fns (HSD_MtxSRT/MkRotationMtx/MtxGetScale/MtxGetRotation/MtxInverseConcat, commit 27819517) carved into hsd_mobj_range_801A86B4. conflict=false.

### B4 — crt reserved skeleton leaves [~6 wins]
From crt/stdio_range_800C7558.c: fn_800C7558 (trivial 0x24 table lookup, lead) + fwrite. From crt/printf.c: __FileWrite (lead, 0x58 fwrite wrapper) + fn_800C87F8 + fn_800C8600 + vprintf. Validate carve-and-match on fn_800C7558 + __FileWrite first. conflict=false. (Defer __va_arg/__init_data -> B13.)

### B5 — os/OSInterrupt + os/OSTime skeletons [~5 wins]
__OSInterruptInit/__OSMaskInterrupts/__OSUnmaskInterrupts (easy), __OSGetSystemTime (easy), fn_8009E414 (near/hard). Asm .inc fallback for SetInterruptMask + ExternalInterruptHandler. conflict=false.

### B6 — dvd ErrorCode2Num + DB.c + DVD queue trio [~5 wins]
C1 ErrorCode2Num (reserved split, zero edits, conflict=false). C2 DB.c Aux + asm companion (reserved, conflict=false). C3 __DVDClearWaitingQueue/__DVDPushWaitingQueue/__DVDPopWaitingQueue — carve out of auto_01_800A4D28_text + trivial _803FC3F8 rename (conflict=TRUE, care).

### B7 — GX/SI/VI/EXI byte-exact `#if 0` trio [~3 guaranteed wins]
VIFull fn_800AB5B4, EXI2 fn_800CEA3C, EXI2 fn_800CEAC8 — take the `#else` C body; same convention already produced matched VI_fn_800AA498.c -> expect fuzzy=100 immediately. Carve a new split from surrounding auto_* gap. conflict=false. (GX yields nothing new — real leaves already reclaimed; standalone GXInit.c are empty stubs.)

### B8 — SI.c translation unit [~6 hi-value wins, ~3.3 KB code]
After B7 validates the compile env: promote whole SI.c TU to bank SIInterruptHandler (836B), GetTypeCallback (664B), fn_800D00B0 (524B), SIGetType (452B), SITransfer (364B), SIInit, SISetSamplingRate. Genuine detailed decomps, "near". conflict=false.

### B9 — EXI.c translation unit [~4 hi-value wins]
EXISync (368B), EXIImm (348B), fn_80098E9C (348B), EXISelect (320B), EXIInit. Real C, "near". conflict=false.

### B10 — Game-UI pilot (GC/1.3 flag parity) [~43 wins]
Game TUs need mw_version="GC/1.3" + extra_cflags `-use_lmw_stmw on -sdata 8 -sdata2 8`. PILOT on two smallest isolated 100%-recorded units: effect/gs_effect.c [0x80130CE0-0x8013151C, 18/18] and sound/sound_se.c [0x80166098-0x80166670, 25/25]. Proves the flag path before any large carve. conflict=false. symbols.txt is byte-identical to campaign symbols.build.txt.

### B11 — Game-UI high-volume TUs [~600 wins]
Once B10 rebuilds 100%, in order: effect/effect_util.c (207 fns, contiguous gap), menu/menu_middle.c (100), effect/effect_visual.c (95), people/people_data.c (62), people/people_field.c (114, REQUIRES extra_cflags `-use_lmw_stmw off`), plus menu_tool/tool2/exdisc/exdisc2/common_ext (~120). Highest raw volume in the whole plan. conflict=false. Defer sound.c core + people.c (overlaps existing splits) -> B13.

### B12 — Backup-branch big clean game TUs [~1,300 wins]
Carve file ranges out of main/auto_*_text. Order by cleanliness: trainer.c (342 clean, easy), pokemon.c (140), gs_model.c (58, clean TU), battle_waza.c (64, clean TU), battle_grid.c (28), battle_main.c (19), colosseum_event.c (218), then gs_field_world.c (477 clean — carve AROUND its 245 interleaved asm-include stubs). Also small precedent-proven libs: crt/exit.c (5, COMPLETE_TU), crt/extras.c (15), crt/mem.c (5, existing skeleton), dolphin/pad/Pad.c (15), and 42 fns landing in EXISTING named DTK skeleton units (crt/string/wchar/stdio, OSThread, TRK ranges, hsd). conflict=false. DEFER colosseum_script.c (236/251 are raw Ghidra register-arg — spot-verify first).

### B13 — Game-core tiny deterministic clusters [~28 wins]
28 byte-deterministic 8-byte fns (return-const + SDA accessors) in 0%-matched auto units. Two clean contiguous single-TU splits to start: fsys_file 0x8017BFE8-0x8017C008 (4 fns, zero deps) and battle_main 0x801EF61C-0x801EF644 (5 SDA getters/setters). Add splits.txt .text blocks; no symbols edit. conflict=false. Plus LZSS fn_8017F2C4 (0x134, candidate-only).

---

## CONFLICTS WITH DTK SOURCE OF TRUTH (handle separately, with care)
conflictsWithDtk=TRUE: needs a NEW splits.txt unit carved from an auto_* catch-all and/or touches reserved boundaries. Names already in symbols.txt (no rename), but freeze-guard sensitive — bank only AFTER the zero-conflict batches prove the pipeline:
- **os Tier-2 (54 fns)** — OSAlarm, OSError, OSReset, OSReboot, OSSram (~15), OSInit, OSException, OSMemory, OSAudioSystem, OSCache(C parts), OSContext(C parts), OSSystemCall, __OSThreadInit. All real C in auto_01. 14 byte-exact-claimed. Highest single: OSResetSystem (0x800A0008), __OSInitSram (0x800A07C4).
- **dvd queue trio** (B6 C3) — auto_01_800A4D28 carve + _803FC3F8 rename.
- **crt __va_arg** (0x800C45A0, highest crt value, genuine MSL, needs NEW split + object_map edit) and **__init_data** (0x80003340), fwide, __start.c leaves.
- **game-ui sound.c core** (must EXPAND existing 2-stub sound.c split) and **people.c** (backup real-C incomplete, overlaps loose people_fn_*.inc skeletons).
- **dvd DVDLow.c** 6 bodies — candidate-only, trapped in 18-fn all-or-nothing hybrid split. DEFER.

## REJECTED (do NOT propose — non-recoverable per rules)
asm{nofralloc} wrappers; inline asm{}; register-transliteration "vomit" (fake rN vars, no-arg fn-ptr calls); empty "TODO: decompile" stubs (all standalone GXInit.c pure-C, GXFifo/Geometry/Light/Misc/Texture/Transform); `#if 1` asm-active blocks; OSContext skeleton (Save/Load/StackPointer/SwitchFiber all asm); SetInterruptMask (728B never decompiled); ExternalInterruptHandler; OSGetTime/OSGetTick/PPCArch/OS Cache DC*/IC*/LC*; OSMutex/OSStateFlags/OSUtility/OSEXI-RTC (absent from symbols.txt = dead-stripped, no target); ~194 battle/fsys `#include fn_*.inc` fallbacks; hsd_pobj_ext render fns; udp_cc (already matched); OSTime fn_800A2998 (only 20.1% fuzzy — needs permuter, not drop-in).

## How this feeds the idle fleet
report.json today scores only 110/8603 fns (1.28%) and just 129 carry a fuzzy_match_percent — the matching lanes are starved of targets because most of the binary is board-invisible raw asm in auto units. Landing these recovery batches converts thousands of unscored auto-unit functions into named, split-bounded, objdiff-tracked units. Even partials/near-misses that don't hit 100% become first-class scored targets the moment their TU is carved in, so every reintroduced split immediately enlarges report.json's scored-function universe and hands the idle permuter/matcher lanes a fresh, addressable backlog (callers, siblings, near-misses) instead of an opaque blob — compounding the recovery beyond the byte-exact wins themselves.
