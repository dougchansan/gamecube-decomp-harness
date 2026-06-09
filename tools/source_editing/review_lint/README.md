# Review Lint Tool Suite

This suite ports the most useful checks from the reference harness Claude hook
scripts into an explicit tool API. It can scan a file or text snippet for:

- type-erasing pointer casts such as `(void*)`, `(u8*)`, and `(char*)`;
- `M2C_FIELD(...)` residue;
- functions containing multiple distinct `Item*` or `Fighter*` variables,
  which often signals an inlined helper that should be split or reused.

Use this before returning source edits or when PR review needs a quick
decomp-specific anti-pattern check.
