# Recovery Inventory — Game Core (battle / fsys / data)

Subsystem: game-specific battle/fsys/data. Scope: `archive/previous_campaign/src/game/{battle,fsys,data}` (+ backup branch `backup/local-master-pre-sync-20260630`, identical tree for these files).

## Executive summary

- 11 archive C files reviewed in scope (battle x5, fsys x3, data x3).
- **CRITICAL HONESTY NOTE:** the archive campaign's own `tools/decomp_work/progress.json` records only **9 build-verified byte-exact functions in the ENTIRE campaign (fuzzy>=99.995), NONE in battle/fsys/data**. Therefore the ~793 real-C function bodies in these files are overwhelmingly *unverified* decompilation attempts, NOT confirmed byte matches. No candidate here is build-verified; I cannot rebuild (read-only). Confidence below is my static assessment of how forced the codegen is.
- Junk rejected: **194** `#include "...fn_XXXX.inc"` asm-fallback bodies (battle_logic 129, battle_scene 21, fsys_file 31, fsys_load 13) + 1 inline-`asm{}` function in battle_grid (line 564). These are asm, not recoverable C.
- All candidate addresses are currently **UNMATCHED**: they live in the giant write-asm auto units `main/auto_01_801653CC_text` (fsys, 0x8017xxxx) and `main/auto_01_801B0158_text` (battle, 0x801Bxxxx-0x801Exxxx); report.json shows 0% matched for these. No active src/ file sources any battle/fsys function. Not covered by the 12 reclaim commits nor the 39 ahead-of-source skeletons (those are OS/DVD/DB/crt/hsd/trk only).
- Symbol names already equal `fn_XXXXXXXX` and match config/GC6E01/symbols.txt addresses+sizes exactly -> **conflictsWithDtk = false** for every candidate (no symbols.txt rename; object_map.freeze.json is a frozen progress denominator and is not edited when sourcing).

## Tier 1 — high-confidence "near" recoverable (31 pattern-classified tiny deterministic fns)

These carry explicit campaign annotations `/* Address: 0xADDR | Size: 0xNN | Pattern: ... */`, all map 1:1 to symbols.txt with exact size, and compile to forced PPC codegen.

| fn / addr | size | pattern | archive file:line | body | conf | ease |
|---|---|---|---|---|---|---|
| fn_801E11CC `0x801E11CC` | 0x8 | sda_getter | battle/battle_logic.c:1138 | `u8 fn_801E11CC(void) { return lbl_8047B434; }` | near | trivial |
| fn_801E11E0 `0x801E11E0` | 0x8 | sda_getter | battle/battle_logic.c:1143 | `u32 fn_801E11E0(void) { return lbl_8047B424; }` | near | trivial |
| fn_801E11E8 `0x801E11E8` | 0x8 | sda_getter | battle/battle_logic.c:1148 | `u8 fn_801E11E8(void) { return lbl_8047B420; }` | near | trivial |
| fn_801ED640 `0x801ED640` | 0x8 | sda_setter | battle/battle_logic.c:1153 | `void fn_801ED640(u8 val) { lbl_8047B5C1 = val; }` | near | trivial |
| fn_801EE034 `0x801EE034` | 0x18 | nullcheck_getter | battle/battle_logic.c:1158 | `u32 fn_801EE034(u8* ptr) { if (ptr == NULL) { return 0; } return *(u32*)(&ptr[0x` | candidate-only | easy |
| fn_801EE04C `0x801EE04C` | 0x18 | nullcheck_getter | battle/battle_logic.c:1164 | `u8 fn_801EE04C(u8* ptr) { if (ptr == NULL) { return 0; } return *(u8*)(&ptr[0x1]` | candidate-only | easy |
| fn_801EE064 `0x801EE064` | 0x18 | nullcheck_getter | battle/battle_logic.c:1170 | `u8 fn_801EE064(u8* ptr) { if (ptr == NULL) { return 0; } return *(u8*)(&ptr[0x0]` | candidate-only | easy |
| fn_801EE468 `0x801EE468` | 0x8 | return_constant | battle/battle_logic.c:1176 | `u32 fn_801EE468(void) { return 48; }` | near | trivial |
| fn_801EF61C `0x801EF61C` | 0x8 | sda_setter | battle/battle_main.c:415 | `void fn_801EF61C(u16 val) { lbl_8047B5D6 = val; }` | near | trivial |
| fn_801EF624 `0x801EF624` | 0x8 | sda_getter | battle/battle_main.c:420 | `u16 fn_801EF624(void) { return lbl_8047B5D6; }` | near | trivial |
| fn_801EF62C `0x801EF62C` | 0x8 | sda_setter | battle/battle_main.c:425 | `void fn_801EF62C(u16 val) { lbl_8047B5D8 = val; }` | near | trivial |
| fn_801EF634 `0x801EF634` | 0x8 | sda_getter | battle/battle_main.c:430 | `u16 fn_801EF634(void) { return lbl_8047B5D8; }` | near | trivial |
| fn_801EF63C `0x801EF63C` | 0x8 | sda_getter | battle/battle_main.c:435 | `u8 fn_801EF63C(void) { return lbl_8047B5DA; }` | near | trivial |
| fn_8017BFE8 `0x8017BFE8` | 0x8 | return_constant | fsys/fsys_file.c:657 | `u32 fn_8017BFE8(void) { return 0; }` | near | trivial |
| fn_8017BFF0 `0x8017BFF0` | 0x8 | return_constant | fsys/fsys_file.c:660 | `u32 fn_8017BFF0(void) { return 0; }` | near | trivial |
| fn_8017BFF8 `0x8017BFF8` | 0x8 | return_constant | fsys/fsys_file.c:663 | `u32 fn_8017BFF8(void) { return 0; }` | near | trivial |
| fn_8017C000 `0x8017C000` | 0x8 | return_constant | fsys/fsys_file.c:666 | `u32 fn_8017C000(void) { return 1; }` | near | trivial |
| fn_8017C394 `0x8017C394` | 0x8 | return_constant | fsys/fsys_file.c:669 | `u32 fn_8017C394(void) { return 1; }` | near | trivial |
| fn_8017C568 `0x8017C568` | 0x8 | return_constant | fsys/fsys_file.c:672 | `u32 fn_8017C568(void) { return 1; }` | near | trivial |
| fn_8017C570 `0x8017C570` | 0x8 | return_constant | fsys/fsys_file.c:675 | `u32 fn_8017C570(void) { return 1; }` | near | trivial |
| fn_8017C578 `0x8017C578` | 0x8 | return_constant | fsys/fsys_file.c:678 | `u32 fn_8017C578(void) { return 0; }` | near | trivial |
| fn_8017C590 `0x8017C590` | 0x8 | return_constant | fsys/fsys_file.c:681 | `u32 fn_8017C590(void) { return 1; }` | near | trivial |
| fn_8017C598 `0x8017C598` | 0x8 | return_constant | fsys/fsys_file.c:684 | `u32 fn_8017C598(void) { return 1; }` | near | trivial |
| fn_8017C5B0 `0x8017C5B0` | 0x8 | return_constant | fsys/fsys_file.c:687 | `u32 fn_8017C5B0(void) { return 1; }` | near | trivial |
| fn_8017C88C `0x8017C88C` | 0x8 | return_constant | fsys/fsys_file.c:690 | `u32 fn_8017C88C(void) { return 1; }` | near | trivial |
| fn_8017C8C0 `0x8017C8C0` | 0x8 | return_constant | fsys/fsys_file.c:693 | `u32 fn_8017C8C0(void) { return 1; }` | near | trivial |
| fn_8017C8F4 `0x8017C8F4` | 0x8 | return_constant | fsys/fsys_file.c:696 | `u32 fn_8017C8F4(void) { return 1; }` | near | trivial |
| fn_8017CEC8 `0x8017CEC8` | 0x8 | return_constant | fsys/fsys_file.c:699 | `u32 fn_8017CEC8(void) { return 1; }` | near | trivial |
| fn_8017CED0 `0x8017CED0` | 0x8 | return_constant | fsys/fsys_file.c:702 | `u32 fn_8017CED0(void) { return 1; }` | near | trivial |
| fn_8017D400 `0x8017D400` | 0x8 | return_constant | fsys/fsys_file.c:705 | `u32 fn_8017D400(void) { return 1; }` | near | trivial |
| fn_8017D408 `0x8017D408` | 0x8 | return_constant | fsys/fsys_file.c:708 | `u32 fn_8017D408(void) { return 1; }` | near | trivial |

### Contiguous clusters (ideal single-TU split units)
- **fsys_file return-constant cluster** 0x8017BFE8-0x8017C008 = 4 contiguous 8B fns (fn_8017BFE8/BFF0/BFF8 return 0; fn_8017C000 return 1). Zero external deps. EASIEST possible unit.
- **battle_main SDA cluster** 0x801EF61C-0x801EF644 = 5 contiguous 8B SDA getters/setters on lbl_8047B5D6/D8/DA. Clean second unit.
- Remaining fsys_file return-constants (0x8017C394,C568,C570,C578,C590,C598,C5B0,C88C,C8C0,C8F4,CEC8,CED0,D400,D408) are scattered; each needs its own tiny split or pairing with neighbours.

## Tier 2 — candidate-only (real C, unverified)
- `fn_8017F2C4` FSYSDecompressLZSS (0x134, fsys/fsys_decomp.c): complete, well-documented LZSS-10 decompressor with full register map. Self-contained (only touches gLZSSWindow/gLZSSContext bss). Highest *code-volume* single win in scope, but loop/branch scheduling unverified -> moderate.
- ~217 additional small real-C bodies (size 0x15-0x40, no pattern annotation) across battle_grid/scene/waza/logic/fsys_load. Real decompiled C mapping to unmatched fn_XXXX symbols, but unverified near-misses. Listed in game-core.json scope counts; individually low ease (need objdiff verification each).
- data/{common_rel,move_data,pokemon_data}.c and the descriptive-named accessors: REAL C but use descriptive names with NO per-function address annotation (only a region range in header prose). Cannot be reliably pinned to a DTK address from the archive alone -> deferred, would need manual address attribution before sourcing.

## Reintroduction pipeline (per cluster)
1. Create `src/game/fsys/fsys_returns_8017BFE8.c` containing the 4 functions (real C bodies already in archive fsys/fsys_file.c lines 658-668).
2. configure.py: register the object as `Object(Matching, "game/fsys/fsys_returns_8017BFE8.c", ...)`.
3. splits.txt: add unit `game/fsys/fsys_returns_8017BFE8.c:` with `.text start:0x8017BFE8 end:0x8017C008` (carves from auto_01_801653CC_text).
4. symbols.txt: NO change (fn_8017BFE8.. already present with correct addr/size).
5. ninja -> report.json: confirm the 4 fns flip to matched (expect 100% on an li/blr + li/blr unit).
6. Repeat for battle_main cluster: split `.text start:0x801EF61C end:0x801EF644`, source the 5 SDA accessors (archive battle/battle_main.c lines 416-438); lbl_8047B5D6/D8/DA already in symbols.txt.

## Rejected (non-recoverable) inventory
- 194 `#include fn_*.inc` asm bodies: battle_logic.c (129), fsys_file.c (31), battle_scene.c (21), fsys_load.c (13).
- battle_grid.c fn at line ~564 contains inline `asm { lbz r3, lbl_8047B399(r13) }` -> reject that function.
- All data/*.c pure-data and descriptive accessors without address pinning (deferred, not rejected, but not bankable as-is).