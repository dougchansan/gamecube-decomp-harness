#!/usr/bin/env bash
set -uo pipefail
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-escalation-scratch.log"
RUN="da04cd07-74db-45fa-b359-911330141eca"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting colosseum-escalation-scratch ladder=glm->sonnet5 run=$RUN --escalation" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum \
    --provider zai --model glm-5.2 --thinking-level low \
    --agent-timeout-seconds 14400 \
    babysit --run-id "$RUN" \
    --escalation --ladder projects/pkmn-colosseum/ladder.scratch2.json \
    --max-workers 2 --idle-sleep-ms 5000 --worker-thinking-level low \
    --candidate-limit 24 --queue-target-size 24 --candidate-window 192 --epoch-ready-queue-size 24 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c \
    --epoch-exclude-paths src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] escalation-scratch exited rc=$rc; restarting in 10s" >> "$LOG"
  sleep 10
done
