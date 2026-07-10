# Recovery Inventory — Subsystem: dvd + db

Generated: 2026-06-30. STRICT READ-ONLY analysis. No repos modified.

Scope: `archive/previous_campaign/src/dolphin/dvd/*` , `.../db/DB.c`, plus backup branch
`backup/local-master-pre-sync-20260630` equivalents.

DTK source of truth:
- `config/GC6E01/symbols.txt` (canonical addr->name)
- `config/GC6E01/splits.txt` (split units; the "ahead-of-source skeletons")
- `build/GC6E01/report.json` (current match status — parsed, NOT rebuilt)
- `configure.py` objects use `Object(CodeCandidate, "path.c", progress_category="sdk")`;
  CodeCandidate == NonMatching but is still compared by objdiff, so a byte-exact `.c`
  added against a reserved split immediately shows as matched in report.json.

---

## Method / Ground Truth Established

The active `src/` already contains the *reclaimed* siblings of these archive files, all at
100% fuzzy in report.json, proving the archive is the lineage these were sourced from:

| Active matched file | Function | Archive origin |
|---|---|---|
| `src/dolphin/db/DBInit.c` | DBInit 0x800A2C30 | DB.c DBInit |
| `src/dolphin/db/DBGetFirstCallback.c` | fn_800A2C58 0x800A2C58 | DB.c fn_800A2C58 |
| `src/dolphin/db/DBIsExceptionMarked.c` | __DBIsExceptionMarked 0x800A2CCC | DB.c __DBIsExceptionMarked |
| `src/dolphin/db/DBPrintf.c` | DBPrintf 0x800A2CE8 | DB.c DBPrintf |
| `src/dolphin/dvd/DVDLowInitWA.c` | __DVDInitWA 0x800A3EB0 | DVDLow.c __DVDInitWA |
| `src/dolphin/dvd/DVDLowSetWAType.c` | __DVDLowSetWAType 0x800A4CAC | DVDLow.c __DVDLowSetWAType |
| `src/dolphin/dvd/DVDFs.c` | __DVDFSInit 0x800A4CF0 | DVDFs.c __DVDFSInit |
| `src/dolphin/dvd/DVDError.c` | __DVDStoreErrorCode 0x800A80FC | DVDError.c __DVDStoreErrorCode |
| `src/dolphin/dvd/DVDQueue.c` | __DVDCheckWaitingQueue 0x800A7F28 | DVDQueue.c __DVDCheckWaitingQueue |

Archive `DVDError.c` is byte-identical to the backup-branch version (`diff` == IDENTICAL).
Archive DTK-target names use an address suffix (e.g. `__DVDClearWaitingQueue_803FC3F8`,
`WaitingQueue_803FC3F8`); the DTK canonical names are unsuffixed — the active DVDQueue.c
already demonstrates the trivial rename that was applied to the reclaimed sibling.

---

## TIER 1 — Clean wins (reserved ahead-of-source split, near-confidence)

### C1. ErrorCode2Num  — 0x800A7FE0  size 0x11C   [TOP PICK]
- Archive C: `archive/previous_campaign/src/dolphin/dvd/DVDError.c` lines 32-82
  (`static u32 ErrorCode2Num(u32 error)`).
- DTK target: `symbols.txt:1743  ErrorCode2Num = .text:0x800A7FE0 size:0x11C scope:local`.
- report.json: unit `main/dolphin/dvd/DVDError_ErrorCode2Num`, function `ErrorCode2Num_800A7FE0`,
  fuzzy = None => **UNMATCHED**. src_path = None.
- Reserved split EXISTS: `splits.txt:254  dolphin/dvd/DVDError_ErrorCode2Num.c:`
  `.text start:0x800A7FE0 end:0x800A80FC` — i.e. the split spans exactly this one function.
- Confidence: **near**. Value: **high**. Ease: **trivial**. conflictsWithDtk: **false**.
- Evidence: the split + symbol are already reserved as an ahead-of-source skeleton; the body
  is a deliberately-unrolled 2x9 comparison loop written to reproduce the `bdnz` codegen; the
  caller `__DVDStoreErrorCode` (which references `ErrorCode2Num`) is already matched 100%.
- Pipeline to reintroduce:
  1. Create `src/dolphin/dvd/DVDError_ErrorCode2Num.c` containing only `ErrorCode2Num`
     (copy lines 32-82 of archive DVDError.c; keep `static u32 ErrorCode2Num(u32)`; supply
     `extern const u32 ErrorCodeTable[];` decl as in archive).
  2. `configure.py`: add `Object(CodeCandidate, "dolphin/dvd/DVDError_ErrorCode2Num.c",
     progress_category="sdk")` in the Runtime.PPCEABI.H lib list (next to the existing
     `dolphin/dvd/DVDError.c` object).
  3. Run configure.py + ninja; objdiff compares against the reserved 0x800A7FE0-0x800A80FC
     split. If byte-exact, report.json flips this unit to matched.
  4. NO symbols.txt edit, NO splits.txt edit, NO object_map edit required.

---

## TIER 2 — Sourceable, needs reserved-split companion or local rename

### C2. __DBExceptionDestinationAux — 0x800A2C74  size 0x48
- Archive C: `archive/.../src/dolphin/db/DB.c` lines 41-50 (`__DBExceptionDestinationAux`).
- DTK target: `symbols.txt:1618  __DBExceptionDestinationAux = .text:0x800A2C74 size:0x48`.
- report.json: unit `main/dolphin/db/DB`, fuzzy = None => **UNMATCHED**. src_path = None.
- Reserved split EXISTS: `splits.txt:227  dolphin/db/DB.c:` `.text start:0x800A2C74 end:0x800A2CCC`.
  NOTE: this split covers TWO functions — Aux (0x800A2C74,0x48) AND `__DBExceptionDestination`
  (0x800A2CBC,0x10). The split only matches if BOTH are present in the `.c`.
- Confidence: **near** (Aux). Value: **medium**. Ease: **moderate** (paired asm companion).
  conflictsWithDtk: **false** (split + symbols reserved).
- Evidence: all four DB.c siblings already matched 100% from this same archive file.
- Companion required (see C2b).

### C2b. __DBExceptionDestination — 0x800A2CBC  size 0x10  (asm companion, NOT a standalone win)
- Archive: `DB.c` lines 59-65, written as `asm { nofralloc; mfmsr; ori r3,r3,0x30; mtmsr; b __DBExceptionDestinationAux }`.
- Per recovery rules this inline-asm body is normally REJECTED, but it is the mandatory second
  function of the reserved `DB.c` split; a 0x10 MSR-manipulation that legitimately must be asm.
  It is byte-exact by construction (it IS the disassembly). Treat as the required companion to C2,
  not as an independent reclaim.
- Pipeline for C2+C2b:
  1. Create `src/dolphin/db/DB.c` with BOTH `__DBExceptionDestinationAux` (real C from archive,
     reads `*(u32*)0xC0`, calls OSReport/OSDumpContext/PPCHalt) and the `asm` `__DBExceptionDestination`.
  2. `configure.py`: add `Object(CodeCandidate, "dolphin/db/DB.c", progress_category="sdk")`.
  3. configure.py + ninja; both functions live in the reserved 0x800A2C74-0x800A2CCC split.
  4. NO symbols.txt / splits.txt / object_map edits.

### C3. __DVDClearWaitingQueue — 0x800A7DE8  size 0x38
### C4. __DVDPushWaitingQueue  — 0x800A7E20  size 0x68
### C5. __DVDPopWaitingQueue   — 0x800A7E88  size 0xA0
- Archive C: `archive/.../src/dolphin/dvd/DVDQueue.c` (real, clean linked-list C; names carry
  the `_803FC3F8` suffix and reference `WaitingQueue_803FC3F8[4]`).
- DTK targets: `symbols.txt:1738-1740` `__DVDClearWaitingQueue/​__DVDPushWaitingQueue/​__DVDPopWaitingQueue`
  (unsuffixed).
- report.json: all three live in unit `main/auto_01_800A4D28_text` (a large auto-generated asm
  blob), fuzzy = None => **UNMATCHED**. src_path = None.
- The reclaimed sibling `__DVDCheckWaitingQueue` already occupies its own split
  `splits.txt:248 dolphin/dvd/DVDQueue.c: .text start:0x800A7F28 end:0x800A7F80` and is matched.
  These three functions sit at 0x800A7DE8-0x800A7F28, immediately BEFORE that split, still owned
  by the auto blob.
- Confidence: **near** (sibling matched from same file; trivial code). Value: **medium-high**
  (0x140 bytes / 3 funcs). Ease: **moderate**. conflictsWithDtk: **true** (requires carving the
  0x800A7DE8-0x800A7F28 range out of `auto_01_800A4D28_text` = splits.txt/object_map edit; plus
  local rename dropping the `_803FC3F8` suffix on functions and on `WaitingQueue`).
- Pipeline:
  1. In `splits.txt`, extend/insert a `dolphin/dvd/DVDQueue.c` split to cover
     `.text start:0x800A7DE8 end:0x800A7F80` (absorbing the three functions; the auto blob loses
     that range). (This is the object-map edit; flagged conflict.)
  2. Add the three functions to `src/dolphin/dvd/DVDQueue.c`, renamed to the DTK canonical names
     and using the DTK global `WaitingQueue` (no `_803FC3F8`), matching the style already present
     in that file for `__DVDCheckWaitingQueue`.
  3. The configure.py object `dolphin/dvd/DVDQueue.c` already exists — no new object needed.
  4. configure.py + ninja; objdiff compares. NO symbols.txt edit (names already canonical there).

---

## TIER 3 — DVDLow.c hybrid split (high value, candidate-only, all-or-nothing risk)

The reserved skeleton `splits.txt:239 dolphin/dvd/DVDLow.c: .text start:0x800A3EF0 end:0x800A4CAC`
is ONE object spanning 18 functions. ~11 of them are asm-only in the archive
(`#include "src/dolphin/dvd/DVDLow_fn_*.inc"`) and are REJECTED as recoverable C. The split will
only flip to matched if the ENTIRE object is byte-exact — so the real-C bodies below must ALL match
simultaneously (or each be carved into its own sub-split via object_map edits, as was done for
DVDLowInitWA.c / DVDLowSetWAType.c). The real-C bodies look paraphrased (magic constants, hand
busy-wait) and are unverified — treat as candidate-only.

Real-C functions present in archive `DVDLow.c` (all report.json unit `main/dolphin/dvd/DVDLow`,
fuzzy=None => UNMATCHED):

| Cand | Function | Addr | Size | Archive lines | Note |
|---|---|---|---|---|---|
| C6  | AlarmHandlerForTimeout | 0x800A4254 | 0x70 | 76-93   | static; masks int 0x400, ctx swap |
| C7  | DVDLowWaitCoverClose   | 0x800A4780 | 0x2C | 99-108  | small, plausible |
| C8  | DVDLowStopMotor        | 0x800A4850 | 0x8C | 114-132 | OSCreateAlarm/OSSetAlarm |
| C9  | DVDLowReset            | 0x800A4BC4 | 0xBC | 138-170 | magic 0x431CDE83 busy-wait — risky |
| C10 | fn_800A4C80            | 0x800A4C80 | 0x14 | 390-394 | #else-enabled real C |
| C11 | fn_800A4C94            | 0x800A4C94 | 0x18 | 403-409 | #else-enabled real C |

- Confidence: **candidate-only**. Value: **high** if the whole split lands. Ease: **hard**.
  conflictsWithDtk: **true** (either generate/keep the `DVDLow_fn_*.inc` asm for the 11 asm funcs
  so the single hybrid object matches, OR carve each real-C func into its own sub-split = object_map edits).
- Recommendation: defer until C1-C5 are banked; then attempt per-function carve-outs of C7/C8/C10/C11
  (the small, low-risk ones) into their own splits, validating each in objdiff before trusting C9.

---

## REJECTED (not recoverable wins)

- `DVDLow.c` asm `#include .inc` bodies: fn_800A41D0, fn_800A42C4, fn_800A43D4, fn_800A4454,
  fn_800A46EC, fn_800A47AC, fn_800A48DC, fn_800A4968, fn_800A4A04, fn_800A4A9C, fn_800A4B28
  — asm wrappers / `.inc` includes.
- `DVD.c` (whole file): paraphrased stubs (stateBusy empty; DVDCancel guesses state=10;
  `__DVDStoreErrorCode` at WRONG addr 0x800A7728 size 0x4C is a stub conflicting with the real
  one at 0x800A80FC; duplicate/contradictory getters vs DVDOpen.c). Not byte-exact.
- `DVDOpen.c` (whole file): simplified stubs; DVDReadAbsAsyncPrio/DVDGetTransferredSize
  contradict DVD.c versions; addresses 0x800A2D38-0x800A3EB0 sit in auto blobs. Not byte-exact.
- `DVDState.c` (whole file): explicit "stub/nop" reconstructions; empty DVDCancel body. Junk.
- `DVDFs.c` fn_800A4D28: register-soup pseudo-C (`return;` inside an s32 function, undefined
  locals). Uncompilable. The neater fn_800A501C/5108/5268/532C/541C/5558 bodies target the
  DVDFsExtras/auto-blob region (0x800A501C+), overlap the existing CodeCandidate `DVDFsExtras.c`
  reconstructions, and are speculative — candidate-only at best, no reserved 1:1 split, excluded.
- `DB.c` `DBPrintf` (asm) and `fn_800A2C58` — already MATCHED/reclaimed in active src. Drop.
- `__DBExceptionDestination` standalone — asm; only valid as the C2 split companion.

---

## Counts

- Archive files reviewed: 8 (DVD.c, DVDError.c, DVDFs.c, DVDLow.c, DVDOpen.c, DVDQueue.c,
  DVDState.c, DB.c).
- Real-C recovery candidates (unmatched + unreclaimed): 11
  (C1 + C2/C2b + C3 + C4 + C5 + C6..C11; C2b counted as required companion of C2).
- Near-confidence / realistically bankable now: 5  (C1, C2(+C2b), C3, C4, C5).
- Reserved ahead-of-source skeleton splits in scope that are sourceable from the archive: 3
  (DVDError_ErrorCode2Num.c -> fully; DB.c -> with asm companion; DVDLow.c -> partial/risky).
- Drop-in-ready (reserved split + single function + only a configure.py object needed): 1 (C1).

## Recommended first batch

1. **C1 ErrorCode2Num** (0x800A7FE0) — drop archive C into the already-reserved
   `dolphin/dvd/DVDError_ErrorCode2Num.c` split, add one `Object(CodeCandidate, ...)` to
   configure.py. Zero symbols/splits/object_map edits. Highest reward / lowest risk.
2. **C2(+C2b) DB.c** — reserved `dolphin/db/DB.c` split; add both Aux (C) + ExceptionDestination
   (asm) and a configure.py object. Banks a 0x48 function.
3. **C3/C4/C5 queue trio** — extend the `DVDQueue.c` split backward over 0x800A7DE8-0x800A7F28
   (carve from the auto blob), copy the three archive queue functions with the DTK rename. Banks 0x140.
