#!/usr/bin/env bash
set -euo pipefail

ROOT="${HARNESS_ROOT:-/Users/douglaswhittingham/gamecube-decomp-harness}"
PROJECT="${PROJECT:-pkmn-colosseum}"
SESSION="${TMUX_SESSION:-gamecube-harness}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOGDIR="${LOGDIR:-$ROOT/projects/$PROJECT/state/overnight/$STAMP}"

DESIRED_WORKERS="${DESIRED_WORKERS:-6}"
CANDIDATE_LIMIT="${CANDIDATE_LIMIT:-64}"
QUEUE_TARGET_SIZE="${QUEUE_TARGET_SIZE:-64}"
CANDIDATE_WINDOW="${CANDIDATE_WINDOW:-512}"
EPOCH_READY_QUEUE_SIZE="${EPOCH_READY_QUEUE_SIZE:-64}"
AGENT_TIMEOUT_SECONDS="${AGENT_TIMEOUT_SECONDS:-14400}"
TTL_SECONDS="${TTL_SECONDS:-7200}"
IDLE_SLEEP_MS="${IDLE_SLEEP_MS:-5000}"
RESTART_DELAY_MS="${RESTART_DELAY_MS:-30000}"

EXCLUDE_SOURCES="${EXCLUDE_SOURCES:-src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c}"
EPOCH_EXCLUDE_PATHS="${EPOCH_EXCLUDE_PATHS:-src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py}"

CODEX_PROVIDER="${CODEX_PROVIDER:-openai-codex}"
CODEX_MODEL="${CODEX_MODEL:-gpt-5.5}"
CODEX_WORKER_CAP="${CODEX_WORKER_CAP:-2}"
CODEX_TARGET_MIN_SIZE="${CODEX_TARGET_MIN_SIZE:-221}"
GLM_PROVIDER="${GLM_PROVIDER:-zai}"
GLM_MODEL="${GLM_MODEL:-glm-5.2}"
GLM_WORKER_CAP="${GLM_WORKER_CAP:-4}"
GLM_TARGET_MAX_SIZE="${GLM_TARGET_MAX_SIZE:-80}"
GLM_TARGET_MIN_FUZZY="${GLM_TARGET_MIN_FUZZY:-45}"
ENABLE_DEEPSEEK="${ENABLE_DEEPSEEK:-0}"
DEEPSEEK_PROVIDER="${DEEPSEEK_PROVIDER:-deepseek-ollama-cloud}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v3.1:671b-cloud}"
DEEPSEEK_WORKER_CAP="${DEEPSEEK_WORKER_CAP:-8}"
DEEPSEEK_TARGET_MAX_SIZE="${DEEPSEEK_TARGET_MAX_SIZE:-80}"
DEEPSEEK_TARGET_MIN_FUZZY="${DEEPSEEK_TARGET_MIN_FUZZY:-45}"
CLAUDE_PROVIDER="${CLAUDE_PROVIDER:-claude-code}"
CLAUDE_MODEL="${CLAUDE_MODEL:-sonnet}"
SONNET_WORKER_CAP="${SONNET_WORKER_CAP:-6}"
SONNET_TARGET_MIN_SIZE="${SONNET_TARGET_MIN_SIZE:-81}"
SONNET_TARGET_MAX_SIZE="${SONNET_TARGET_MAX_SIZE:-220}"
SONNET_TARGET_MIN_FUZZY="${SONNET_TARGET_MIN_FUZZY:-45}"
CLAUDE_START_DELAY_SECONDS="${CLAUDE_START_DELAY_SECONDS:-0}"
CLAUDE_START_HOUR="${CLAUDE_START_HOUR:-02}"
CLAUDE_START_MINUTE="${CLAUDE_START_MINUTE:-00}"

mkdir -p "$LOGDIR"
cd "$ROOT"

ts() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

run_json() {
  local name="$1"
  shift
  echo "[$(ts)] $*" | tee -a "$LOGDIR/overnight.log"
  "$@" >"$LOGDIR/$name.json" 2>"$LOGDIR/$name.err" || {
    local rc=$?
    echo "[$(ts)] $name failed rc=$rc; stderr tail:" | tee -a "$LOGDIR/overnight.log"
    tail -80 "$LOGDIR/$name.err" | tee -a "$LOGDIR/overnight.log"
    return "$rc"
  }
}

json_field() {
  local path="$1"
  local expr="$2"
  python3 - "$path" "$expr" <<'PY'
import json, sys
path, expr = sys.argv[1], sys.argv[2]
data = json.load(open(path))
cur = data
for part in expr.split("."):
    cur = cur[part]
print(cur)
PY
}

latest_run_id() {
  local out="$LOGDIR/status-latest.json"
  bun run server:job -- --project "$PROJECT" status >"$out" 2>"$LOGDIR/status-latest.err" || return 1
  python3 - "$out" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
run = data.get("run") or {}
print(run.get("id") or "")
PY
}

recover_previous_run() {
  local previous
  previous="$(latest_run_id || true)"
  if [[ -n "$previous" ]]; then
    run_json "recover-$previous" bun run server:job -- --project "$PROJECT" recover-claims \
      --run-id "$previous" --force --reason "overnight relaunch on refreshed DTK coverage" || true
  fi
}

init_fresh_run() {
  run_json report-run bun run server:job -- --project "$PROJECT" report-run
  run_json kg-maintain bun run server:job -- --project "$PROJECT" kg-maintain --no-run-pr-agent || true
  run_json init-run bun run server:job -- --project "$PROJECT" init-run \
    --desired-workers "$DESIRED_WORKERS" \
    --candidate-limit "$CANDIDATE_LIMIT" \
    --candidate-window "$CANDIDATE_WINDOW" \
    --goal-kind matched_code_percent \
    --goal-value 100 \
    --exclude-sources "$EXCLUDE_SOURCES"
  RUN_ID="$(json_field "$LOGDIR/init-run.json" run.id)"
  echo "$RUN_ID" >"$LOGDIR/run-id.txt"
  run_json "tick-$RUN_ID" bun run server:job -- --project "$PROJECT" tick \
    --run-id "$RUN_ID" \
    --candidate-limit "$CANDIDATE_LIMIT" \
    --queue-target-size "$QUEUE_TARGET_SIZE" \
    --candidate-window "$CANDIDATE_WINDOW" \
    --epoch-ready-queue-size "$EPOCH_READY_QUEUE_SIZE" \
    --exclude-sources "$EXCLUDE_SOURCES"
}

lane_command() {
  local provider="$1"
  local model="$2"
  local thinking="$3"
  local workers="$4"
  shift 4
  local command=(
    bun run server:job -- --project "$PROJECT"
    --provider "$provider" --model "$model" --thinking-level "$thinking"
    --agent-timeout-seconds "$AGENT_TIMEOUT_SECONDS"
    babysit --run-id "$RUN_ID"
    --max-workers "$workers"
    --idle-sleep-ms "$IDLE_SLEEP_MS"
    --worker-thinking-level "$thinking"
    --candidate-limit "$CANDIDATE_LIMIT"
    --queue-target-size "$QUEUE_TARGET_SIZE"
    --candidate-window "$CANDIDATE_WINDOW"
    --epoch-ready-queue-size "$EPOCH_READY_QUEUE_SIZE"
    --ttl-seconds "$TTL_SECONDS"
    --exclude-sources "$EXCLUDE_SOURCES"
    --epoch-exclude-paths "$EPOCH_EXCLUDE_PATHS"
    --force-recover-claims
    --max-restarts 999
    --restart-delay-ms "$RESTART_DELAY_MS"
    --restart-on-clean-exit
    "$@"
  )
  printf 'cd %q && exec' "$ROOT"
  printf ' %q' "${command[@]}"
  printf '\n'
}

ensure_tmux_session() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-session -d -s "$SESSION" -n ui "cd '$ROOT' && bun run ui:server"
  fi
}

kill_legacy_lane_windows() {
  local window
  for window in colosseum-codex colosseum-glm52 colosseum-glm52-4 colosseum-claude colosseum-deepseek colosseum-deepseek-v4 colosseum-deepseek-cloud colosseum-deepseek-cloud-tiny; do
    if tmux list-windows -t "$SESSION" -F '#W' 2>/dev/null | grep -qx "$window"; then
      tmux kill-window -t "$SESSION:$window"
      echo "[$(ts)] stopped legacy lane window $window" | tee -a "$LOGDIR/overnight.log"
    fi
  done
}

start_lane() {
  local name="$1"
  local provider="$2"
  local model="$3"
  local thinking="$4"
  local workers="$5"
  shift 5
  local window="colosseum-$name"
  local log="$LOGDIR/$name.log"
  local cmd
  cmd="$(lane_command "$provider" "$model" "$thinking" "$workers" "$@")"
  if tmux list-windows -t "$SESSION" -F '#W' 2>/dev/null | grep -qx "$window"; then
    tmux send-keys -t "$SESSION:$window" C-c
    sleep 1
    tmux send-keys -t "$SESSION:$window" "exec bash -lc $(printf '%q' "$cmd 2>&1 | tee -a '$log'")" C-m
  else
    tmux new-window -t "$SESSION" -n "$window" "bash -lc $(printf '%q' "$cmd 2>&1 | tee -a '$log'")"
  fi
  echo "[$(ts)] started $name lane: $provider/$model cap=$workers filters=$* log=$log" | tee -a "$LOGDIR/overnight.log"
}

claude_auth_ready() {
  if [[ "$CLAUDE_PROVIDER" == "claude-code" ]]; then
    command -v claude >/dev/null 2>&1 || return 1
    claude auth status 2>/dev/null | python3 -c 'import json,sys; data=json.load(sys.stdin); raise SystemExit(0 if data.get("loggedIn") else 1)'
    return $?
  fi
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] && return 0
  python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / ".pi/agent/auth.json"
try:
    data = json.loads(p.read_text())
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if "anthropic" in data else 1)
PY
}

seconds_until_claude_window() {
  python3 - "$CLAUDE_START_HOUR" "$CLAUDE_START_MINUTE" <<'PY'
from datetime import datetime, timedelta
import sys
hour, minute = int(sys.argv[1]), int(sys.argv[2])
now = datetime.now()
target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
if target <= now:
    target += timedelta(days=1)
print(max(0, int((target - now).total_seconds())))
PY
}

claude_scheduler() {
  local wait_seconds
  wait_seconds="$CLAUDE_START_DELAY_SECONDS"
  if [[ "$wait_seconds" == "auto" ]]; then
    wait_seconds="$(seconds_until_claude_window)"
    echo "[$(ts)] Sonnet scheduler waiting ${wait_seconds}s for ${CLAUDE_START_HOUR}:${CLAUDE_START_MINUTE}" | tee -a "$LOGDIR/overnight.log"
  else
    echo "[$(ts)] Sonnet scheduler start delay ${wait_seconds}s" | tee -a "$LOGDIR/overnight.log"
  fi
  if [[ "$wait_seconds" != "0" ]]; then
    sleep "$wait_seconds"
  fi
  while true; do
    if claude_auth_ready; then
      start_lane "sonnet-simple" "$CLAUDE_PROVIDER" "$CLAUDE_MODEL" low "$SONNET_WORKER_CAP" \
        --target-min-size "$SONNET_TARGET_MIN_SIZE" \
        --target-max-size "$SONNET_TARGET_MAX_SIZE" \
        --target-min-fuzzy "$SONNET_TARGET_MIN_FUZZY"
      return 0
    fi
    echo "[$(ts)] Sonnet auth not ready; retrying in 300s" | tee -a "$LOGDIR/overnight.log"
    sleep 300
  done
}

monitor_loop() {
  while true; do
    bun run server:job -- --project "$PROJECT" status >"$LOGDIR/status-current.json" 2>"$LOGDIR/status-current.err" || true
    python3 - "$LOGDIR/status-current.json" <<'PY' 2>/dev/null | tee -a "$LOGDIR/overnight.log" || true
import json, sys, datetime
data = json.load(open(sys.argv[1]))
run = data.get("run") or {}
epoch = data.get("schedulerEpoch") or {}
print(
    f"[{datetime.datetime.now().isoformat()}] "
    f"run={run.get('id')} activeClaims={data.get('activeClaims')} "
    f"schedulable={data.get('schedulableTargets')} admitted={data.get('admittedTargets')} "
    f"epochFinished={epoch.get('finished')} epochRemaining={epoch.get('remaining')} "
    f"piSessions={data.get('piSessions')} conflicts={data.get('workerOutputIntegrationConflicts')}"
)
PY
    sleep 120
  done
}

recover_previous_run
init_fresh_run
ensure_tmux_session
kill_legacy_lane_windows
start_lane "codex-hard" "$CODEX_PROVIDER" "$CODEX_MODEL" high "$CODEX_WORKER_CAP" \
  --target-min-size "$CODEX_TARGET_MIN_SIZE"
start_lane "glm52-tiny" "$GLM_PROVIDER" "$GLM_MODEL" low "$GLM_WORKER_CAP" \
  --target-max-size "$GLM_TARGET_MAX_SIZE" \
  --target-min-fuzzy "$GLM_TARGET_MIN_FUZZY"
if [[ "$ENABLE_DEEPSEEK" == "1" ]]; then
  start_lane "deepseek-cloud-tiny" "$DEEPSEEK_PROVIDER" "$DEEPSEEK_MODEL" low "$DEEPSEEK_WORKER_CAP" \
    --target-max-size "$DEEPSEEK_TARGET_MAX_SIZE" \
    --target-min-fuzzy "$DEEPSEEK_TARGET_MIN_FUZZY"
else
  echo "[$(ts)] DeepSeek lane disabled (ENABLE_DEEPSEEK=$ENABLE_DEEPSEEK)" | tee -a "$LOGDIR/overnight.log"
fi
claude_scheduler &
monitor_loop
