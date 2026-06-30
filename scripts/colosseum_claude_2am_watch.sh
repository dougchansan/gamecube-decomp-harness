#!/usr/bin/env bash
set -euo pipefail

HARNESS_ROOT="${HARNESS_ROOT:-/Users/douglaswhittingham/gamecube-decomp-harness}"
PROJECT="${PROJECT:-pkmn-colosseum}"
RUN_ID="${RUN_ID:?RUN_ID is required}"
LOG_DIR="${LOG_DIR:-$HARNESS_ROOT/projects/$PROJECT/state/overnight/manual-claude}"
CLAUDE_PROVIDER="${CLAUDE_PROVIDER:-claude-code}"
CLAUDE_MODEL="${CLAUDE_MODEL:-sonnet}"
CLAUDE_WORKERS="${CLAUDE_WORKERS:-2}"
CLAUDE_MAX_WORKERS="${CLAUDE_MAX_WORKERS:-}"
CLAUDE_THINKING="${CLAUDE_THINKING:-low}"
CLAUDE_WAIT_UNTIL_2AM="${CLAUDE_WAIT_UNTIL_2AM:-0}"
CLAUDE_TARGET_MIN_SIZE="${CLAUDE_TARGET_MIN_SIZE:-81}"
CLAUDE_TARGET_MAX_SIZE="${CLAUDE_TARGET_MAX_SIZE:-220}"
CLAUDE_TARGET_MIN_FUZZY="${CLAUDE_TARGET_MIN_FUZZY:-45}"
CLAUDE_TARGET_MAX_FUZZY="${CLAUDE_TARGET_MAX_FUZZY:-}"
AGENT_TIMEOUT_SECONDS="${AGENT_TIMEOUT_SECONDS:-14400}"
TTL_SECONDS="${TTL_SECONDS:-7200}"
IDLE_SLEEP_MS="${IDLE_SLEEP_MS:-5000}"
EXCLUDE_SOURCES="${EXCLUDE_SOURCES:-src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c}"
EPOCH_EXCLUDE_PATHS="${EPOCH_EXCLUDE_PATHS:-src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py}"

cd "$HARNESS_ROOT"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/claude.log"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" | tee -a "$LOG_FILE"
}

seconds_until_2am() {
  python3 - <<'PY'
from datetime import datetime
now = datetime.now()
target = now.replace(hour=2, minute=0, second=0, microsecond=0)
print(max(0, int((target - now).total_seconds())))
PY
}

claude_cli_ready() {
  command -v claude >/dev/null 2>&1 || return 1
  claude auth status 2>/dev/null | python3 -c 'import json,sys; data=json.load(sys.stdin); raise SystemExit(0 if data.get("loggedIn") else 1)'
}

effective_max_workers() {
  if [ -n "$CLAUDE_MAX_WORKERS" ]; then
    printf '%s\n' "$CLAUDE_MAX_WORKERS"
    return 0
  fi
  local status_json
  status_json="$(bun apps/server/src/job-runner.ts --project "$PROJECT" status 2>/dev/null)"
  python3 -c '
import json, sys
lane_workers = int(sys.argv[1])
data = json.loads(sys.stdin.read())
desired = int((data.get("run") or {}).get("desiredWorkers") or lane_workers)
active = int(data.get("activeClaims") or 0)
print(max(0, min(desired, active + lane_workers)))
' "$CLAUDE_WORKERS" <<<"$status_json"
}

if [ "$CLAUDE_WAIT_UNTIL_2AM" = "1" ]; then
  wait_seconds="$(seconds_until_2am)"
  if [ "$wait_seconds" -gt 0 ]; then
    log "Claude watcher armed for local 02:00; waiting ${wait_seconds}s for run=$RUN_ID"
    sleep "$wait_seconds"
  else
    log "Local 02:00 has passed; starting Claude readiness checks for run=$RUN_ID"
  fi
else
  log "Claude watcher starting immediately for run=$RUN_ID"
fi

while true; do
  if ! claude_cli_ready; then
    log "Claude Code CLI is not logged in yet; retrying in 120s"
    sleep 120
    continue
  fi

  model="$CLAUDE_MODEL"
  max_workers="$(effective_max_workers || printf '%s\n' "$CLAUDE_WORKERS")"
  target_args=()
  [ -n "$CLAUDE_TARGET_MIN_SIZE" ] && target_args+=(--target-min-size "$CLAUDE_TARGET_MIN_SIZE")
  [ -n "$CLAUDE_TARGET_MAX_SIZE" ] && target_args+=(--target-max-size "$CLAUDE_TARGET_MAX_SIZE")
  [ -n "$CLAUDE_TARGET_MIN_FUZZY" ] && target_args+=(--target-min-fuzzy "$CLAUDE_TARGET_MIN_FUZZY")
  [ -n "$CLAUDE_TARGET_MAX_FUZZY" ] && target_args+=(--target-max-fuzzy "$CLAUDE_TARGET_MAX_FUZZY")
  log "Claude Code ready: provider=$CLAUDE_PROVIDER model=$model lane_workers=$CLAUDE_WORKERS max_workers=$max_workers filters=${target_args[*]}"
  bun apps/server/src/job-runner.ts --project "$PROJECT" \
    --provider "$CLAUDE_PROVIDER" --model "$model" --thinking-level "$CLAUDE_THINKING" \
    --agent-timeout-seconds "$AGENT_TIMEOUT_SECONDS" \
    babysit --run-id "$RUN_ID" \
    --max-workers "$max_workers" \
    --idle-sleep-ms "$IDLE_SLEEP_MS" \
    --worker-thinking-level "$CLAUDE_THINKING" \
    --candidate-limit 16 \
    --queue-target-size 16 \
    --candidate-window 128 \
    --epoch-ready-queue-size 16 \
    --ttl-seconds "$TTL_SECONDS" \
    --exclude-sources "$EXCLUDE_SOURCES" \
    --epoch-exclude-paths "$EPOCH_EXCLUDE_PATHS" \
    "${target_args[@]}" \
    --force-recover-claims --max-restarts 999 --restart-delay-ms 30000 --restart-on-clean-exit \
    2>&1 | tee -a "$LOG_FILE"

  log "Claude babysit exited; retrying in 60s"
  sleep 60
done
