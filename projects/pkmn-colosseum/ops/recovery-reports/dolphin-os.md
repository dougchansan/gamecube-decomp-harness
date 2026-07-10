# Recovery Inventory — Subsystem: dolphin/os (Pokemon Colosseum GC6E01)

Source of truth: DTK config (config/GC6E01/{symbols,splits}.txt, build/GC6E01/report.json). READ-ONLY analysis; nothing built.

Best recovery source = **backup branch `backup/local-master-pre-sync-20260630:src/dolphin/os/`** — it is strictly MORE complete than `archive/previous_campaign/src/dolphin/os/` (e.g. OSInterrupt fn_8009E414 is real structured C in backup but junk register-transliteration in archive; OSThread fn_800A1528/19CC/1BB4/1F94 are real C in backup, asm-only in archive).

## Headline counts
- Recoverable real-C, currently-UNMATCHED, with a DTK target: **79** functions
  - Tier 1 (ahead-of-source SKELETON splits — splits.txt unit already reserved, just add a configure.py Object(Matching)+.c; NO symbols/splits edit): **25**
  - Tier 2 (need a NEW splits.txt unit + configure.py Object): **54**
- Of those, confidence 'byte-exact-claimed' (campaign retired the asm fallback via `#if 0`, or plain canonical SDK C): **14**; remainder 'near'.
- Near-miss already in active src but NOT matching (fn_800A2998, 20.1%): **1** (NOT a drop-in win).
- Rejected groups (asm / dead-stripped / pseudo): **11** (detailed at bottom).

## IMPORTANT confidence caveat
No byte-exactness could be CONFIRMED: building (configure.py/ninja) is out of scope and the old campaign's objdiff_report.json carries the OS unit list but NO measures. 'byte-exact-claimed' = the campaign explicitly retired the inline-asm fallback (`#if 0 asm / #else <C>`) for that function, which in this campaign's convention means it had reached 100%. 'near' = real, well-formed, canonical SDK/melee-derived C, but larger or only present in the backup tree, not independently corroborated.

## Structural note on the OSThread/OSInterrupt skeletons
The backup OSThread.c / OSInterrupt.c are per-function matching scratch TUs: functions are NOT in address order and include extra static helpers (SetRun, UnsetRun, __OSGetEffectivePriority, ... which are dead-stripped/inlined — absent from symbols.txt) plus fn_ out-of-line duplicates. To bank the DTK split you must assemble a NEW .c containing exactly the split's functions IN ADDRESS ORDER, supply the OSThread/OSContext struct headers, and declare the helper externs. The C bodies are the recovered artifact; reassembly+verification is the remaining work.

## TIER 1 — ahead-of-source skeleton splits (cleanest path, conflictsWithDtk=FALSE)

### os/OSThread  (split reserved 0x800A1404-0x800A2778; report 0/20; backup has real C for ALL 20)
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| OSDisableScheduler | 0x800A1404 | 64 | byte-exact-claimed | trivial | high | src/dolphin/os/OSThread.c |
| OSEnableScheduler | 0x800A1444 | 64 | byte-exact-claimed | trivial | high | src/dolphin/os/OSThread.c |
| fn_800A1484 | 0x800A1484 | 104 | byte-exact-claimed | easy | high | src/dolphin/os/OSThread.c |
| fn_800A14EC | 0x800A14EC | 60 | byte-exact-claimed | easy | high | src/dolphin/os/OSThread.c |
| fn_800A1528 | 0x800A1528 | 448 | near | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A16E8 | 0x800A16E8 | 80 | byte-exact-claimed | easy | high | src/dolphin/os/OSThread.c |
| SelectThread | 0x800A1738 | 552 | near | hard | high | src/dolphin/os/OSThread.c |
| __OSReschedule | 0x800A1960 | 48 | byte-exact-claimed | trivial | high | src/dolphin/os/OSThread.c |
| fn_800A1990 | 0x800A1990 | 60 | byte-exact-claimed | easy | high | src/dolphin/os/OSThread.c |
| fn_800A19CC | 0x800A19CC | 488 | near | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A1BB4 | 0x800A1BB4 | 228 | near | moderate | high | src/dolphin/os/OSThread.c |
| OSCancelThread | 0x800A1C98 | 444 | near | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A1E54 | 0x800A1E54 | 320 | near | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A1F94 | 0x800A1F94 | 648 | near | hard | high | src/dolphin/os/OSThread.c |
| fn_800A221C | 0x800A221C | 368 | near | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A238C | 0x800A238C | 236 | byte-exact-claimed | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A2478 | 0x800A2478 | 260 | byte-exact-claimed | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A257C | 0x800A257C | 192 | near | moderate | high | src/dolphin/os/OSThread.c |
| fn_800A263C | 0x800A263C | 144 | near | moderate | high | src/dolphin/os/OSThread.c |
| OSClearStack | 0x800A26CC | 172 | byte-exact-claimed | easy | high | src/dolphin/os/OSThread.c |

### os/OSInterrupt  (split reserved 0x8009DFB8-0x8009E7A8; report 0/6; 4 of 6 real C)
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSInterruptInit | 0x8009DFB8 | 116 | byte-exact-claimed | easy | high | src/dolphin/os/OSInterrupt.c |
| __OSMaskInterrupts | 0x8009E304 | 136 | byte-exact-claimed | easy | high | src/dolphin/os/OSInterrupt.c |
| __OSUnmaskInterrupts | 0x8009E38C | 136 | byte-exact-claimed | easy | high | src/dolphin/os/OSInterrupt.c |
| fn_8009E414 | 0x8009E414 | 836 | near | hard | high | src/dolphin/os/OSInterrupt.c |

  Blockers in this unit (use asm `.inc` fallback, do NOT count as wins): SetInterruptMask@0x8009E02C (728B, never decompiled), ExternalInterruptHandler@0x8009E758 (nofralloc asm).

### os/OSTime_range_800A2778  (split reserved 0x800A2778-0x800A27FC; report 0/3; 1 of 3 real C)
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSGetSystemTime | 0x800A2798 | 100 | byte-exact-claimed | easy | medium | src/dolphin/os/OSTime.c |

  OSGetTime@0x800A2778 / OSGetTick@0x800A2790 in this split are genuine nofralloc asm (include as asm).

### os/OSTime near-miss (already wired; configure.py Object + split present)
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| fn_800A2998 | 0x800A2998 | 516 | candidate-only | hard | low | src/dolphin/os/OSTime.c |

  Active src/dolphin/os/OSTime.c is byte-identical to backup; fn_800A2998 stays at 20.1%. Needs a permuter pass, not recovery.

## TIER 2 — real C but need a NEW split + configure.py Object (conflictsWithDtk=TRUE; no symbol rename needed, names already in symbols.txt)

### OSAlarm.c  (5 real-C fns) — OSCreateAlarm@8009A2C8 already matched mid-TU (OSAlarmCreate split) - boundary complication
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| OSInitAlarm | 0x8009A27C | 76 | near | easy | high | src/dolphin/os/OSAlarm.c |
| InsertAlarm | 0x8009A2D8 | 592 | near | hard | high | src/dolphin/os/OSAlarm.c |
| OSSetAlarm | 0x8009A528 | 104 | near | easy | high | src/dolphin/os/OSAlarm.c |
| OSCancelAlarm | 0x8009A590 | 284 | near | moderate | high | src/dolphin/os/OSAlarm.c |
| DecrementerExceptionCallback | 0x8009A6AC | 560 | near | hard | high | src/dolphin/os/OSAlarm.c |

### OSError.c  (3 real-C fns) — region shares auto unit w/ OSContext+ScreenReport leftovers
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| OSReport | 0x8009C2E0 | 128 | near | moderate | high | src/dolphin/os/OSError.c |
| OSSetErrorHandler | 0x8009C360 | 536 | near | hard | high | src/dolphin/os/OSError.c |
| __OSUnhandledException | 0x8009C578 | 744 | near | hard | high | src/dolphin/os/OSError.c |

### OSReset.c  (6 real-C fns) — Reset@8009FF50 is asm; rest real C
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| OSRegisterResetFunction | 0x8009FE38 | 132 | near | moderate | high | src/dolphin/os/OSReset.c |
| fn_8009FEBC | 0x8009FEBC | 148 | near | moderate | high | src/dolphin/os/OSReset.c |
| fn_8009FFC0 | 0x8009FFC0 | 72 | near | easy | high | src/dolphin/os/OSReset.c |
| OSResetSystem | 0x800A0008 | 648 | near | hard | high | src/dolphin/os/OSReset.c |
| OSGetResetCode | 0x800A0290 | 48 | near | easy | high | src/dolphin/os/OSReset.c |
| __OSResetSWInterruptHandler | 0x800A02C0 | 244 | near | moderate | high | src/dolphin/os/OSReset.c |

### OSReboot.c  (1 real-C fns) — fn_800A064C+WriteSram already matched; __OSReboot huge single fn
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSReboot | 0x8009FAF8 | 832 | near | hard | medium | src/dolphin/os/OSReboot.c |

### OSSram.c  (15 real-C fns) — large TU mostly C; fn_800A09B0(776)=PSEUDO transliteration gap (reject that one)
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSInitSram | 0x800A07C4 | 308 | near | moderate | high | src/dolphin/os/OSSram.c |
| __OSLockSram | 0x800A08F8 | 92 | near | easy | high | src/dolphin/os/OSSram.c |
| __OSLockSramEx | 0x800A0954 | 92 | near | easy | high | src/dolphin/os/OSSram.c |
| __OSUnlockSram | 0x800A0CB8 | 36 | near | easy | high | src/dolphin/os/OSSram.c |
| __OSUnlockSramEx | 0x800A0CDC | 36 | near | easy | high | src/dolphin/os/OSSram.c |
| __OSSyncSram | 0x800A0D00 | 16 | near | easy | high | src/dolphin/os/OSSram.c |
| __OSReadROM | 0x800A0D10 | 292 | near | moderate | high | src/dolphin/os/OSSram.c |
| fn_800A0E34 | 0x800A0E34 | 128 | near | moderate | high | src/dolphin/os/OSSram.c |
| fn_800A0EB4 | 0x800A0EB4 | 164 | near | moderate | high | src/dolphin/os/OSSram.c |
| fn_800A0F58 | 0x800A0F58 | 112 | near | easy | high | src/dolphin/os/OSSram.c |
| fn_800A0FC8 | 0x800A0FC8 | 164 | near | moderate | high | src/dolphin/os/OSSram.c |
| fn_800A106C | 0x800A106C | 108 | near | easy | high | src/dolphin/os/OSSram.c |
| fn_800A10D8 | 0x800A10D8 | 132 | near | moderate | high | src/dolphin/os/OSSram.c |
| OSSetWirelessID | 0x800A115C | 172 | near | moderate | high | src/dolphin/os/OSSram.c |
| fn_800A1208 | 0x800A1208 | 32 | near | easy | high | src/dolphin/os/OSSram.c |

### OSInit.c  (5 real-C fns) — OSInit is 984B; shares region w/ EXI/FPRInit
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| ClearArena | 0x800998E0 | 296 | near | moderate | high | src/dolphin/os/OSInit.c |
| InquiryCallback | 0x80099A08 | 60 | near | easy | high | src/dolphin/os/OSInit.c |
| OSInit | 0x80099A44 | 984 | near | hard | high | src/dolphin/os/OSInit.c |
| OSRegisterVersion | 0x8009A250 | 44 | near | easy | high | src/dolphin/os/OSInit.c |
| fn_8009A23C | 0x8009A23C | 20 | near | easy | high | src/dolphin/os/OSInit.c |

### OSException.c  (2 real-C fns) — OSExceptionVector/OSDefaultExceptionHandler/__OSDBIntegrator are asm; 3 #include .inc stubs in archive
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| OSExceptionInit | 0x80099E1C | 640 | near | hard | medium | src/dolphin/os/OSException.c |
| __OSSetExceptionHandler | 0x8009A0C4 | 28 | near | easy | medium | src/dolphin/os/OSException.c |

### OSMemory.c  (8 real-C fns) — Config24MB/Config48MB/RealMode are asm; __OSModuleInit attribution overlaps OSLink
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| fn_8009F1D0 | 0x8009F1D0 | 96 | near | easy | high | src/dolphin/os/OSMemory.c |
| fn_8009F230 | 0x8009F230 | 200 | near | moderate | high | src/dolphin/os/OSMemory.c |
| fn_8009F2F8 | 0x8009F2F8 | 220 | near | moderate | high | src/dolphin/os/OSMemory.c |
| fn_8009F3D4 | 0x8009F3D4 | 12 | near | easy | high | src/dolphin/os/OSMemory.c |
| fn_8009F3E0 | 0x8009F3E0 | 60 | near | easy | high | src/dolphin/os/OSMemory.c |
| MEMIntrruptHandler | 0x8009F41C | 108 | near | easy | high | src/dolphin/os/OSMemory.c |
| fn_8009F488 | 0x8009F488 | 196 | near | moderate | high | src/dolphin/os/OSMemory.c |
| __OSInitMemoryProtection | 0x8009F664 | 280 | near | moderate | high | src/dolphin/os/OSMemory.c |

### OSAudioSystem.c  (2 real-C fns) — small TU; boundary w/ OSArena tail fn_8009AFD0
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSInitAudioSystem | 0x8009AFFC | 444 | near | hard | medium | src/dolphin/os/OSAudioSystem.c |
| __OSStopAudioSystem | 0x8009B1B8 | 216 | near | moderate | medium | src/dolphin/os/OSAudioSystem.c |

### OSCache.c  (3 real-C fns) — rest of OSCache (DC*/IC*/LC*) is asm - only 3 real-C fns
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| L2GlobalInvalidate | 0x8009B628 | 152 | near | moderate | medium | src/dolphin/os/OSCache.c |
| DMAErrorHandler | 0x8009B6C0 | 352 | near | moderate | medium | src/dolphin/os/OSCache.c |
| __OSCacheInit | 0x8009B820 | 244 | near | moderate | medium | src/dolphin/os/OSCache.c |

### OSContext.c  (2 real-C fns) — same TU as asm context fns; OSSaveContext/OSLoadContext etc are nofralloc asm
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| OSDumpContext | 0x8009BE40 | 680 | near | hard | medium | src/dolphin/os/OSContext.c |
| __OSContextInit | 0x8009C16C | 72 | near | easy | medium | src/dolphin/os/OSContext.c |

### OSSystemCall.c  (1 real-C fns) — __OSSystemCallVector is asm
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSInitSystemCall | 0x800A1228 | 100 | near | easy | low | src/dolphin/os/OSSystemCall.c |

### OSThread.c  (1 real-C fns) — head of original OSThread TU; currently in catch-all before OSThreadQueue split
| fn | DTK addr | size | conf | ease | value | source |
|----|----------|------|------|------|-------|--------|
| __OSThreadInit | 0x800A1290 | 344 | near | moderate | medium | src/dolphin/os/OSThread.c |

## REJECTED (non-recoverable — documented so they are not re-proposed)
- **OSSaveContext/OSLoadContext/OSGetStackPointer/OSSwitchFiber** (os/OSContext skeleton 0x8009BBD0-0x8009BD60) — all 4 are nofralloc inline asm - genuinely asm, no C form
- **SetInterruptMask** (0x8009E02C (os/OSInterrupt skeleton)) — 728B never decompiled; extern stub in both archive+backup - blocks 100% unit but not the 4 C fns
- **ExternalInterruptHandler** (0x8009E758 (os/OSInterrupt)) — nofralloc asm (context-save tail)
- **fn_800A09B0** (0x800A09B0 (OSSram)) — PSEUDO register-transliteration (776B) - will not match
- **OSGetTime/OSGetTick** (0x800A2778/0x800A2790 (OSTime_range)) — nofralloc asm (mftbu/mftb)
- **OSMutex.c (OSInitMutex,OSLockMutex,OSUnlockMutex,OSTryLockMutex,__OSUnlockAllMutex,OSInitCond,OSWaitCond,OSSignalCond)** (n/a) — ABSENT from symbols.txt - dead-stripped, NO DTK target
- **OSStateFlags.c (__OSGet/SetStateFlags,DiscState,BootMode,AppType,...)** (n/a) — ABSENT from symbols.txt - dead-stripped
- **OSUtility.c (IsLeapYear,OSTicksToCalendarTime,OSCalendarTimeToTicks)** (n/a) — ABSENT from symbols.txt - dead-stripped
- **OSEXI.c RTC stubs (__OSGetRTC,__OSSetRTC,__OSReadFontROM,__OSGetSerialNumber...)** (n/a) — ABSENT from symbols.txt (real EXI bios lives in exi/ subsystem, out of scope)
- **PPCArch.c (PPCMtmsr,PPCMfhid0,...~20 fns)** (0x80097FFC-0x80098108) — all nofralloc asm; PPCDisableSpeculation already matched
- **OSCache DC*/IC*/LC* (DCEnable,DCInvalidateRange,DCFlushRange,ICInvalidateRange,...)** (0x8009B290-0x8009B538) — nofralloc asm cache ops

## DTK pipeline steps to reintroduce a Tier-1 skeleton (e.g. OSThread)
1. Create src/dolphin/os/OSThread.c containing the 20 split functions IN ADDRESS ORDER (0x800A1404..0x800A26CC), bodies taken from backup OSThread.c; for any still-unmatched, keep an `asm { #include ".../fn_XXXX.inc" }` fallback so the unit still builds.
2. Add the headers/externs: dolphin/os/OSThread.h, OSContext.h, OSInterrupt.h, OSTime.h; extern the inlined helpers it calls.
3. In configure.py, add `Object(Matching, "dolphin/os/OSThread.c")` to the OS GameLib objects list (split unit + symbols already exist — NO splits.txt or symbols.txt edit).
4. configure.py -> ninja -> inspect build/GC6E01/report.json for the os/OSThread unit; per-function fuzzy=100 banks the match.

## DTK pipeline steps to reintroduce a Tier-2 TU (e.g. OSAlarm)
1. Determine the original .o boundary (old objdiff_report.json confirms one unit per OS file, e.g. dolphin/os/OSAlarm). Add a splits.txt unit `dolphin/os/OSAlarm.c:` with `.text start:0x8009A27C end:<next-TU-start>` — BUT note OSCreateAlarm@0x8009A2C8 is already carved into the OSAlarmCreate split, so the new split must skip/overlap-handle that address (boundary complication).
2. Add `Object(Matching,"dolphin/os/OSAlarm.c")` in configure.py.
3. Source src/dolphin/os/OSAlarm.c from backup (all funcs in address order; DecrementerExceptionHandler stays asm).
4. Rebuild + read report.json.