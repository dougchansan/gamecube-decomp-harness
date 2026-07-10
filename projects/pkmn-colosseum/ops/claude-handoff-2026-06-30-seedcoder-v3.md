# Claude Handoff - Pokemon Colosseum Fresh DTK Campaign

Date: 2026-06-30

## Start Here

Primary harness repo:

```sh
cd /Users/douglaswhittingham/gamecube-decomp-harness
```

Primary game repo:

```sh
cd /Users/douglaswhittingham/pkmn-colosseum
```

Current active run:

```text
618e1435-32f7-4b9c-94ab-df5121fe1524
```

Refresh run state with:

```sh
cd /Users/douglaswhittingham/gamecube-decomp-harness
bun run server:job -- --project pkmn-colosseum status
```

Last observed status from that command:

```text
run active
epoch targets 19
admitted targets 2
schedulable targets 2
claimed 3
finished 14
remaining 5
active claims 3
worker output integrations 4
worker output integration conflicts 0
```

## Hard Rules

- Follow `/Users/douglaswhittingham/pkmn-colosseum/AGENTS.md`.
- Do not edit, add, stage, or commit `*_fn_*.inc` files.
- Do not accept asm wrappers, inline PPC asm, or `.inc` bodies as decomp wins.
- Do not flip real C back to asm wrappers for fake match progress.
- Validate all claimed matches in the parent repo before trusting worker output.
- Do not revert dirty game-repo files unless the user explicitly asks.

## Active Tmux

Session:

```sh
tmux list-windows -t gamecube-harness
```

Observed windows:

```text
0 zsh
1 colosseum-codex-hard
2 colosseum-glm52-tiny
3 colosseum-deepseek-cloud
4 colosseum-claude-2am
5 ollama-win-cloud
6 colosseum-sonnet-seedv3
```

Useful checks:

```sh
tmux capture-pane -pS -200 -t gamecube-harness:6
tail -100 /Users/douglaswhittingham/gamecube-decomp-harness/.decomp-orchestrator-state/colosseum-sonnet-seedv3.log
```

The user previously asked to disable DeepSeek and use Sonnet for now. If the
DeepSeek window is still doing work, pause or recover it before relying on its
output.

Update 2026-06-30 10:18 HST: the Claude/Sonnet lane hit the 5-hour usage cap
and was pulled from the harness. Windows `colosseum-claude-2am` and
`colosseum-sonnet-seedv3` were stopped, lingering `claude-sonnet-4-5` worker
processes were terminated, and interrupted claims were recovered. The overnight
launcher now defaults `ENABLE_CLAUDE=0`; set `ENABLE_CLAUDE=1` explicitly only
after quota recovers.

## SeedCoder V3 Facts

Use the trained 3090 model, not Windows and not an untrained Ollama pull.

3090 host:

```text
100.116.145.17
hostname douglaswhittingham-A520I-AC
```

Trained server process on the 3090:

```text
/storage/finetune/llm4decompile/venv/bin/python serve_v3.py \
  --adapter /storage/finetune/sft/seedcoder8b-cw-v3/final \
  --base ByteDance-Seed/Seed-Coder-8B-Instruct \
  --port 8780 \
  --load-mode bf16
```

Health check:

```sh
curl -sS --max-time 5 http://100.116.145.17:8780/
```

Expected:

```json
{"ok": true, "model": "seedcoder8b-cw-v3", "mode": "bf16"}
```

Important: Ollama on the 3090 is running, but `ollama list` is empty. Do not
use or pull `hf.co/unsloth/Seed-Coder-8B-Instruct-GGUF`; that is not the
trained V3 model.

## Integration Decision

Do not add SeedCoder V3 as a normal Pi provider.

Reason: the trained V3 server exposes a narrow `/gen` candidate endpoint. It is
not OpenAI-compatible and is not a full tool-using agent. The correct role is
proposal-only: let normal harness workers call it for C hints, then require
DTK/checkdiff/objdiff validation before any edit is retained.

## Harness Changes In Progress

Uncommitted harness changes add a `seedcoder_v3_propose` tool:

```text
toolpacks/gamecube-decomp/research/seedcoder_v3/api/propose.py
toolpacks/gamecube-decomp/research/seedcoder_v3/tool.json
toolpacks/gamecube-decomp/registry.json
apps/server/src/core/tools/wrappers/capabilities.ts
apps/server/src/core/tools/metadata/capabilities.ts
apps/server/src/core/tools/profiles/defaults.ts
apps/server/src/core/agent-catalog/agents/running/worker/agent.ts
```

Purpose: dump target assembly from DTK `objdiff.json` / `report.json`, call
the trained SeedCoder V3 `/gen` endpoint, and return candidate C as external
hints. The tool does not write source.

Direct smoke command:

```sh
cd /Users/douglaswhittingham/gamecube-decomp-harness
python3 toolpacks/gamecube-decomp/research/seedcoder_v3/api/propose.py \
  --repo-root /Users/douglaswhittingham/pkmn-colosseum \
  --function strcpy \
  --n 1 \
  --temp 0 \
  --max-new 120 \
  --timeout-seconds 180 \
  --json
```

Expected policy field:

```text
external_hint_only_validate_before_editing
```

The `colosseum-sonnet-seedv3` lane was started after adding this tool, so it
should see `seedcoder_v3_propose`. Older long-lived workers may need restart to
see the new tool.

## Validation Already Run

Harness validation:

```sh
python3 -m json.tool toolpacks/gamecube-decomp/registry.json
python3 -m json.tool toolpacks/gamecube-decomp/research/seedcoder_v3/tool.json
bun x tsc --noEmit
```

SeedCoder direct probe succeeded for `strcpy`:

```sh
python3 toolpacks/gamecube-decomp/research/seedcoder_v3/api/propose.py \
  --repo-root /Users/douglaswhittingham/pkmn-colosseum \
  --function strcpy \
  --n 1 \
  --temp 0 \
  --max-new 80 \
  --timeout-seconds 180 \
  --json
```

`bun run check` was not rerun after the latest patch. Earlier, it failed on a
pre-existing repo-policy expectation that the harness root should not have a
root `scripts/` directory. That appears unrelated to SeedCoder.

## Dirty State

Harness repo:

```text
branch main...origin/main
modified:
  apps/server/src/core/agent-catalog/agents/running/worker/agent.ts
  apps/server/src/core/tools/metadata/capabilities.ts
  apps/server/src/core/tools/profiles/defaults.ts
  apps/server/src/core/tools/wrappers/capabilities.ts
  toolpacks/gamecube-decomp/registry.json
untracked:
  toolpacks/gamecube-decomp/research/seedcoder_v3/
  projects/pkmn-colosseum/ops/claude-handoff-2026-06-30-seedcoder-v3.md
```

Game repo:

```text
branch master...origin/master
modified:
  src/crt/mem.c
  src/crt/string.c
  src/game/menu/menu_bag.c
```

Those game-repo edits appear to be worker/campaign edits. Treat them as
untrusted until parent validation passes. Do not revert them casually.

## Game Repo Validation Commands

For single-file edits:

```sh
cd /Users/douglaswhittingham/pkmn-colosseum
python tools/compile_check.py src/path/to/file.c
```

For per-function claims:

```sh
python tools/match_scan_file.py src/path/to/file.c fn_XXXXXXXX
```

For whole progress:

```sh
python tools/decomp_work/progress2.py --measure
```

Parent gate before commit:

```sh
python tools/decomp_work/overnight/verify_match.py <stem> <fn>
python tools/decomp_work/overnight/verify_gate.py --range HEAD~1..HEAD
```

## Recommended Next Steps

1. Confirm `seedcoder_v3_propose` appears in a Sonnet worker tool list.
2. Watch `colosseum-sonnet-seedv3` and verify it can claim targets.
3. Validate the dirty game-repo edits before committing any matching wins.
4. If SeedCoder hints are useful, keep it on small or medium low-risk targets.
5. Commit/push harness integration separately from any Colosseum source wins.

## Risks

- SeedCoder V3 is a hint generator, not a validator.
- The new SeedCoder lane is live, but tool usage in an actual worker has not
  been proven yet.
- Active worker edits in the game repo may be partial or nonmatching.
- DeepSeek may still have a tmux window despite the user's latest direction to
  use Sonnet for now.
