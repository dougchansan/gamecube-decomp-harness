#!/usr/bin/env bash
# 2026-07-09 codex→sonnet campaign launcher (harness-native, dashboard-integrated).
# Default provider = claude-code/claude-sonnet-5 (works now; codex is usage-limited
# until ~11:56 AM). Ladder rung0=codex, rung1=sonnet: the A3 rate-limit skip auto-
# falls to sonnet while codex is exhausted and returns to codex when it resets.
# Runs babysit in a while-loop; MUST be started inside a durable tmux so a closed
# terminal (SIGHUP — what killed the Jul-2 run) can't stop it.
set -uo pipefail
# Kernel runtime DB (postgres via colima container agent-kernel-db) — REQUIRED for
# non-claude-code providers (codex) to spawn real agents. claude-code uses a direct
# runner and needs none, which is why sonnet worked but codex errored "missing
# initialized kernel runtime DB".
export ORCH_AGENT_KERNEL_DATABASE_URL="postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel"
export ORCH_AGENT_KERNEL_REQUIRED=1
export ORCH_AGENT_KERNEL_SPAWN_STRATEGY=auto
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-sonnet.log"
# Run id is read from the ops state file (written by init-run), not hardcoded, so
# relaunching never leaves an edit in git. Override with RUN=... env if needed.
RUN="${RUN:-$(cat /tmp/grind/harness_run.txt 2>/dev/null)}"
MAXW="${MAXW:-3}"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting CODEX->SONNET campaign run=$RUN max-workers=$MAXW" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum \
    --provider openai-codex --model gpt-5.5 --thinking-level medium \
    --agent-timeout-seconds 3600 \
    babysit --run-id "$RUN" \
    --auto-resolve-conflicts \
    --resolver-provider openai-codex --resolver-model gpt-5.5 --resolver-thinking-level low \
    --escalation --ladder projects/pkmn-colosseum/ladder.campaign.codex-tiered.json \
    --max-workers "$MAXW" --idle-sleep-ms 5000 --worker-thinking-level medium \
    --board-refresh-ms 15000 \
    --candidate-limit 512 --queue-target-size 8 --candidate-window 512 --epoch-ready-queue-size 8 \
    --ttl-seconds 7200 \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c,src/game/people/people_field.c \
    --target-exclude-sources src/game/people/people_field.c \
    --epoch-exclude-paths src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] campaign exited rc=$rc; restart 10s" >> "$LOG"
  sleep 10
done
