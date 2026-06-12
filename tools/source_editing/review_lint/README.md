# Review Lint Tool Suite

This suite keeps decomp-specific review guardrails in an explicit tool API. It
can scan a file or text snippet for:

- type-erasing pointer casts such as `(void*)`, `(u8*)`, and `(char*)`;
- `M2C_FIELD(...)` residue;
- functions containing multiple distinct `Item*` or `Fighter*` variables,
  which often signals an inlined helper that should be split or reused.

Use this before returning source edits or when PR review needs a quick
decomp-specific anti-pattern check.

## Diff-Aware QA Ship Gate: `api/scan_diff.py`

`scan_diff.py` is the deterministic layer of the QA ship gate
(`docs/30-plans/2026-06-11-qa-ship-gate-and-pr-review-wiring.md`). It scans
the ADDED lines of a unified diff — never pre-existing upstream code — for
maintainer-rejected patterns. Input modes:

- `--repo <melee-root> [--base <ref>]`: diff `merge-base(ref, HEAD)..HEAD`
  (default base `origin/master`); `--include-worktree` diffs the worktree
  instead of HEAD; `--path <pathspec>` (repeatable) restricts the diff.
- `--repo <melee-root> --diff-file <patch>`: scan a pre-computed unified diff
  (the worker-side L1 lint and per-slice pre-ship review use this).

Stdout is always the JSON document
(`{tool, operation, status, repo, base, findings, counts}`); the
human-readable summary goes to stderr. Rules live in `api/_qa_rules.py`
(shared with `scan.py`); the extern ownership analysis is in
`api/check_extern_ownership.py`.

### Rules

| Rule id | Severity | Detects |
| --- | --- | --- |
| `extern_literal_anchor` | warning (error for `char`/`u8`) | Added `extern` declaration of `f32`/`f64`/`float`/`double`/`char`/`u8` with an address-style name (`lbl_804DA60C`-shaped) and no initializer. String types are an immediate error; float types go through the ownership analysis below and either escalate or stay a `cross_tu_ok` warning. |
| `new_data_anchor` | error | Extern, uses, and definition for the same symbol all introduced by this diff: an invented data anchor to force data ordering. |
| `self_tu_extern` | error | Extern whose encoded address falls inside the TU's own section ranges in `splits.txt` — the TU externing data it owns to dodge data ordering. |
| `string_literal_to_symbol` | error | A string-literal call argument replaced by a data symbol or `ident + 0xNN` offset expression within the same hunk. |
| `packed_string_blob` | error | Hand-packed `static char name[0xNN] =` blobs concatenating string literals with `\0` padding, or `#define NAME (lbl_8XXXXXXX + 0xNN)` pointer-offset macros. |
| `unrolled_assert` | error | Open-coded `__assert`/`__assert_msg` call sites in `src/melee/**`/`src/sysdolphin/**` where the source idiom is `HSD_ASSERT*` (macro definitions and continuation lines are skipped). |
| `banned_pattern:<id>` | error | Regex detectors loaded from `knowledge/sources/injectable/banned_patterns/data/banned.jsonl` (env override `REVIEW_LINT_BANNED_DIR`). |
| `resubmission_tombstone` | error | An added hunk whose normalized token-shingle Jaccard similarity to a previously rejected hunk meets the tombstone's threshold (default 0.7; hunks under 12 tokens are never checked). The finding cites the original rejection comment URL. |

Every finding carries a `standard_id` so agent-facing errors cite the
standard the worker already saw in its prompt.

### Moved vs. Invented Data Anchors

The extern ownership analysis separates the accepted case from the rejected
one. A forward declaration of data the TU still defines later in the file,
where the symbol already existed in the base version (a definition moved
within the file — the accepted ftcoll style from melee PR #2655), is dropped.
The same shape where the symbol is entirely new in the diff (the rejected
gm_1832 style from PR #2656) becomes a `new_data_anchor` error.

### Exit Codes (`--gate`)

- `0`: clean.
- `1`: at least one error finding (hard fail).
- `2`: warnings only.

Without `--gate` the exit code is `0` unless the tool itself fails (`3` for a
missing repo or diff file). Consumers share one invoker,
`packages/core/src/qa/scan-diff.ts`: the L2 ship gate in `regression-check`
(fails closed on tool errors), the worker-side L1 lint in `change-validation`
(fails open on tool errors), and `pr-preship-review` (per-slice lint evidence
for the adversarial reviewer).
