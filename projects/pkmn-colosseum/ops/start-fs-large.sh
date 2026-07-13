#!/usr/bin/env bash
# From-scratch LARGE lane: fuzzy-0 (never-decompiled) functions >=1025B, in an
# ISOLATED worktree so it can't collide with the near-miss grind. All workers
# and conflict resolution use gpt-5.6-sol xhigh. MAXW=1 default.
set -uo pipefail
export ORCH_AGENT_KERNEL_DATABASE_URL="postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel"
export ORCH_AGENT_KERNEL_REQUIRED=1
export ORCH_AGENT_KERNEL_SPAWN_STRATEGY=auto
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
WT=/Users/douglaswhittingham/pkmn-colosseum-fs-large
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-fs-large.log"
RUN="${RUN:-$(cat /tmp/grind/fs-large_run.txt 2>/dev/null)}"
MAXW="${MAXW:-1}"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting FS-LARGE lane run=$RUN max-workers=$MAXW repo=$WT" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum --repo-root "$WT" \
    --provider openai-codex --model gpt-5.6-sol --thinking-level xhigh \
    --agent-timeout-seconds 3000 \
    babysit --run-id "$RUN" \
    --auto-resolve-conflicts \
    --resolver-provider openai-codex --resolver-model gpt-5.6-sol --resolver-thinking-level xhigh \
    --escalation --ladder projects/pkmn-colosseum/ladder.fs-large.json \
    --max-workers "$MAXW" --idle-sleep-ms 5000 --worker-thinking-level xhigh \
    --board-refresh-ms 15000 \
    --candidate-limit 256 --queue-target-size 3 --candidate-window 2048 --epoch-ready-queue-size 4 \
    --fuzzy-max "${FUZZY_MAX:-0}" --size-min 1025 \
    --ttl-seconds 7200 \
    --epoch-worktree "$ROOT/projects/pkmn-colosseum/state/epoch_worktree_fs-large" \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c,src/game/people/people_field.c,src/game/fight_range_80211A00.c \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fs-large exited rc=$rc; restart 10s" >> "$LOG"
  sleep 10
done
