---
covers: Agent-facing Melee code quality standards, current QA coverage, retired rules, lint gaps, and repair examples.
concepts: [agent-standards, qa-lint, decomp-quality, repair-examples, review-lint]
code-ref: knowledge/sources/injectable/decomp_standards/data/standards.jsonl, tools/source_editing/review_lint/api/_qa_rules.py, tools/source_editing/review_lint/README.md
---

# Agent Code Quality Standards Roadmap

This document scopes the Melee standards to source code quality: how agents
should write C, what source shapes should be repaired before handoff, and which
rules already have deterministic QA coverage. It separates code-quality rules
from internal PR workflow rules, regression artifact bookkeeping, and PR shape
policy.

The worker-facing standard set should stay compact. Detailed bad/good examples
belong in repair, pre-ship review, and curated rejection exhibits so the system
can explain and fix findings without bloating every worker prompt.

## Current Standards Surfaces

| Surface | Current role | Keep using it for |
| --- | --- | --- |
| `knowledge/sources/injectable/decomp_standards/data/standards.jsonl` | Runtime-injected global standards. | Compact worker-facing rule summaries and machine-readable standard ids. |
| `docs/20-implementation/knowledge/20-melee-pr-review-qa-standards.md` | Human-readable checklist. | Source-quality rule definitions and maintainer context. |
| `tools/source_editing/review_lint/api/_qa_rules.py` | Deterministic diff scanner. | Hard and warning-level checks over added lines. |
| `knowledge/sources/injectable/banned_patterns/data` | Curated maintainer rejection records. | Exact rejected patterns, regex additions, and tombstones. |
| `packages/agents/src/agents/pr/reviewer/exhibits/preship_exhibits.json` | Pre-ship reviewer examples. | Small curated examples for non-deterministic review. |

## Out Of Scope For This Standard Set

These belong in workflow/runbook docs, not in the agent code-quality standard
set:

- PR shape, grouping, split size, PR body format, and reviewer map policy.
- Manual verification ledgers. Build, objdiff, checkdiff, and regression
  artifacts are produced by the runner pipeline.
- Broad process policy such as when to open, close, or split a PR.

The code standards may still say "this source shape requires evidence" when a
matching tactic is retained, but they should not require a second manual ledger
when the existing pipeline already records the artifacts.

## Disposition Of Existing Standards

| Current standard | Disposition | Target family | Current deterministic QA coverage | Gap |
| --- | --- | --- | --- | --- |
| `global_standard:infer-authored-source-style` | Keep as the cross-cutting principle. | Authored source shape | None; pre-ship review only. | Add examples and local-analog prompts for repair/reviewer agents. |
| `global_standard:natural-loops` | Keep. | Authored source shape | Partial: `m2c_goto_label`, generated-name residue. | No deterministic repeated-block or likely-loop detector yet. |
| `global_standard:canonical-control-flow-and-macros` | Keep. | Authored source shape | Partial: `m2c_goto_label`, macro-clone warnings through `define_alias`. | Switch/ternary/loop opportunities remain pre-ship review. |
| `global_standard:typed-fields-over-pointer-math` | Keep and strengthen. | Typed access | Partial: `stage_ground_var_owner`, `m2c_field_use`, `type_erasing_cast`. | Add pointer-offset arithmetic and raw-address access checks. |
| `global_standard:header-inlines` | Keep. | Asserts, reports, and inlines | Partial: `copied_jobj_inline`. | Add stronger `jobj.h` raw assert/helper candidate examples. |
| `global_standard:assert-report-macros` | Keep. | Asserts, reports, and inlines | Strong: `unrolled_assert`, `fake_assert_macro`, `assert_idiom_downgrade`. | Improve messages with macro-specific repair examples. |
| `global_standard:literals-and-data-ownership` | Keep, but merge with data/TU guidance in the human doc. | Literals, data, and externs | Strong: `extern_literal_anchor`, `numeric_literal_to_symbol`, `new_data_anchor`, `self_tu_extern`, banned patterns, tombstones. | Add address-named static-data checks. |
| `global_standard:no-string-literal-symbol-regression` | Keep as a specific detector-backed rule, but present under the data family. | Literals, data, and externs | Strong: `string_literal_to_symbol`, `packed_string_blob`, tombstones. | Add examples for string-table repairs. |
| `global_standard:text-before-data-matching` | Retire as a standalone worker standard; fold into the data family. | Literals, data, and externs | Partial through data-anchor rules. | Keep the code-quality rule: do not add source artifacts solely to chase data. |
| `global_standard:data-sections-and-tu-splits` | Merge into the data family. | Literals, data, and externs | Partial through extern ownership analysis. | Add clearer metadata-vs-source repair guidance. |
| `global_standard:matching-tactics-need-evidence` | Keep, rename in human docs to "Codegen tactics require repair or a narrow exception." | Codegen tactics | Partial: function extern visibility, same-TU externs, residue, tombstones. | Add volatile-local and single-use-helper review coverage. |
| `global_standard:avoid-pragmas-register-asm` | Keep and strengthen. | Codegen tactics | Partial: `register_keyword`, `inline_asm`, `novel_pragma`. | Warn on new established codegen pragmas too, not only novel pragmas. |
| `global_standard:conservative-naming` | Keep. | Names, defines, and headers | Partial: `m2c_residue_names`. | Keep semantic-name guessing mostly human/pre-ship. |
| `global_standard:no-define-alias-global-renames` | Keep under naming. | Names, defines, and headers | Strong: `define_alias`. | Examples should distinguish macro aliases from legitimate expression macros. |
| `global_standard:truthful-headers-and-includes` | Keep. | Names, defines, and headers | Partial: `function_extern_visibility`, `same_tu_function_extern`. | Add header/prototype repair examples; many cases need compile context. |
| `global_standard:verification-and-regression-ledger` | Retire from worker code standards. | Pipeline-owned verification | Runner and regression-check pipeline. | Preserve as workflow/runbook policy only. |

## Target Code Standard Families

### 1. Authored Source Shape

Agents should prefer source that looks like local authored C, not generated C
that only moves a score. This family covers loops, switches, helper shape,
macro idioms, and generated residue.

Current deterministic coverage:

- `m2c_goto_label`: added `goto block_NN` and `block_NN:` residue.
- `m2c_residue_names`: added `temp_rNN`, `var_rNN`, `phi_fNN`, and suspicious
  `spNN` locals.
- `define_alias`: warning for local `_ABS`, `_MIN`, `_MAX`, and `_CLAMP` clones.

Useful pre-ship examples:

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

```c
/* Bad: goto-only generated structure. */
if (state == 0) {
    goto block_12;
}

/* Better: try a switch or ordinary branch structure. */
switch (state) {
case 0:
    ...
    break;
}
```

Recommended additions:

- Keep deterministic residue checks as hard failures.
- Use pre-ship review for likely loops, switch opportunities, and helpers that
  only exist to alter inlining.
- Add example-backed repair prompts that say "try the clean source form first;
  only keep generated shape if clean source demonstrably loses the match."

### 2. Typed Access And Pointer Math

Agents should describe memory through the most precise local type available:
real fields, correct union arms, accessors, or temporary internal structs before
raw pointer arithmetic.

Current deterministic coverage:

- `stage_ground_var_owner`: stage TUs adding another stage family's `gv` arm.
- `m2c_field_use`: added `M2C_FIELD(...)`.
- `type_erasing_cast`: added `(void*)`, `(u8*)`, or `(char*)` casts.

Examples:

```c
/* Bad: raw offset into a known object. */
value = *(s32*) ((u8*) state + 0x14 + pnum * 0x24);

/* Better: field and array access on the recovered type. */
value = state->players[pnum].x14;
```

```c
/* Bad: borrowing a union arm because offsets line up. */
gp->gv.arwing.xC4 = timer;

/* Better: use or add the owning stage arm. */
gp->gv.bigblue.xC4 = timer;
```

Recommended QA additions:

- `pointer_offset_arithmetic`: warn or error on added `((u8*) obj) + 0xNN`,
  `*(T*) ((u8*) obj + off)`, `base + index * stride`, and address-style offset
  macros when the base is not a known byte buffer.
- `raw_address_field_access`: warn on added dereferences through an
  address-named data symbol when a struct path exists nearby.
- Keep `stage_ground_var_owner` as an error; it directly matches maintainer
  feedback about unrelated `gv` arms.

### 3. Asserts, Reports, And Header Inlines

Agents should map expanded assert/report code back to project macros and header
inlines when local evidence identifies the source-level operation.

Current deterministic coverage:

- `unrolled_assert`: open-coded `__assert`/`__assert_msg` in normal source.
- `fake_assert_macro`: local assert/report macro clones.
- `assert_idiom_downgrade`: removing `HSD_ASSERT*` and adding raw assert/report
  code.
- `copied_jobj_inline`: local copies of `jobj.h` inline helper bodies.

Examples:

```c
/* Bad: raw assert expansion. */
__assert("jobj.h", 0x257, "jobj");

/* Better: project macro when the source operation is a plain assertion. */
HSD_ASSERT(0x257, jobj);
```

```c
/* Bad: pasted jobj inline body in a stage TU. */
if (jobj == NULL) {
    __assert("jobj.h", 0x2F4, "jobj");
}
jobj->flags |= JOBJ_MTX_DIRTY;

/* Better: call the canonical helper when it represents the operation. */
HSD_JObjSetMtxDirtySub(jobj);
```

Recommended QA additions:

- Add a specialized message for `__assert("jobj.h", ...)` that points the
  repair agent at `HSD_JObj*` helpers and the assert line number.
- Add examples to repair prompts showing when `GET_JOBJ` is appropriate and
  when direct `gobj->hsd_obj` or an existing `jobj` local is the cleaner match.

### 4. Literals, Data Ownership, And Externs

Agents should not introduce external variables, static literals, address-named
symbols, or packed string blobs solely to force data ordering. Ordinary strings,
floats, constants, assert text, asset names, and report text should stay inline
unless real ownership evidence says otherwise.

Current deterministic coverage:

- `extern_literal_anchor`
- `new_data_anchor`
- `self_tu_extern`
- `string_literal_to_symbol`
- `numeric_literal_to_symbol`
- `packed_string_blob`
- `banned_pattern:<id>`
- `resubmission_tombstone`

Examples:

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

```c
/* Bad: symbol replacement only to chase data parity. */
lbArchive_LoadSymbols(model, mnNameNew_803EE38C);

/* Better: leave the authored string literal in code. */
lbArchive_LoadSymbols(model, "MenMainBack_Top_joint");
```

Recommended QA additions:

- `address_named_static_data`: flag new `static` or global data with
  address-style names such as `lbl_8XXXXXXX`, unless the diff proves it is moved
  pre-existing data.
- `literal_offset_table`: flag added `#define NAME (lbl_8XXXXXXX + 0xNN)` and
  non-define `string_base + 0xNN` use when the hunk also adds string blobs.
- Keep data-section policy folded into this family rather than as a standalone
  worker standard.

### 5. Codegen Tactics

Agents should first try clean C. Pragmas, `register`, volatile locals, widened
lifetimes, dummy locals, direct extern declarations, and declaration-order
steering are exceptions, not source style.

Current deterministic coverage:

- `register_keyword`
- `inline_asm`
- `novel_pragma`
- `function_extern_visibility`
- `same_tu_function_extern`
- residue and tombstone checks when the tactic resembles prior rejections

Examples:

```c
/* Bad: pragma added as a first-line matching tactic. */
#pragma push
#pragma global_optimizer off
void fn(void) { ... }
#pragma pop

/* Better: attempt cleaner source first. Keep a narrow pragma only when the
 * clean form has been tried and the codegen loss is known. */
void fn(void) { ... }
```

```c
/* Bad: local lifetime steering. */
Vec3* vec_ptr = &vec;
lb_8000B1CC(vec_ptr);

/* Better: direct authored expression. */
lb_8000B1CC(&vec);
```

Recommended QA additions:

- `codegen_pragma`: warn on added `dont_inline`, `auto_inline`,
  `global_optimizer`, and `pool_data` even though those pragmas are known to
  the project. `novel_pragma` should remain for unknown pragmas.
- `volatile_local_tactic`: warn on added local `volatile` declarations in
  normal Melee source outside hardware/SDK-like contexts.
- `single_use_codegen_helper`: pre-ship review rule for new helpers used once
  and wrapping only a field, cast, or argument order change.

### 6. Names, Defines, Headers, And Prototypes

Agents should not hide guessed names or missing declarations behind macro
aliases or local externs. Headers and prototypes should become more truthful as
source is recovered.

Current deterministic coverage:

- `define_alias`
- `function_extern_visibility`
- `same_tu_function_extern`
- `m2c_residue_names`

Examples:

```c
/* Bad: aliasing a speculative rename. */
#define camera_state lbl_804D1234

/* Better: keep the canonical address-style name until meaning is evidenced. */
lbl_804D1234.x0 = value;
```

```c
/* Bad: hiding a missing prototype in the source file. */
extern void SomeFunc(int arg);

/* Better: update the owning header when the signature is known. */
#include "some_header.h"
```

Recommended QA additions:

- Keep `define_alias` as an error for identifier-to-identifier aliases.
- Extend same-TU extern analysis to explain whether the repair is "move to
  owning header", "remove redundant local declaration", or "keep as pre-existing
  same-file data redeclaration".
- Leave semantic-name guessing to pre-ship review; deterministic checks cannot
  reliably prove source meaning.

## Example Catalog Design

Examples should be stored and routed by use case:

| Use case | Suggested storage | Prompt exposure |
| --- | --- | --- |
| Worker base prompt | `standards.jsonl` summaries only | Compact rule text, no bulky examples. |
| Deterministic lint finding | `review_lint` rule metadata | One bad excerpt, one targeted repair hint. |
| QA repair agent | New examples catalog or standard-linked examples | Include examples matching the failing `standard_id` and `rule_id`. |
| Pre-ship reviewer | `preship_exhibits.json` and banned-pattern exhibits | Include curated maintainer rejection examples. |
| Repeated rejected hunk | `banned_patterns/data/tombstones.jsonl` | Cite the original rejection URL and block resubmission. |

Proposed example record shape:

```json
{
  "schema_version": "standard_example_v1",
  "id": "typed-pointer-offset-player-state",
  "standard_id": "global_standard:typed-fields-over-pointer-math",
  "qa_rule_id": "pointer_offset_arithmetic",
  "severity": "repair_required",
  "bad_pattern": "*(s32*) ((u8*) state + 0x14 + pnum * 0x24)",
  "preferred_shape": "state->players[pnum].x14",
  "description": [
    "The access is to a known per-player field; raw byte math hides the type."
  ],
  "source_pr": 2656,
  "comment_url": "https://github.com/doldecomp/melee/pull/2656#discussion_r3404529127"
}
```

The examples catalog should support lookup by `standard_id`, `qa_rule_id`, file
family, and detector severity. It should not become a broad RAG source for every
worker; the high-value path is targeted repair context after a lint or pre-ship
finding already identifies the violated family.

## QA Coverage Tiers

| Tier | Meaning | Current examples |
| --- | --- | --- |
| Deterministic hard fail | Added diff shape is almost always wrong and can be detected cheaply. | `new_data_anchor`, `self_tu_extern`, `packed_string_blob`, `copied_jobj_inline`, `unrolled_assert`, `register_keyword`, `inline_asm`, `m2c_field_use`, `define_alias`. |
| Deterministic warning | Pattern is suspicious but sometimes acceptable with context. | `extern_literal_anchor` for float types, `function_extern_visibility`, `novel_pragma`, `type_erasing_cast`, typed `spNN` locals. |
| Pre-ship review | Requires semantic judgment, local source analogs, or objdiff reasoning. | likely loops, one-off helpers, `GET_JOBJ` vs direct access, authored-source style, broad local lifetime churn. |
| Pipeline-owned verification | Build/regression evidence proves whether retained source matches. | `ninja`, objdiff/checkdiff, regression-check, worker validation artifacts. |

## Implementation Roadmap

1. Reshape `standards.jsonl` around the six target families while preserving
   existing standard ids for compatibility.
2. Mark retired or merged records with a replacement family:
   `verification-and-regression-ledger` becomes workflow-only;
   `text-before-data-matching` and `data-sections-and-tu-splits` merge into the
   data family; string-literal regression remains a specific detector-backed
   rule under that family.
3. Add optional machine fields to each active standard:
   `family`, `severity`, `qa_enforcement`, `example_policy`,
   `preferred_repairs`, and `retired_into`.
4. Add deterministic lint rules for pointer-offset arithmetic,
   address-named static data, codegen pragmas, volatile local tactics, and
   stronger `jobj.h` assert repair hints.
5. Create a standard-linked example catalog used by QA repair and pre-ship
   review. Keep worker bootstrap examples minimal.
6. Update the human standards doc after the JSONL and lint-rule changes so the
   prose, injected standards, and QA scanner describe the same contract.
