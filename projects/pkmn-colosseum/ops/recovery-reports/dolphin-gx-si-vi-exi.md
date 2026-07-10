# Recovery Inventory: dolphin/{gx,si,vi,exi}

Source of truth: DTK report.json (8603 fns, 110 matched). All candidates below are CURRENTLY UNMATCHED in DTK and NOT in active src / NOT in the 12 reclaim commits.

## Method & key findings

- Archive files reviewed (14): GXFifo.c, GXGeometry.c, GXInit.c, GXLight.c, GXMisc.c, GXTexture.c, GXTransform.c, SI.c, VI.c, VIFull.c, EXI.c, EXI2.c, EXIBios.c, EXIUart.c.
- REJECTED as non-recoverable: all GXInit.c `asm{nofralloc}` wrappers (123); all GXInit.c standalone pure-C that are NOT already reclaimed (verified STUBS: __GXInitGX, fn_800B760C, fn_800B897C, fn_800BD16C ... empty bodies under header 'Stub functions for coverage - TODO: decompile'); GXFifo.c / GXGeometry.c / GXLight.c / GXMisc.c / GXTexture.c / GXTransform.c (idealized SDK reconstructions / empty stubs, mostly un-addressable); VIFull.c / EXI2.c `#if 1` blocks (asm .inc active = C was non-matching); EXIUart __OSFPRInit (asm).
- `#if 0` (asm disabled, C active) in VIFull.c/EXI2.c is a PROVEN byte-exact marker: reclaimed DTK unit VI_fn_800AA498.c is byte-identical to VIFull.c's `#if 0` body for fn_800AA498, and fn_800AA4D4 (`#if 1`) became an asm .inc. => the 3 `#if 0` candidates are byte-exact-claimed.
- SI.c and EXI.c are GENUINE detailed decompilations (verified: SIInterruptHandler, __SITransfer, SIInit, SISetXY, fn_800D00B0, EXIImm, EXIInit). Real recovery-quality C, but byte-exactness UNVERIFIED here (no build) => confidence 'near'.
- conflictsWithDtk = FALSE for every candidate: DTK symbols.txt already has a function boundary at each address, and for named ones the DTK symbol name already equals the campaign name (SIInit, EXIImm, VIGetTvFormat, ...). For `fn_<addr>` the names match by construction. No symbols.txt rename / object-map edit required.

## Reintroduction pipeline (per candidate)

1. configure.py: add/flip `Object(Matching, "dolphin/<sub>/<File>.c")` in the objects list.
2. config/GC6E01/splits.txt: add a `dolphin/<sub>/<File>.c:` unit with `.text start:<addr> end:<addr+size>` carved out of the surrounding auto_* gap (for SISetSamplingRate reuse existing `dolphin/si/SI_range_800D0F68.c` unit).
3. Place the real C body (the single function, with the DTK symbol name + needed externs/includes) at src/dolphin/<sub>/<File>.c.
4. ninja; confirm build/GC6E01/report.json shows fuzzy_match_percent=100 for that unit.

## Candidates

| fn (DTK name) | addr | size | conf | ease | value | conflict | DTK gap unit | evidence |
|---|---|---|---|---|---|---|---|---|
| fn_800CEAC8 | 0x800CEAC8 | 156 | byte-exact-claimed | easy | low | False | auto_01_800CE7DC_text | EXI2.c L177 #if 0; C body with #pragma peephole on; EXI2 peek/status, real lbl_8047AA34 logic |
| fn_800CEA3C | 0x800CEA3C | 140 | byte-exact-claimed | easy | low | False | auto_01_800CE7DC_text | EXI2.c L152 #if 0; C body with #pragma peephole on (match-tuning); DBGRead EXI2 debug read |
| fn_800AB5B4 | 0x800AB5B4 | 96 | byte-exact-claimed | easy | low | False | auto_01_800AA4D4_text | VIFull.c L1640 #if 0 (asm disabled) -> clean C switch on __PADSpec; same #if-0 convention as reclaimed VI_fn_800AA498 |
| SIInterruptHandler | 0x800CFA60 | 836 | near | hard | high | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| GetTypeCallback | 0x800D0860 | 664 | near | hard | high | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_800D00B0 | 0x800D00B0 | 524 | near | hard | high | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| SIGetType | 0x800D0AF8 | 452 | near | hard | high | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| EXISync | 0x80098530 | 368 | near | moderate | high | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| SITransfer | 0x800D06F4 | 364 | near | moderate | high | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| EXIImm | 0x8009820C | 348 | near | moderate | high | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_80098E9C | 0x80098E9C | 348 | near | moderate | high | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| EXISelect | 0x80098B94 | 320 | near | moderate | high | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_800D0CBC | 0x800D0CBC | 316 | near | moderate | high | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| EXIDma | 0x80098408 | 296 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_800989C0 | 0x800989C0 | 296 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| EXIInit | 0x800990C0 | 292 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| EXIDeselect | 0x80098CD4 | 264 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| EXILock | 0x800991E4 | 252 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| SISetSamplingRate | 0x800D0F68 | 228 | near | moderate | medium | False | SI_range_800D0F68 (RESERVED skeleton) | SI.c L523 SISetSamplingRate real C; maps to RESERVED ahead-of-source skeleton SI_range_800D0F68 (currently asm/unsourced) - cleanest reintro |
| fn_800D04D0 | 0x800D04D0 | 212 | near | moderate | medium | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| EXIUnlock | 0x800992E0 | 200 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_80098FF8 | 0x80098FF8 | 200 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_800D05A4 | 0x800D05A4 | 196 | near | moderate | medium | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_80098DDC | 0x80098DDC | 192 | near | moderate | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| SIInit | 0x800CFFFC | 180 | near | moderate | medium | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_80098AE8 | 0x80098AE8 | 172 | near | easy | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_80098368 | 0x80098368 | 160 | near | easy | medium | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_800D03C8 | 0x800D03C8 | 156 | near | easy | medium | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_800D0668 | 0x800D0668 | 140 | near | easy | medium | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_8009870C | 0x8009870C | 132 | near | easy | low | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| fn_800D02BC | 0x800D02BC | 124 | near | easy | low | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_80098944 | 0x80098944 | 124 | near | easy | low | False | auto_01_80098108_text | EXI.c genuine decompilation (EXIChan Ecb[], EXI_CHAN_PARAMS regs, flag bits 0x3/0x4); EXIImm+EXIInit verified full real C |
| SISetXY | 0x800D035C | 108 | near | easy | low | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_800D0464 | 0x800D0464 | 108 | near | easy | low | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| VIGetTvFormat | 0x800AA430 | 104 | near | easy | low | False | auto_01_800AA288_text | VI.c L40 real switch on CurrTvMode; DTK already names symbol VIGetTvFormat |
| fn_800ABEFC | 0x800ABEFC | 96 | near | easy | low | False | auto_01_800AA4D4_text | VIFull.c L2338 real VI retrace pre-callback (OSClearContext/OSSetCurrentContext save-restore) |
| fn_800D0338 | 0x800D0338 | 20 | near | trivial | low | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_800D034C | 0x800D034C | 16 | near | trivial | low | False | auto_01_800CF764_text | SI.c genuine decompilation (COMCSR bitfield union / __SIRegs HW indices); SIInterruptHandler+__SITransfer verified full real C |
| fn_80098014 | 0x80098014 | 8 | near | trivial | low | False | auto_01_80051710_text | EXIBios.c L101 tiny leaf real C |
| fn_80098034 | 0x80098034 | 8 | near | trivial | low | False | auto_01_80051710_text | EXIBios.c L106 tiny leaf real C |
| fn_800BD91C | 0x800BD91C | 2120 | candidate-only | hard | high | False | auto_01_800BB30C_text | GXInit.c L7749 real C (gx ctx +0x4e4 matrix dispatch w/ goto); BUT GXInit.c quality inconsistent (most standalone-C are stubs) and a duplicate asm def exists at L7203 - needs build verification |

TOTAL real candidates: 41  (byte-exact-claimed: 3, near: 37, candidate-only: 1)