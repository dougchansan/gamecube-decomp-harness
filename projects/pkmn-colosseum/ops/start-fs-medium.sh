#!/usr/bin/env bash
# From-scratch MEDIUM lane: fuzzy-0 (never-decompiled) functions 257B-1024B, in an
# ISOLATED worktree so it can't collide with the near-miss grind. gpt-5.5 high.
# MAXW=2 default.
set -uo pipefail
export ORCH_AGENT_KERNEL_DATABASE_URL="postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel"
export ORCH_AGENT_KERNEL_REQUIRED=1
export ORCH_AGENT_KERNEL_SPAWN_STRATEGY=auto
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
WT=/Users/douglaswhittingham/pkmn-colosseum-fs-medium
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-fs-medium.log"
RUN="${RUN:-$(cat /tmp/grind/fs-medium_run.txt 2>/dev/null)}"
MAXW="${MAXW:-2}"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting FS-MEDIUM lane run=$RUN max-workers=$MAXW repo=$WT" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum --repo-root "$WT" \
    --provider openai-codex --model gpt-5.5 --thinking-level high \
    --agent-timeout-seconds 2400 \
    babysit --run-id "$RUN" \
    --auto-resolve-conflicts \
    --resolver-provider openai-codex --resolver-model gpt-5.5 --resolver-thinking-level low \
    --escalation --ladder projects/pkmn-colosseum/ladder.fs-medium.json \
    --max-workers "$MAXW" --idle-sleep-ms 5000 --worker-thinking-level high \
    --board-refresh-ms 15000 \
    --candidate-limit 256 --queue-target-size 3 --candidate-window 2048 --epoch-ready-queue-size 4 \
    --fuzzy-max 0 --size-min 257 --size-max 1024 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c,src/game/people/people_field.c \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fs-medium exited rc=$rc; restart 10s" >> "$LOG"
  sleep 10
done
