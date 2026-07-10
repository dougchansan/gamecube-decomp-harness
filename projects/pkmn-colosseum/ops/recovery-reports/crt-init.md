# Recovery Inventory — subsystem: crt + init

Scope: `archive/previous_campaign/src/{crt,init}` + backup branch `backup/local-master-pre-sync-20260630`.
DTK source of truth: `config/GC6E01/{symbols.txt,splits.txt}`, `build/GC6E01/report.json` (parsed, not rebuilt).
Read-only. No git/config mutated.

## Headline

- **12 real-C recovery candidates** found that map to currently-UNMATCHED DTK functions and are NOT junk / NOT already reclaimed / NOT in active `src/`.
- **0 verified byte-exact.** The archive campaign recorded NONE of these as matched (its `tools/decomp_work/progress.json` has zero hits for printf/stdio/vprintf/__FileWrite/fwrite/memchr/strchr/__start/__init_data). All candidates are decompilation-quality C that must be re-validated by a DTK build. 5 are "clearly near" quality, 7 are "candidate-only".
- The cleanest wins are the **6 functions that sit inside already-reserved crt skeleton splits** (`crt/printf.c`, `crt/stdio_range_800C7558.c`) — no symbols.txt rename, no object_map edit, `conflictsWithDtk=false`.
- The single highest-value function is **__va_arg** (genuine MSL decomp, global, exact 0xC8) but it lives in an auto-unit and needs a NEW split unit.

## Method / what was rejected

Archive crt/init files reviewed (12): `crt/{__init_cpp_exceptions,__va_arg,exit,extras,global_destructor_chain,math_longlong,mwtrace,printf,runtime,stdio,strtoul}.c`, `init/__start.c`. Backup branch `src/crt/printf.c`, `src/crt/stdio.c`, `src/init/__start.c` were diffed against the archive and are equivalent (both stub-heavy; `__start.c` byte-identical), so the backup adds nothing here.

REJECTED as non-recoverable (per rules):
- **Inline PPC asm / nofralloc**: `init/__start.c` → `__start`, `__init_registers`, `__init_hardware`, `__flush_cache` (all `asm {... nofralloc ...}`). `crt/runtime.c` → `__save_fpr/__restore_fpr/__save_gpr/__restore_gpr` (8 asm). `crt/__init_cpp_exceptions.c` (2 asm + 2 `.inc`).
- **Register-machine pseudo-asm transliterations** (will never compile-to-match): `crt/printf.c` → `fn_800C8520`, `fn_800C8710`, `fn_800C974C`, `fn_800CA620`. `crt/stdio.c` → `fn_800C5500`, `fn_800C56A4`, `fn_800C5A58`, `fn_800C71DC`. `crt/strtoul.c` → ALL of it: `fn_800C7904`(fflush), `fn_800C7A3C`(fclose), `fn_800C7C64`(_fseek), `fn_800C7ED4`(ftell) are `u32 r3=0; /* mr. r31,r3 */;` machines. `crt/math_longlong.c`, `crt/exit.c` (mixed pseudo-asm + stubs).
- **Explicit stubs** (empty bodies / `return 0`): `crt/printf.c` → `__pformatter`, `parse_format`, `long2str`, `longlong2str`, `float2str`, `double2hex`. `crt/stdio.c` → `__flush_buffer`, `__prep_buffer`, `__fwrite`, `fseek`.
- **Documented Equivalent-only (NOT byte-exact)**: `crt/global_destructor_chain.c` → `fn_800C46B0` (0x800C46B0). The campaign's own comment states the target is hand-written PPC (`fcmpu`+`bge/blt`, no `cror`) and "the exact target bytes are not C-reachable from any available CW version ... real C left active (Equivalent), not byte-exact." Honest reject.

## DTK match landscape (report.json) for the relevant crt units

| unit | matched/total | note |
|---|---|---|
| main/crt/printf | 0/14 | reserved skeleton, all NA (no source) |
| main/crt/stdio_range_800C7558 | 0/8 | reserved skeleton, all NA |
| main/crt/wchar_range_800C7FB8 | 0/1 | wcstombs NA (active wchar.c already implements wcstombs but is mapped to the wrong split — config fix, not archive recovery; conflictsWithDtk) |
| main/crt/mem_range_800C811C | 0/2 | __memrchr, memchr NA — no real C in archive (extras.c has none) |
| main/crt/mem | 0/5 | active source already present (fuzzy 66–95%); archive worse — skip |
| main/crt/string | 2/5 | active source already present; archive worse — skip |
| main/crt/string_range_800CA78C | 0/2 | strchr, fn_800CA7BC NA — no real archive C found |
| main/auto_01_800C45A0_text | __va_arg NA | not in splits |
| main/auto_01_800CAA58_text | fwide NA | not in splits |
| main/auto_00_80003100_init | __init_data/fn_80003458/fn_80003488/fn_800053E0 NA | not in splits |

Note: mem.c (0/5, up to 94.88%) and string.c (strcpy 92.61%, fn_800CA7FC 97.30%) already have BETTER active source than the archive offers — not archive-recovery candidates, just normal matching work.

## Candidates (ranked by value × ease)

### Group A — inside already-reserved skeleton splits (conflictsWithDtk = FALSE) — DO FIRST

| # | fn | addr | size | scope | unit | conf | ease | value | evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | fn_800C7558 | 0x800C7558 | 0x24 | local | stdio_range_800C7558 | near | trivial | med | `if(ch==-1)return -1; return lbl_80313C18[(u8)ch];` clean range start |
| 2 | __FileWrite | 0x800C8864 | 0x58 | global | printf | near | easy | med | `w=(s32)fwrite(data,1,count,file); return w==count?count:0;` |
| 3 | vprintf | 0x800C8678 | 0x98 | global | printf | candidate | easy | high | stdout=__files+0x50; fwide guard; crit-region(2) around __pformatter(__FileWrite,...) |
| 4 | fwrite | 0x800C7888 | 0x7C | global | stdio_range_800C7558 | candidate | easy | high | size/count guard; total=size*count; __fwrite; written/size |
| 5 | fn_800C8600 | 0x800C8600 | 0x78 | local | printf | candidate | easy | med | vsprintf: {buf,-1,0} ctx, __pformatter(fn_800C87F8,&sf,...), buf[n]=0 |
| 6 | fn_800C87F8 | 0x800C87F8 | 0x6C | local | printf | candidate | easy | med | sprintf write-callback: clamp len, memcpy(*ctx+pos,src,len), ctx[8]+=len |

Why clean: the split RANGE already exists; you sub-divide it. Function names already match symbols.txt — no rename. No object_map edit.

### Group B — target in an auto-unit, needs a NEW split unit (conflictsWithDtk = TRUE)

| # | fn | addr | size | scope | unit | conf | ease | value | evidence |
|---|---|---|---|---|---|---|---|---|---|
| 7 | __va_arg | 0x800C45A0 | 0xC8 | global | auto_01_800C45A0_text | near | moderate | high | genuine MSL PPC __va_arg(ap,type): GPR/FPR counter dispatch, regs 0x00 GPR3-10 / 0x20 FPR1-8, dword even-align; no stub deps; exact size |
| 8 | fwide | 0x800CAA58 | 0x88 | global | auto_01_800CAA58_text | candidate | moderate | med | orient=file->wideOrient; if 0 set from sign(mode); return orient |
| 9 | __init_data | 0x80003340 | 0xC0 | local | auto_00_80003100_init | near | moderate | med | textbook: walk _rom_copy_info(memcpy+__flush_cache), walk _bss_init_info(memset) |
| 10 | fn_80003488 | 0x80003488 | 0x24 | local | auto_00_80003100_init | near | moderate | low | `while(len-->0)*dst++=*src++;` trivial byte copy |
| 11 | fn_80003458 | 0x80003458 | 0x30 | local | auto_00_80003100_init | candidate | moderate | low | `fn_800C0DA8(); return arg;` (#if 0 .inc branch disabled, real-C #else active) |
| 12 | fn_800053E0 | 0x800053E0 | 0x2C | local | auto_00_80003100_init | candidate | moderate | low | OSResetSystem(0,0,0) wrapper; borderline but trivial |

## Reintroduce pipeline (per candidate)

Group A (e.g. fn_800C7558):
1. `config/GC6E01/splits.txt`: carve a sub-range out of the reserved skeleton, e.g.
   `crt/fn_800C7558.c:` → `.text start:0x800C7558 end:0x800C757C`, leaving the remaining stdio_range as asm.
2. Create `src/crt/fn_800C7558.c` with the real C (from `archive/.../crt/stdio.c:2283`).
3. `configure.py`: register the unit as `Object(Matching, "crt/fn_800C7558.c")`.
4. Re-run configure.py + ninja (campaign's job, not this audit), parse `report.json`: confirm the function flips to matched / fuzzy 100.

Group B adds, before step 2: remove the function's address window from the auto-unit coverage in `config/GC6E01/object_map.freeze.json` and add a brand-new split unit (init/ has no unit today). → `conflictsWithDtk=true`. For init, only the 4 listed functions are recoverable; `__start/__init_registers/__init_hardware/__flush_cache` stay asm.

## Recommended first batch

Carve the 6 Group-A functions out of the existing reserved skeletons — zero DTK-config conflict, no symbol rename:
- from `crt/stdio_range_800C7558.c`: **fn_800C7558** (lead — trivial 0x24 lookup, clean range start) + **fwrite**.
- from `crt/printf.c`: **__FileWrite** (lead — 0x58 fwrite wrapper) + **fn_800C87F8** + **fn_800C8600** + **vprintf**.
Lead with fn_800C7558 and __FileWrite to validate the carve-and-match flow on tiny self-contained functions, then bank the globals vprintf + fwrite. Defer __va_arg (highest value but needs a new split unit + object_map edit) to batch 2, alongside __init_data.
