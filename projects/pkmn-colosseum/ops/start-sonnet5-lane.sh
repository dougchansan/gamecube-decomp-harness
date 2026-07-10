#!/usr/bin/env bash
set -uo pipefail
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-sonnet5-mid.log"
RUN=618e1435-32f7-4b9c-94ab-df5121fe1524
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting colosseum-sonnet5-mid provider=claude-code model=claude-sonnet-5 run=$RUN" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum \
    --provider claude-code --model claude-sonnet-5 --thinking-level low \
    --agent-timeout-seconds 14400 \
    babysit --run-id "$RUN" \
    --max-workers 4 --idle-sleep-ms 5000 --worker-thinking-level low \
    --candidate-limit 24 --queue-target-size 24 --candidate-window 192 --epoch-ready-queue-size 24 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c \
    --epoch-exclude-paths src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py \
    --force-recover-claims \
    --target-min-size 81 --target-max-size 220 --target-min-fuzzy 45 >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] colosseum-sonnet5-mid exited rc=$rc; restarting in 10s" >> "$LOG"
  sleep 10
done
