# TRK (MetroTRK) Recovery Inventory — Pokemon Colosseum GC6E01

Scope: `archive/previous_campaign/src/trk` (11 .c) + backup branch `backup/local-master-pre-sync-20260630:src/trk` (14 .c).

## Headline
- **56 currently-UNMATCHED DTK functions** have CLEAN, byte-matching-quality C in the prior campaign (archive and/or backup branch), across **16 reserved ahead-of-source skeleton split units**.
- Confidence: **18 near** (trivial, near-certain byte-exact), **38 candidate-only** (structured, unverified — no build/match log exists in the archive, so none are build-proven).
- NONE are already reclaimed (the 12 reclaim commits + the uncommitted 39-unit splits batch are skeletons WITHOUT src; this sources them).
- Symbol names in `config/GC6E01/symbols.txt` MATCH the campaign names exactly for every named target (TRKGetNextEvent, ddh_cc_open, InitMetroTRKCommTable, TRK_main, ...). **No symbols.txt rename needed -> conflictsWithDtk = false for all.**

## Key source-quality notes
- `ddh_cc.c`, `gdev_cc.c`, `udp_cc.c`, `TRKUtil.c`, `TRKSaveState.c` are BYTE-IDENTICAL between archive and backup branch.
- The **backup branch is strictly newer/cleaner** than the archive for TRKNub.c (e.g. `fn_800BE934`,`fn_800BE9CC` are structured C in backup but register-vomit in archive). Backup also adds **TRKBoard.c, TRKComm.c, TRKSerial.c** which the archive lacks. **Prefer the backup-branch copy** where flagged.
- Read via: `git -C /Users/douglaswhittingham/pkmn-colosseum show backup/local-master-pre-sync-20260630:src/trk/<file>.c` (a working extract is in `recovery/backup_trk/`).

## Reusable DTK reintroduction recipe
Two paths depending on whether the WHOLE reserved skeleton unit is clean:

**A. Whole-unit (cleanest — unit's every fn is clean real C):** ddh_cc_range_800C3C00, ddh_cc_range_800C3E90, gdev_cc_range_800C41AC, gdev_cc_range_800C4444, TRKBuffer, TRKSerial_range_800BF088, TRKTarget_range_800C1310, TRKComm_range_800C3678.
1. Drop the real C at `src/trk/<unit>.c` (the split path already named in splits.txt).
2. In `configure.py`, add `Object(Matching, "trk/<unit>.c", progress_category="sdk")` (or flip the existing `CodeCandidate` entry to `Matching`).
3. `splits.txt` already reserves the unit's `.text start/end` range — no split edit needed.
4. Run configure.py + ninja; objdiff/report.json should show the unit 100% and link it into the DOL.

**B. Per-function carve (mixed unit — only some fns clean):** for a clean fn inside e.g. TRKTarget_range_800C1348.
1. In `splits.txt`, split the big range at the fn boundary into its own `trk/<fn>.c: .text start:<addr> end:<addr+size>` unit (leaving the asm/vomit remainder as the residual range unit).
2. Add `Object(Matching, "trk/<fn>.c")` in configure.py and place the single-fn C in `src/trk/<fn>.c`.
3. configure.py + ninja; bank the single-fn match. (This mirrors how TRKConstructEvent.c / TRKBufferReset.c were already carved as 1-fn units.)

## Candidates by skeleton unit

### `ddh_cc_range_800C3C00.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `ddh_cc_initinterrupts` | 0x800C3C00 | 0x24 | near | trivial | high | archive==backup | calls fn_800CE7A0 then return 0; matches 36B |
| `ddh_cc_peek` | 0x800C3C24 | 0x70 | candidate-only | easy | high | archive==backup | AMC_Peek->read into 0x800 tmp->FIFO push; 112B |
| `ddh_cc_post_stop` | 0x800C3C94 | 0x24 | near | trivial | high | archive==backup | calls fn_800CE7BC; return 0 |
| `ddh_cc_pre_continue` | 0x800C3CB8 | 0x24 | near | trivial | high | archive==backup | calls fn_800CE7C0; return 0 |
| `ddh_cc_write` | 0x800C3CDC | 0xC0 | candidate-only | easy | high | archive==backup | open-flag check + MWTRACE + chunked AMC_Write loop; 192B |
| `ddh_cc_read` | 0x800C3D9C | 0xEC | candidate-only | easy | high | archive==backup | FIFO poll/refill loop + FIFO_Pop; 236B |

### `ddh_cc_range_800C3E90.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `ddh_cc_open` | 0x800C3E90 | 0x24 | near | trivial | high | archive==backup | if flag!=0 return -10005 else flag=1 return 0 |

### `gdev_cc_range_800C41AC.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `gdev_cc_initinterrupts` | 0x800C41AC | 0x24 | near | trivial | high | archive==backup | calls fn_800CEB64; return 0 |
| `gdev_cc_peek` | 0x800C41D0 | 0x70 | candidate-only | easy | high | archive==backup | GDEV_Peek->0x500 tmp->FIFO push; 112B |
| `gdev_cc_post_stop` | 0x800C4240 | 0x24 | near | trivial | high | archive==backup | calls fn_800CE7D8; return 0 |
| `gdev_cc_pre_continue` | 0x800C4264 | 0x24 | near | trivial | high | archive==backup | calls fn_800CE7D4; return 0 |
| `gdev_cc_write` | 0x800C4288 | 0xC0 | candidate-only | easy | high | archive==backup | chunked GDEV_Write loop; 192B |
| `gdev_cc_read` | 0x800C4348 | 0xF4 | candidate-only | easy | high | archive==backup | FIFO poll/refill + FIFO_Pop; 244B (extra requestedSize local vs ddh) |

### `gdev_cc_range_800C4444.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `gdev_cc_open` | 0x800C4444 | 0x24 | near | trivial | high | archive==backup | flag check/set; mirror of ddh_cc_open |

### `TRKBuffer.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `fn_800BEF44` | 0x800BEF44 | 0xC8 | candidate-only | easy | high | archive==backup | TRKAcquireBuffer: 3-slot mutex scan, claim free buffer, 0x300 if none; 200B |
| `TRKInitializeMessageBuffers` | 0x800BF00C | 0x74 | candidate-only | easy | high | archive==backup | loop 3 buffers: init/acquire/clear inUse/release; 116B |

### `TRKSerial_range_800BF088.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `TRKInitializeSerialHandler` | 0x800BF088 | 0xC4 | candidate-only | easy | high | backup-only | clean structured C in backup TRKSerial.c; whole reserved unit = 1 fn |

### `TRKTarget_range_800C1310.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `fn_800C1310` | 0x800C1310 | 0x18 | near | trivial | high | archive==backup | gTRKState[0x98]=1; return 0; whole unit=1 fn; 24B |

### `TRKComm_range_800C3678.c` — WHOLE-UNIT BANKABLE (path A)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `TRKInitializeIntDrivenUART` | 0x800C3678 | 0x50 | candidate-only | easy | high | backup-only | comm-table[0] init(callback,pending)+comm-table[6] initInterrupts; 80B |
| `InitMetroTRKCommTable` | 0x800C36C8 | 0x26C | candidate-only | moderate | high | backup-only | big channel switch populating gDBCommTable for ddh/gdev/udp; OSReport pooled strings; 620B |
| `TRKEXICallBack` | 0x800C3934 | 0x38 | near | easy | high | backup-only | OSEnableScheduler(); TRKLoadContext(ctx,0x500); 56B |
| `TRKTargetContinue` | 0x800C396C | 0x34 | candidate-only | easy | high | archive==backup | clean in TRKTarget.c; 4th fn of TRKComm_range unit; 52B |

### `TRKNub_range_800BE47C.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `TRKGetNextEvent` | 0x800BE55C | 0xB4 | candidate-only | moderate | medium | backup>archive | clean dequeue w/ mutex+memcpy; named symbol matches; 180B |
| `TRKInitializeEventQueue` | 0x800BE610 | 0x58 | candidate-only | moderate | medium | backup>archive | init mutex + zero queue + seq=0x100; 88B |
| `TRKNubWelcome` | 0x800BE668 | 0x28 | near | easy | medium | backup>archive | TRK_board_display("MetroTRK for Dolphin different from R4.0"); 40B (string must match rodata) |
| `TRKTerminateNub` | 0x800BE690 | 0x24 | near | trivial | medium | backup>archive | calls fn_800BF080; return 0; 36B |
| `TRKInitializeNub` | 0x800BE6B4 | 0x14C | candidate-only | hard | medium | backup>archive | endian-detect + ordered subsystem init chain; MWTRACE string; 332B |
| `MessageSend` | 0x800BE800 | 0x44 | candidate-only | moderate | medium | backup>archive | fn_800C3588(p+0x10,*(p+8))+MWTRACE; 68B |
| `fn_800BE934` | 0x800BE934 | 0x98 | candidate-only | moderate | medium | backup-only-clean | clean in BACKUP (archive was vomit): buffer-append loop; 152B |
| `fn_800BE9CC` | 0x800BE9CC | 0xE8 | candidate-only | moderate | medium | backup-only-clean | clean in BACKUP: 8-byte endian-swap copy; 232B |
| `fn_800BEBB0` | 0x800BEBB0 | 0x68 | candidate-only | moderate | medium | backup>archive | byte-append to buffer w/ 0x880 cap; 104B |
| `fn_800BEC18` | 0x800BEC18 | 0xFC | candidate-only | moderate | medium | backup>archive | 8-byte write w/ endian swap; 252B |
| `fn_800BED14` | 0x800BED14 | 0x8C | candidate-only | easy | medium | backup>archive | read n bytes from msg buffer; struct TRKMessageBuffer; 140B |
| `fn_800BEDA0` | 0x800BEDA0 | 0xA4 | candidate-only | easy | medium | backup>archive | write n bytes to msg buffer; 164B |

### `TRKNub_range_800BEE74.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `fn_800BEE74` | 0x800BEE74 | 0x40 | candidate-only | easy | medium | archive==backup | TRKResetBuffer: zero pos fields + optional memset 0x880; 64B |

### `TRKDispatch_range_800C0504.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `fn_800C0504` | 0x800C0504 | 0xA8 | candidate-only | easy | medium | archive==backup | hex-dump via MWTRACE every 16 bytes; pooled fmt strings; 168B |

### `TRKDispatch_range_800C0CD8.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `fn_800C0DA8` | 0x800C0DA8 | 0xB8 | candidate-only | easy | medium | archive==backup | CW __fill_mem/memset-style word-unrolled fill; 184B |

### `TRKInterrupt.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `fn_800C123C` | 0x800C123C | 0xC4 | candidate-only | moderate | medium | archive==backup | save/restore exception status around fn_800C2EAC/3098 dispatch; 196B |

### `TRKTarget_range_800C1348.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `TRKTargetSupportRequest` | 0x800C1348 | 0x200 | candidate-only | hard | medium | archive==backup | syscall reason dispatch 0xD0-0xD4; 512B; many extern handlers |
| `fn_800C1548` | 0x800C1548 | 0x10 | near | trivial | medium | archive==backup | return *(s32*)&gTRKCPUState[0x80]; 16B |
| `TRKTargetStepOutOfRange` | 0x800C1558 | 0xB8 | candidate-only | moderate | medium | archive==backup | set bp range, OR MSR 0x400 trace bit, clear stopped; 184B |
| `TRKTargetSingleStep` | 0x800C1610 | 0xAC | candidate-only | moderate | medium | archive==backup | single-step setup, MSR trace bit; 172B |
| `fn_800C16BC` | 0x800C16BC | 0x84 | candidate-only | moderate | medium | archive==backup | build 0x40 notify msg (type 0x91) + fn_800BEBB0; 132B |
| `fn_800C1740` | 0x800C1740 | 0x8C | candidate-only | moderate | medium | archive==backup | build 0x40 notify msg (type 0x90); 140B |
| `TRKTargetInterrupt` | 0x800C17CC | 0x190 | candidate-only | hard | medium | archive==backup | interrupt/break handling, breakpoint match; 400B |
| `TRKPostInterruptEvent` | 0x800C195C | 0xAC | candidate-only | moderate | medium | archive==backup | construct+post break event; 172B |

### `TRKInit.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `TRKInitializeTarget` | 0x800C31CC | 0x4C | candidate-only | easy | medium | archive==backup | set stopped, read MSR, set exc table base 0xE0000000; 76B |
| `fn_800C3218` | 0x800C3218 | 0x12C | candidate-only | moderate | medium | archive==backup | copy interrupt vector table entries w/ addr translation; 300B |
| `fn_800C3344` | 0x800C3344 | 0x58 | candidate-only | easy | medium | archive==backup | phys->virt addr translation w/ stack/HW range checks; 88B |
| `EnableMetroTRKInterrupts` | 0x800C339C | 0x20 | near | trivial | medium | archive==backup | calls fn_800C3630; 32B |

### `TRKBoard_range_800C33BC.c` — mixed unit, per-fn carve (path B)

| fn | DTK addr | size | confidence | ease | value | src | evidence |
|---|---|---|---|---|---|---|---|
| `TRK_main` | 0x800C33BC | 0x58 | candidate-only | easy | medium | archive==backup | InitNub->Welcome->MainLoop->Terminate; MWTRACE string; 88B |
| `TRKUARTInterruptHandler` | 0x800C349C | 0x4 | near | trivial | medium | backup-only | empty function (blr); 4B |
| `InitializeProgramEndTrap` | 0x800C34A0 | 0x58 | candidate-only | easy | medium | backup-only | copy EndofProgramInstruction to PPCHalt+4 + IC/DC flush; 88B |
| `TRK_board_display` | 0x800C34F8 | 0x30 | near | easy | medium | backup-only | OSReport("TRK: %s\n", msg); 48B (string must match) |
| `UnreserveEXI2Port` | 0x800C3528 | 0x30 | near | easy | medium | backup-only | call gDBCommTable[8](); 48B |
| `ReserveEXI2Port` | 0x800C3558 | 0x30 | near | easy | medium | backup-only | call gDBCommTable[9](); 48B |

## Bonus: active-unit improvements (already in active src/ — NOT counted as skeleton recoveries)
- **fn_800C39BC / fn_800C3A40 / fn_800C3AFC** (TRKComm.c (ACTIVE, 77.9%)) — src: `src/trk/TRKComm.c (backup branch)`. backup provides clean C for all 3 active-unit fns; could lift active TRKComm.c 77.9%->100%. Already in active src -> not a skeleton recovery.
- **TRKGetInput / fn_800BF14C / fn_800BF33C** (TRKSerial.c (ACTIVE, 21%)) — src: `src/trk/TRKSerial.c (backup branch)`. backup provides clean C; could raise active TRKSerial.c match. Already in active src.
- **fn_800C3588 / fn_800C35C4** (TRKBoard.c (ACTIVE, 66.6%)) — src: `src/trk/TRKBoard.c (backup branch)`. 2 of 3 clean but fn_800C3600 is register-vomit -> active unit can't fully match yet.

## Rejected (non-recoverable per rules: asm/nofralloc, inline asm{}, register-vomit, speculative, already-matched)
- `TRKSaveExtended1Block / TRKRestoreExtended1Block` [TRKSaveState (0x800C2A10/0x800C2BC8)] — asm/nofralloc hand-written SPR save/restore
- `InitMetroTRK / InitMetroTRK_BBA / TRKLoadContext` [TRKInit / TRKBoard_range_800C33BC] — asm/nofralloc
- `TRKInterruptHandler/TRKExceptionHandler/TRKSwapAndGo/TRKInterruptHandlerEnableInterrupts` [TRKInterrupt] — asm/nofralloc
- `fn_800C0E68 / fn_800C0E70` [TRKDispatch_range_800C0CD8] — inline asm{} blocks
- `fn_800C29F0/F8/2A00/2A08` [TRKTarget_range_800C1348] — inline asm{ twi 31,r0,0 }
- `fn_800BE844 / fn_800BEAB4` [TRKNub_range_800BE47C] — register-transliteration vomit (fake rN vars, no-arg fn-ptr calls)
- `fn_800C08C0` [TRKDispatch_range_800C0504] — register-vomit
- `fn_800C2EAC / fn_800C3098` [TRKInit] — register-vomit (cache-flush loops w/ commented opcodes)
- `fn_800C11F4 / fn_800C1218` [TRKInterrupt] — register-vomit (mffs/mtfsf as comments)
- `fn_800C1A08/1E40/1FB0/24BC/25FC/2748` [TRKTarget_range_800C1348] — register-vomit (6 fns)
- `fn_800C3600` [TRKBoard.c active] — register-vomit
- `TRKUtil.c TRK_memcpy/memset/strlen/strcat` [speculative @0x800C3B00 (inside active TRKComm.c)] — not mapped to real skeleton fns; junk
- `udp_cc.c (9 weak stubs)` [udp_cc (ACTIVE 100%)] — already matched in active src

## Recommended first batch (bank fast, highest confidence x value)
1. **ddh_cc_range_800C3C00.c** (6 fns) + **ddh_cc_range_800C3E90.c** (ddh_cc_open) — whole units, all clean, archive==backup. Path A.
2. **gdev_cc_range_800C41AC.c** (6 fns) + **gdev_cc_range_800C4444.c** (gdev_cc_open) — mirror of ddh; whole units. Path A.
3. **TRKBuffer.c** (fn_800BEF44 + TRKInitializeMessageBuffers) — whole 2-fn unit. Path A.
4. **TRKTarget_range_800C1310.c** (fn_800C1310, 24B) + **TRKSerial_range_800BF088.c** (TRKInitializeSerialHandler) — whole 1-fn units. Path A.
These are 8 reserved units / ~18 functions with zero asm/vomit and no symbol conflicts — the lowest-risk way to bank TRK matches before tackling the larger mixed units (TRKComm_range, TRKBoard_range, TRKNub_range, TRKTarget_range_800C1348) via per-fn carving.

> Caveat: no per-function match log survives in the archive (progress.json tracked only 9 completed, none TRK), so EVERY candidate is build-unverified. 'near' = so simple a CW1.2.5n compile is near-certain to be byte-exact; 'candidate-only' = structured & plausible but must be objdiff-confirmed after reintroduction. The string-bearing fns (TRKNubWelcome, TRK_board_display, InitMetroTRKCommTable, TRKInitializeNub, TRK_main) additionally require their rodata string to match the pooled original.