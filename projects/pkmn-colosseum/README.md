# Pokemon Colosseum Project

This descriptor points the harness at a dtk-template Pokemon Colosseum
workspace using the `GC6E01` build/report paths.

Use the ignored `local.project.json` file for machine-specific checkout paths.
The tracked default expects a checkout at `projects/pkmn-colosseum/checkout/`.

Common commands:

```sh
bun run server:job -- --project pkmn-colosseum status
bun run server:job -- --project pkmn-colosseum report-run
bun run server:job -- --project pkmn-colosseum regression-check
```
