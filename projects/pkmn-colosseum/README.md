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

## GLM-5.2 Lane

Z.ai documents GLM-5.2 as an OpenAI-compatible chat-completions model with
1M context and 128K max output. Pi already has Z.ai compatibility, but this
runtime may need a local `glm-5.2` model entry until the bundled generated
model list catches up.

Local setup:

```sh
mkdir -p projects/pkmn-colosseum/.pi-agent
cp projects/pkmn-colosseum/pi-agent.models.example.json \
  projects/pkmn-colosseum/.pi-agent/models.json
printf '%s\n' 'PI_CODING_AGENT_DIR=./.pi-agent' > projects/pkmn-colosseum/local.env
```

Then set `ZAI_API_KEY` in the ignored local environment or replace the
`apiKey` value in the ignored `.pi-agent/models.json` with a command-backed
secret lookup.

Run a GLM lane:

```sh
bun run server:job -- --project pkmn-colosseum --provider zai --model glm-5.2 \
  --thinking-level low --agent-timeout-seconds 14400 babysit --run-id <run-id> \
  --max-workers 2 --idle-sleep-ms 5000 --worker-thinking-level low
```
