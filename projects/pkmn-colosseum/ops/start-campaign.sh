#!/usr/bin/env bash
# Type-recovery campaign: glm -> codex, base master@86915078 + captured cracks.
# Harness feature/telemetry-escalation: decompStyleRule (struct-access) + pending-claim
# watchdog + SDK token capture + board-throttle; seedcoder stripped. Zero Claude subscription.
set -uo pipefail
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-campaign.log"
RUN="d21d475d-d8b8-4d72-b540-28052a1a66c7"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting TYPE-RECOVERY CAMPAIGN glm->codex run=$RUN (rule+watchdog+tokencap)" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum \
    --provider openai-codex --model gpt-5.5 --thinking-level medium \
    --agent-timeout-seconds 3600 \
    babysit --run-id "$RUN" \
    --auto-resolve-conflicts \
    --resolver-provider zai --resolver-model glm-5.2 --resolver-thinking-level low \
    --escalation --ladder projects/pkmn-colosseum/ladder.campaign.json \
    --max-workers 4 --idle-sleep-ms 5000 --worker-thinking-level low \
    --board-refresh-ms 15000 \
    --candidate-limit 512 --queue-target-size 32 --candidate-window 512 --epoch-ready-queue-size 32 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c,src/game/people/people_field.c \
    --target-exclude-sources src/game/people/people_field.c \
    --epoch-exclude-paths src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] campaign exited rc=$rc; restart 10s" >> "$LOG"
  sleep 10
done
