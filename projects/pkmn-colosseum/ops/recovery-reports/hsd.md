# HSD Subsystem — Recovery Inventory

Subsystem: HAL HSD lib (jobj/pobj/mobj/mtx). Scope: `archive/previous_campaign/src/hsd` (+ backup branch `src/hsd`, which is **byte-identical** to the archive for every file inspected below).

Generated read-only. No repo was modified. DTK config (`config/GC6E01/symbols.txt`, `splits.txt`, `build/GC6E01/report.json`) treated as source of truth.

## Key facts established

- DTK reserved HSD `.text` splits cover only **0x801A8428 – 0x801B0158** (mtx/vec/obj alloc + pobj + robj). Everything below 0x801A8428 (jobj/cobj/lobj/dobj/aobj/tobj/fobj/initialize) is **unsplit auto-asm** — recovering it needs a brand-new split unit (harder).
- DTK currently matches **13** functions in the reserved region (the tiny MObj flag/SDA getters, mtx/vec alloc-data getters, mtx_scaled_add, pobj/pobj_empty, 4 robj). Everything else in the reserved region is **UNMATCHED** and sits inside the ahead-of-source skeleton ranges:
  - `hsd_mobj_range_801A8478` (1 fn), `_801A84B4` (1 fn), `_801A84F0` (4 fns), `_801A86B4` (15 fns)
  - `hsd_pobj_range_801AA608` (35 fns), `_801AE008` (4 fns), `_801AEBE4` (11 fns)
  - report.json confirms **matched_functions = 0** for all seven.
- **Strongest evidence**: backup-branch git log carries explicit byte-exact commit messages, notably `27819517 decomp(hsd_mtx): farm 5 HSD matrix fns from Melee -> byte-exact`. Those 5 are the crown jewels (Tier 1).
- The archive `func_tu_map.json` / `data_progress.json` only track *data* matches; no per-`.text` match table exists, so non-commit-cited bodies are graded `near`/`candidate-only`.

## Source files and their real-C yield (junk rejected)

| archive file | role | real-C recovery-zone fns | rejected (stub/asm/.inc) |
|---|---|---|---|
| `hsd_mtx.c` | matrix math 0x801A85F0–0x801AA350 | 7 (5 byte-exact + GetTranslate + fn_801AA350) | fn_801A86B4, fn_801A958C = empty `{}` stubs |
| `hsd_mobj_ext.c` | mtx/vec allocators 0x801A8478–0x801A85A4 | 6 allocators | (HSD_MObjReqAnimByFlags has inline `asm{fmr}` — excluded) |
| `hsd_pobj_disp.c` | pobj lifecycle 0x801AA35C–0x801ADF54 | 24 | ~16 `/* stub - complex asm */` or empty `{}` (fn_801AA8BC, ABB4, AEA8, AB270, AB67C, ABDD4, AC1F8, get_shape_normal_xyz, AC91C, ACDAC, AD044, AD354, AD7CC, ADAAC, ADD48, ADE50, ADF54) |
| `hsd_pobj_ext.c` | pobj render 0x801AE008–0x801B0158 | 0 new (only already-matched robj funcs are real; all render fns empty `{}`) | the four pobj_range_801AE008/_801AEBE4 units have **no** real C |
| `hsd_object.c` | base obj 0x80190E60–0x80191484 (sub-range) | 6 (bbox + pool init) | fn_80190E60, fn_80191118 = `.inc` |
| `hsd_lobj.c`/`hsd_jobj.c`/`hsd_initialize.c` | sub-range | 5 byte-exact-claimed (dual asm+C scratch) | rest `.inc` |

## Recovery zones with no archive C (do not pursue from this archive)
- `hsd_pobj_range_801AE008` and `hsd_pobj_range_801AEBE4` (pobj render/TEV dispatch): every function is an empty `{}` placeholder in `hsd_pobj_ext.c`. Not recoverable here.

---

## Candidates (49)

Confidence legend: **byte-exact-claimed** = a backup commit message states 100%/byte-exact for that exact address; **near** = trivial/simple real C, very likely exact; **candidate-only** = real matching-quality C, unverified (no build run). All `conflictsWithDtk = false` (DTK symbol names are preserved; the nice names like HSD_MtxSRT are optional renames). Every target verified UNMATCHED in report.json.

### Tier 1 — byte-exact-claimed, reserved range `hsd_mobj_range_801A86B4` (TOP PRIORITY)
| DTK fn | addr | size | src | evidence |
|---|---|---|---|---|
| fn_801A8884 (HSD_MtxSRT) | 0x801A8884 | 0x310 | hsd_mtx.c | commit 27819517 byte-exact |
| fn_801A8B94 (HSD_MkRotationMtx) | 0x801A8B94 | 0x188 | hsd_mtx.c | commit 27819517 byte-exact |
| fn_801A8D1C (HSD_MtxGetScale) | 0x801A8D1C | 0x854 | hsd_mtx.c | commit 27819517 byte-exact (largest) |
| fn_801A98CC (HSD_MtxGetRotation) | 0x801A98CC | 0x524 | hsd_mtx.c | commit 27819517 byte-exact |
| fn_801A9DF0 (HSD_MtxInverseConcat) | 0x801A9DF0 | 0x560 | hsd_mtx.c | commit 27819517 byte-exact |

### Tier 2 — exact-range-fill allocators + trivial real C (near; easiest banks)
| DTK fn | addr | size | src | reserved range / note |
|---|---|---|---|---|
| HSD_MtxInitAllocData | 0x801A8478 | 0x30 | hsd_mobj_ext.c | fills `hsd_mobj_range_801A8478` exactly (DTK-named) |
| HSD_VecInitAllocData | 0x801A84B4 | 0x30 | hsd_mobj_ext.c | fills `hsd_mobj_range_801A84B4` exactly (DTK-named) |
| HSD_MtxFree | 0x801A84F0 | 0x34 | hsd_mobj_ext.c | `hsd_mobj_range_801A84F0` (4-fn fill) |
| HSD_MtxAlloc | 0x801A8524 | 0x4C | hsd_mobj_ext.c | `hsd_mobj_range_801A84F0` (4-fn fill) |
| HSD_VecFree | 0x801A8570 | 0x34 | hsd_mobj_ext.c | `hsd_mobj_range_801A84F0` (4-fn fill) |
| HSD_VecAlloc | 0x801A85A4 | 0x4C | hsd_mobj_ext.c | `hsd_mobj_range_801A84F0` (4-fn fill) |
| HSD_MtxGetTranslate | 0x801A9570 | 0x1C | hsd_mtx.c | 3-line, DTK-named |
| fn_801AA350 | 0x801AA350 | 0xC | hsd_mtx.c | 1-line (lbl_8047B2E0=0) |
| HSD_ObjFree | 0x801AA498 | 0x34 | hsd_pobj_disp.c | opt_level 1; DTK-named |
| HSD_ObjAlloc | 0x801AA4CC | 0x6C | hsd_pobj_disp.c | opt_level 1; DTK-named |

(The four `hsd_mobj_range_801A84F0` functions are the cleanest single win — together they fill the whole 0x100-byte 4-function range and are already DTK-named.)

### Tier 2b — small/simple, candidate-only, easy
HSD_ObjSetHeap (0x801AA538/0x30), ObjInfoInit_802596A4 (0x801AA568/0x44), fn_801AA5AC (0x801AA5AC/0x5C), fn_801ACD7C (0x801ACD7C/0x30), _HSD_RandForgetMemory (0x801ADC08/0x34), fn_801ADC3C (0x801ADC3C/0x40, LCG), fn_801ADC7C (0x801ADC7C/0x5C, LCG f32), fn_801ADCD8 (0x801ADCD8/0x34, LCG u16), fn_801ADD0C (0x801ADD0C/0x3C), fn_801AB5F8 (0x801AB5F8/0x44), fn_801AB63C (0x801AB63C/0x40) — all `hsd_pobj_disp.c` (and the obj allocators in `hsd_mobj_range_801A86B4`).

### Tier 3 — moderate, candidate-only (pobj_range_801AA608)
fn_801AA35C (0x13C, pool init — heavily referenced), HSD_PObjInit (0xC8, vtable installs), fn_801AA6D0 (0xB8), fn_801AA788 (0x134, goto-heavy — match risk → `hard`), fn_801AB538 (0xC0), HSD_PObjRemoveAll (0x74), fn_801AD288 (0xCC), HSD_PObjAnimAll (0x5C), PObjUpdateFunc (0x4C), HSD_PObjReqAnimAllByFlags (0x74), fn_801AD738 (0x94). All `hsd_pobj_disp.c`, all DTK-named where shown.

### Tier 4 — sub-0x801A8428 (NO reserved split; need a NEW split unit) — harder
- byte-exact-claimed: fn_801A4098 + fn_801A6990 (`hsd_lobj.c`, commit d6ae55de), fn_801A015C + fn_801A0FBC (`hsd_jobj.c`, commit c9fd26e1), fn_8019C6FC (`hsd_initialize.c`, commit b19dceaf). Note: these live in dual `asm{#include .inc}` + `void fn(){real C}` scratch form — extract the C body.
- candidate-only real C in `hsd_object.c`: fn_80191358 (0x108), fn_80191460/6C/74/7C (bbox setters), fn_80191484 (0x70). Plus `hsd_mobj_ext.c` fn_801A83BC (HSD_MObjAddAnim, 0x6C).
- Also available but not enumerated address-by-address here: `hsd_tobj_ext.c` (commit 8cd147ce: 3 byte-exact among ~30 real-C TObj fns at 0x801BBxxx) and `hsd_cobj.c` (commits a2593b80/5e6238af/d8983bb1/4ecaba0f: byte-exact at 0x80193D30, 0x80195A6C + more, "45 matched"). High value but all require new splits in the 0x8019xxxx auto-asm block.

---

## Exact DTK pipeline to reintroduce (per function)

Using the four-function `hsd_mobj_range_801A84F0` fill as the worked example (cleanest):

1. **splits.txt** — replace the skeleton range line
   ```
   hsd/hsd_mobj_range_801A84F0.c:
       .text       start:0x801A84F0 end:0x801A85F0
   ```
   with four single-function units (or one multi-fn TU if the source order matches link order), e.g.
   ```
   hsd/hsd_mtx_free.c:
       .text       start:0x801A84F0 end:0x801A8524
   hsd/hsd_mtx_alloc.c:
       .text       start:0x801A8524 end:0x801A8570
   hsd/hsd_vec_free.c:
       .text       start:0x801A8570 end:0x801A85A4
   hsd/hsd_vec_alloc.c:
       .text       start:0x801A85A4 end:0x801A85F0
   ```
   For functions inside the big `_801A86B4`/`_801AA608` ranges, carve the target out and leave shrunken skeleton range stubs on either side (same pattern the existing `hsd_mtx_scaled_add.c` carve uses).
2. **configure.py** — add the new unit(s) to the `Object(Matching, ...)` list so dtk builds them as matching objects (mirror the existing hsd matched units).
3. **symbols.txt** — NO change needed: every Tier-2/2b/3 target already carries its canonical DTK name (or fn_*). For Tier-1 you keep the DTK name `fn_801A8884` etc. in the C (rename to HSD_MtxSRT only if you also choose to edit symbols.txt — optional, would be the only `conflictsWithDtk` case).
4. **src/hsd/<unit>.c** — drop in the archive body (strip the leading `/* Address ... */` comment; for Tier-4 lobj/jobj remove the `asm{#include .inc}` twin and keep the C). Provide externs for the helper symbols it references (fn_801AA35C, fn_801A6960/6928, __assert, lbl_80465620/8046564C, sdata2 string lbls — all already present in the DOL/symbols).
5. Rebuild via the normal dtk path (configure.py → ninja); confirm the unit reports matched_functions == total_functions in report.json. Bank on green.

## Recommended first batch
1. **`hsd_mobj_range_801A84F0` fill** — HSD_MtxFree / HSD_MtxAlloc / HSD_VecFree / HSD_VecAlloc (hsd_mobj_ext.c): exactly fills a 4-function reserved range, all DTK-named, trivial alloc/free bodies. Lowest-risk first green.
2. **HSD_MtxInitAllocData + HSD_VecInitAllocData** (hsd_mobj_ext.c): each fills its own 1-function reserved range exactly.
3. **The 5 byte-exact-claimed hsd_mtx.c functions** (HSD_MtxSRT, HSD_MkRotationMtx, HSD_MtxGetScale, HSD_MtxGetRotation, HSD_MtxInverseConcat) carved from `hsd_mobj_range_801A86B4`: highest value (0x310–0x854 each) with the strongest evidence (commit 27819517).
