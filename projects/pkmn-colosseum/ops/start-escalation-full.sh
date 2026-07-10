#!/usr/bin/env bash
# Active weak->strong escalation lane (deepseek dropped 2026-07-01: SSH-tunnel hang + dead quota).
# Ladder: glm-5.2 -> claude-sonnet-5 -> gpt-5.5 -> claude-opus-4-8 -> claude-fable-5
# Per-rung agentTimeoutSeconds bound hangs (cheap short, top long); global is a 3h backstop.
set -uo pipefail
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-escalation-full.log"
RUN="0254b3f0-3324-45f6-a627-8d13021040d7"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting colosseum-escalation-ACTIVE ladder=glm->sonnet5->codex->opus->fable run=$RUN --escalation" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum \
    --provider zai --model glm-5.2 --thinking-level low \
    --agent-timeout-seconds 10800 \
    babysit --run-id "$RUN" \
    --escalation --ladder projects/pkmn-colosseum/ladder.active.codex.json \
    --max-workers 4 --idle-sleep-ms 5000 --worker-thinking-level low \
    --candidate-limit 32 --queue-target-size 32 --candidate-window 256 --epoch-ready-queue-size 32 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c \
    --epoch-exclude-paths src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] escalation-active exited rc=$rc; restarting in 10s" >> "$LOG"
  sleep 10
done
