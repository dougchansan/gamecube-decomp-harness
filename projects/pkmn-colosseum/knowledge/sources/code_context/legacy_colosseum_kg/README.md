# Legacy Colosseum KG

This source preserves a curated snapshot of the previous Pokemon Colosseum
decompilation campaign. It is searchable historical evidence, not current
match status. Current dtk-template source, assembly, compiler configuration,
and `build/GC6E01/report.json` always take precedence.

The tracked snapshot deliberately excludes bulk progress percentages, the old
source-derived call graph, inferred tags, wildcard name guesses, and malformed
crack rows. It retains:

- structured compiler/code-shape levers;
- crack observations that state a concrete outcome;
- function notes, equivalence observations, and wall classifications;
- the historical wall taxonomy;
- proposal-only synthetic lever nodes for descriptive observations whose
  original lever definition is missing.

Every crack and function hint requires revalidation in the current translation
unit. Synthetic levers have no invented description and remain low-confidence
proposals.

Regenerate the snapshot from a legacy database with:

```sh
bun run kg:import-legacy-colosseum-kg -- \
  --project pkmn-colosseum \
  --input /path/to/tools/decomp_work/kg/kg.db
```

Then rebuild and verify the searchable graph:

```sh
bun run kg:rebuild -- --project pkmn-colosseum --sources code_graph,legacy_colosseum_kg
bun run kg:search -- --project pkmn-colosseum --query fn_8005E7F0 --source legacy_colosseum_kg
bun run kg:smoke -- --project pkmn-colosseum --strict
```
