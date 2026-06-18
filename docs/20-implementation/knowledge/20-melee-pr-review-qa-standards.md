---
covers: Melee decomp code-quality standards, QA lint coverage, retired rules, and repair examples
concepts: [past-prs, review-standards, decomp-quality, matching-standards, qa-checklist]
code-ref: knowledge/sources/injectable/decomp_standards/data/standards.jsonl, tools/source_editing/review_lint/api/_qa_rules.py
---

# Melee Code Quality Standards

Use these standards for agent-authored Melee C and for QA review of PR-bound
candidate files. They define source-quality rules: how code should be written,
which source shapes should be repaired, and which recurring failures are caught
deterministically.

These standards are not PR shape policy. PR split size, PR body format, and
manual verification ledgers belong to workflow/runbook surfaces. Build,
objdiff/checkdiff, regression, and QA artifacts remain runner-owned evidence.

## Coverage Tiers

| Tier | Meaning | Examples |
| --- | --- | --- |
| Deterministic error | Added diff shape is mechanically rejected or maintainer-rejected. | `new_data_anchor`, `self_tu_extern`, `packed_string_blob`, `copied_jobj_inline`, `unrolled_assert`, `register_keyword`, `inline_asm`, `m2c_field_use`, `define_alias`. |
| Deterministic warning | Added diff shape is suspicious but context can justify it. | `extern_literal_anchor` for floats, `function_extern_visibility`, `novel_pragma`, `type_erasing_cast`, typed `spNN` locals. |
| Pre-ship review | Judgment needs local source analogs, type context, or objdiff reasoning. | likely loops, one-off helpers, authored-source style, broad local lifetime churn, semantic naming. |
| Pipeline-owned verification | Runner/build evidence proves whether retained source matches. | `ninja`, objdiff/checkdiff, regression-check, worker validation artifacts. |

Every `review_lint` finding carries a `standard_id`. Repair and pre-ship review
should use that id plus `rule_id` to retrieve examples and repair hints.

## Retired Or Merged Standards

| Standard | Disposition | Replacement |
| --- | --- | --- |
| `global_standard:verification-and-regression-ledger` | Workflow-only; not a worker-facing code standard. | Runner validation and workflow docs own build, objdiff, checkdiff, regression, and QA artifacts. |
| `global_standard:text-before-data-matching` | Merged; not a standalone worker standard. | Code-quality data/literal issues live under literals, data, and externs. Broad text-vs-data prioritization is workflow context. |
| `global_standard:data-sections-and-tu-splits` | Merged. | Split and section ownership guidance lives under literals, data, and externs. |

## 1. Authored Source Shape

Standards:

- `global_standard:infer-authored-source-style`
- `global_standard:natural-loops`
- `global_standard:canonical-control-flow-and-macros`

Agents should reconstruct likely original authored C, not generated C that only
moves a score. Use matched siblings, nearby files, headers, macros, naming
habits, and local control-flow idioms as evidence.

Score is telemetry, not a source-quality override. In review cleanup and QA
repair, removing generated or tactic-shaped code is correct even when fuzzy
score drops or an exact match is lost; the score impact should be reported and
the clean source kept as carry-forward evidence.

Deterministic coverage:

- `m2c_goto_label`: added `goto block_NN` or `block_NN:` residue is an error;
  other new gotos are warnings.
- `m2c_residue_names`: added `temp_rNN`, `var_rNN`, and `phi_fNN` names are
  errors; typed `spNN` locals are warnings.
- `define_alias`: local `_ABS`, `_MIN`, `_MAX`, and `_CLAMP` clones are
  warnings.

Do:

- Try natural `for`, `while`, or `do while` forms when repeated source differs
  only by index, pointer, counter, or stride.
- Try structured `switch`, ordinary branches, ternaries, and canonical
  expression macros before preserving generated residue.
- Record negative evidence if a cleaner authored form was tested and failed.

Do not:

- Leave repeated generated-looking blocks only because they currently match.
- Preserve generated gotos, copied branch ladders, or local macro clones before
  checking ordinary source forms.
- Let decompiler output or data-section parity outrank matched local source.
- Keep generated or tactic-shaped source solely to avoid a fuzzy score drop.

Example:

```c
/* Bad: repeated generated blocks remain expanded. */
slot[0] = base[0].x4;
slot[1] = base[1].x4;
slot[2] = base[2].x4;

/* Better: test the likely authored loop form. */
for (i = 0; i < 3; i++) {
    slot[i] = base[i].x4;
}
```

## 2. Typed Access And Pointer Math

Standard:

- `global_standard:typed-fields-over-pointer-math`

Agents should describe memory through the most precise local type available:
real fields, correct union arms, accessors, or temporary internal structs before
raw pointer arithmetic.

Deterministic coverage:

- `stage_ground_var_owner`: stage TUs borrowing another stage family's
  `GroundVars` arm are errors.
- `m2c_field_use`: new `M2C_FIELD(...)` uses are errors.
- `type_erasing_cast`: new `(void*)`, `(u8*)`, or `(char*)` casts are warnings.
- `pointer_offset_arithmetic`: new raw byte-pointer offset access is a warning.

Do:

- Replace raw offsets with fields, the correct union arm, a helper, or a
  temporary typed struct when the type is known.
- Add or extend the owning stage/fighter/item union arm instead of borrowing an
  unrelated layout.
- Keep raw byte math only as a documented bridge while the real type is still
  unknown.

Do not:

- Keep `((u8*) obj) + offset` when a type can express the access.
- Borrow `gv.arwing` or another unrelated union arm because offsets line up.
- Treat `M2C_FIELD` as finished source style.

Example:

```c
/* Bad: raw offset into a known object. */
value = *(s32*) ((u8*) state + 0x14 + pnum * 0x24);

/* Better: field and array access on the recovered type. */
value = state->players[pnum].x14;
```

## 3. Asserts, Reports, And Header Inlines

Standards:

- `global_standard:header-inlines`
- `global_standard:assert-report-macros`

Agents should map expanded assert/report code back to project macros, header
inlines, and existing helper boundaries when local evidence identifies the
source operation.

Deterministic coverage:

- `unrolled_assert`: open-coded `__assert` or `__assert_msg` in normal source is
  an error.
- `fake_assert_macro`: local assert/report macro clones are errors.
- `assert_idiom_downgrade`: replacing `HSD_ASSERT*` with raw assert/report code
  is an error.
- `copied_jobj_inline`: pasted `jobj.h` inline helper bodies in source TUs are
  errors.

Do:

- Use `HSD_ASSERT`, `HSD_ASSERTMSG`, or `HSD_ASSERTREPORT` when they represent
  the source.
- Preserve real `OSReport` or `OSPanic` side effects.
- Use `jobj.h` file/line evidence to find the owning `HSD_JObj*` helper.
- Use `GET_JOBJ` only when local evidence supports that access shape.
- Restore a shared local inline/helper when sibling bodies show duplicated
  expanded logic and objdiff supports the helper boundary.

Do not:

- Keep `__assert("jobj.h", line, ...)` when a header inline is identifiable.
- Paste `jobj.h` inline helper bodies into stage, item, or fighter TUs.
- Invent fake assert strings, report globals, or dummy storage to force a match.
- Duplicate local helper bodies across wrappers when a shared inline/helper is
  the evidenced authored shape.

Example:

```c
/* Bad: raw assert expansion. */
__assert("jobj.h", 0x257, "jobj");

/* Better: project macro when this is a plain assertion. */
HSD_ASSERT(0x257, jobj);
```

## 4. Literals, Data, And Externs

Standards:

- `global_standard:literals-and-data-ownership`
- `global_standard:no-string-literal-symbol-regression`
- merged: `global_standard:text-before-data-matching`
- merged: `global_standard:data-sections-and-tu-splits`

Agents should not introduce external variables, static literals, address-named
symbols, or packed string blobs solely to force data ordering. Ordinary strings,
floats, constants, assert text, asset names, and report text should stay inline
unless real ownership evidence says otherwise.

Deterministic coverage:

- `extern_literal_anchor`: address-style externs for string types are errors;
  float types are warnings before ownership analysis.
- `new_data_anchor`: extern, use, and definition all introduced together are an
  error.
- `self_tu_extern`: externing data owned by the current TU is an error.
- `string_literal_to_symbol`: replacing a string literal with a data symbol or
  offset expression is an error.
- `numeric_literal_to_symbol`: replacing numeric literals with address-style
  data symbols is an error.
- `packed_string_blob`: hand-packed string blobs and pointer-offset macros over
  address-style symbols are errors.
- `banned_pattern:*` and `resubmission_tombstone`: curated maintainer
  rejections and fuzzy resubmissions are errors.
- `address_named_static_data`: newly invented address-style static or global
  data definitions are errors; exact moved pre-existing lines are downgraded to
  warnings.

Do:

- Keep constants, strings, and float literals inline when no data ownership
  evidence exists.
- Fix symbol size, type, scope, local labels, or splits when metadata is wrong.
- Use named data only when section placement, symbol metadata, or surrounding
  source supports ownership.

Do not:

- Create static literals, externs, globals, fake anchors, or dummy storage
  solely to force data order.
- Replace asset/report/assert strings with symbols or offsets into packed
  blobs.
- Move data across translation units without split evidence.

Example:

```c
/* Bad: external variable introduced to force a float load. */
extern const f32 lbl_804DA60C;
speed = lbl_804DA60C;

/* Better: keep the ordinary literal inline. */
speed = 1.0F;
```

```c
/* Bad: string data accessed through a packed blob or offset. */
static char lbl_803EFB60[0xA8] = "Can't get user_data.\n\0\0\0";
OSReport(lbl_803EFB60 + 0x28);

/* Better: recover the source string or a real string table. */
OSReport("Can't get user_data.\n");
```

## 5. Codegen Tactics

Standards:

- `global_standard:matching-tactics-need-evidence`
- `global_standard:avoid-pragmas-register-asm`

Agents should first try clean C. Pragmas, `register`, volatile locals, widened
lifetimes, dummy locals, direct extern declarations, and declaration-order
steering are exceptions, not source style.

Deterministic coverage:

- `function_extern_visibility`: new function externs are warnings.
- `same_tu_function_extern`: externs for functions defined in the same TU are
  errors.
- `register_keyword`: new `register` declarations are errors.
- `inline_asm`: new inline assembly in normal source is an error.
- `novel_pragma`: new unknown pragmas are warnings.
- `codegen_pragma`: newly added known MWCC codegen pragmas are warnings.
- `volatile_local_tactic`: local volatile declarations are warnings.

Do:

- Try clean C before tactics.
- Keep unavoidable tactics narrow and backed by build/objdiff/regression
  evidence.
- Check adjacent functions when a tactic can perturb codegen, data order, or
  local stack shape.
- Remove unsupported tactics during cleanup even when the clean source lowers
  score; report the score impact instead of reintroducing the tactic.

Do not:

- Use pragmas, `register`, inline asm, local externs, or volatile locals as
  ordinary matching style.
- Hide same-TU function bodies from MWCC with source-local externs.
- Keep one-off helpers or lifetime churn without evidence and a cleanup reason.
- Preserve an overfit worker tactic merely because it protects exactness.

Example:

```c
/* Bad: pragma added as a first-line matching tactic. */
#pragma push
#pragma global_optimizer off
void fn(void) { ... }
#pragma pop

/* Better: attempt cleaner source first and keep only proven narrow exceptions. */
void fn(void) { ... }
```

## 6. Names, Defines, Headers, And Prototypes

Standards:

- `global_standard:conservative-naming`
- `global_standard:no-define-alias-global-renames`
- `global_standard:truthful-headers-and-includes`

Agents should not hide guessed names or missing declarations behind macro
aliases or local externs. Headers and prototypes should become more truthful as
source is recovered.

Deterministic coverage:

- `m2c_residue_names`: generated local names are errors or warnings depending
  on confidence.
- `define_alias`: identifier-to-identifier and expression aliases are errors;
  canonical macro clones are warnings.
- `function_extern_visibility` and `same_tu_function_extern`: indirect coverage
  for header/prototype repair, currently mapped to matching tactics.

Do:

- Use semantic names only when source, callsite, data, or PR evidence supports
  the role.
- Keep one canonical declaration for one known symbol.
- Move declarations to the real owning header when a body proves the signature.
- Remove stale `UNK_RET` and `UNK_PARAMS`.

Do not:

- Invent semantic names from guesses.
- Add `#define old_name new_name` or local expression aliases to hide a rename.
- Hide missing prototypes behind source-local declarations.

Example:

```c
/* Bad: aliasing a speculative rename. */
#define camera_state lbl_804D1234

/* Better: keep the canonical address-style name until meaning is evidenced. */
lbl_804D1234.x0 = value;
```

## Example Routing

Detailed examples belong in targeted repair and review contexts:

| Use case | Source |
| --- | --- |
| Worker base prompt | Compact summaries from `standards.jsonl`; no bulky examples. |
| Deterministic lint finding | `review_lint` message, `standard_id`, `rule_id`, and targeted repair hint. |
| QA repair / PR fixer | Standard-linked examples looked up by `standard_id` and `qa_rule_id`. |
| Pre-ship review | `preship_exhibits.json`, banned-pattern exhibits, and standard-linked examples. |
| Repeated rejected hunk | `banned_patterns/data/tombstones.jsonl` with the original rejection URL. |
