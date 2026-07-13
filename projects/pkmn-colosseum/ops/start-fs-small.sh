#!/usr/bin/env bash
# From-scratch SMALL lane: fuzzy-0 (never-decompiled) functions <=256B, in an
# ISOLATED worktree so it can't collide with the near-miss grind. Codex Spark
# spends the small-function quota first; gpt-5.6-sol xhigh takes survivors.
# MAXW=3 default: tiny fns are cheap, run more in parallel.
set -uo pipefail
export ORCH_AGENT_KERNEL_DATABASE_URL="postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel"
export ORCH_AGENT_KERNEL_REQUIRED=1
export ORCH_AGENT_KERNEL_SPAWN_STRATEGY=auto
ROOT=/Users/douglaswhittingham/gamecube-decomp-harness
WT=/Users/douglaswhittingham/pkmn-colosseum-fromscratch
STATE="$ROOT/.decomp-orchestrator-state"
LOG="$STATE/colosseum-fs-small.log"
RUN="${RUN:-$(cat /tmp/grind/fs-small_run.txt 2>/dev/null)}"
MAXW="${MAXW:-3}"
mkdir -p "$STATE"; cd "$ROOT"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting FS-SMALL lane run=$RUN max-workers=$MAXW repo=$WT" >> "$LOG"
while true; do
  bun apps/server/src/job-runner.ts --project pkmn-colosseum --repo-root "$WT" \
    --provider openai-codex --model gpt-5.6-sol --thinking-level xhigh \
    --agent-timeout-seconds 3000 \
    babysit --run-id "$RUN" \
    --auto-resolve-conflicts \
    --resolver-provider openai-codex --resolver-model gpt-5.6-sol --resolver-thinking-level xhigh \
    --escalation --ladder projects/pkmn-colosseum/ladder.fs-small.json \
    --max-workers "$MAXW" --idle-sleep-ms 5000 --worker-thinking-level xhigh \
    --board-refresh-ms 15000 \
    --candidate-limit 256 --queue-target-size 8 --epoch-size 8 --candidate-window 2048 --epoch-ready-queue-size 8 \
    --fuzzy-max "${FUZZY_MAX:-0}" --size-max 256 \
    --ttl-seconds 7200 \
    --epoch-worktree "$ROOT/projects/pkmn-colosseum/state/epoch_worktree_fs-small" \
    --exclude-sources src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c,src/game/people/people_field.c,src/game/fight_range_80211A00.c \
    --force-recover-claims >> "$LOG" 2>&1
  rc=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fs-small exited rc=$rc; restart 10s" >> "$LOG"
  sleep 10
done
