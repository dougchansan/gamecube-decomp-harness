#!/usr/bin/env bash
# Gate-fix validation: re-run the 3 gate-rejected byte-exacts on the A+C-fixed harness.
# glm -> codex (non-Claude-subscription); workers pinned to battle_waza.c + gs_render.c [75-100) via claim filter.
# SUCCESS = a credited crack at escalation_level>=1 (codex), which the pre-fix gate scored 0-for-3.
set -uo pipefail
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-validation.log"
RUN="7035142a-5e2f-40bb-a77c-4f8398acdb50"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting VALIDATION glm->codex targets=battle_waza+gs_render[75-100) run=$RUN" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum \
    --provider zai --model glm-5.2 --thinking-level low \
    --agent-timeout-seconds 3600 \
    babysit --run-id "$RUN" \
    --escalation --ladder projects/pkmn-colosseum/ladder.validation.json \
    --target-sources src/game/battle/battle_waza.c,src/game/gs_render.c --target-min-fuzzy 75 \
    --max-workers 3 --idle-sleep-ms 5000 --worker-thinking-level low \
    --candidate-limit 6000 --queue-target-size 32 --candidate-window 6000 --epoch-ready-queue-size 32 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] validation exited rc=$rc; restart 10s" >> "$LOG"
  sleep 10
done
