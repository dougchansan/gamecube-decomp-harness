#!/usr/bin/env bash
set -euo pipefail

HARNESS_ROOT="${HARNESS_ROOT:-/Users/douglaswhittingham/gamecube-decomp-harness}"
PROJECT="${PROJECT:-pkmn-colosseum}"
SESSION="${SESSION:-gamecube-harness}"
LOG_DIR="${LOG_DIR:-$HARNESS_ROOT/.decomp-orchestrator-state}"
RUN_ID="${RUN_ID:-}"
RECOVER_OLD_RUN="${RECOVER_OLD_RUN:-0}"

DESIRED_WORKERS="${DESIRED_WORKERS:-6}"
CANDIDATE_LIMIT="${CANDIDATE_LIMIT:-24}"
QUEUE_TARGET_SIZE="${QUEUE_TARGET_SIZE:-24}"
CANDIDATE_WINDOW="${CANDIDATE_WINDOW:-192}"
AGENT_TIMEOUT_SECONDS="${AGENT_TIMEOUT_SECONDS:-14400}"
TTL_SECONDS="${TTL_SECONDS:-7200}"
IDLE_SLEEP_MS="${IDLE_SLEEP_MS:-5000}"
EXCLUDE_SOURCES="${EXCLUDE_SOURCES:-src/game/gs_field_world.c,src/game/gs_task.c,src/dolphin/dvd/DVDFs.c}"
EPOCH_EXCLUDE_PATHS="${EPOCH_EXCLUDE_PATHS:-src/game/gs_task.c,tools/decomp_work/benchmark/bench_opencode.py,tools/decomp_work/overnight/queue_attack.py}"
ENABLE_DEEPSEEK="${ENABLE_DEEPSEEK:-0}"
CODEX_WORKER_CAP="${CODEX_WORKER_CAP:-2}"
CODEX_TARGET_MIN_SIZE="${CODEX_TARGET_MIN_SIZE:-221}"
GLM_WORKER_CAP="${GLM_WORKER_CAP:-4}"
GLM_TARGET_MAX_SIZE="${GLM_TARGET_MAX_SIZE:-80}"
GLM_TARGET_MIN_FUZZY="${GLM_TARGET_MIN_FUZZY:-45}"
SONNET_WORKERS="${SONNET_WORKERS:-2}"
SONNET_WORKER_CAP="${SONNET_WORKER_CAP:-$((GLM_WORKER_CAP + SONNET_WORKERS))}"
SONNET_TARGET_MIN_SIZE="${SONNET_TARGET_MIN_SIZE:-81}"
SONNET_TARGET_MAX_SIZE="${SONNET_TARGET_MAX_SIZE:-220}"
SONNET_TARGET_MIN_FUZZY="${SONNET_TARGET_MIN_FUZZY:-45}"
DEEPSEEK_WORKER_CAP="${DEEPSEEK_WORKER_CAP:-6}"
DEEPSEEK_PROVIDER="${DEEPSEEK_PROVIDER:-deepseek-ollama-cloud}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v3.1:671b-cloud}"
DEEPSEEK_TARGET_MAX_SIZE="${DEEPSEEK_TARGET_MAX_SIZE:-80}"
DEEPSEEK_TARGET_MIN_FUZZY="${DEEPSEEK_TARGET_MIN_FUZZY:-45}"

cd "$HARNESS_ROOT"
mkdir -p "$LOG_DIR"

job() {
  bun apps/server/src/job-runner.ts --project "$PROJECT" "$@"
}

latest_run_id() {
  job status | python3 -c 'import json,sys
text=sys.stdin.read()
start=text.find("{")
if start < 0:
    raise SystemExit(1)
data=json.loads(text[start:])
run=data.get("run") or {}
print(run.get("id") or "")'
}

parse_init_run_id() {
  python3 -c 'import json,sys
text=sys.stdin.read()
start=text.find("{")
if start < 0:
    raise SystemExit("init-run did not print JSON")
data=json.loads(text[start:])
print(data["run"]["id"])'
}

if [ -z "$RUN_ID" ]; then
  old_run="$(latest_run_id || true)"
  if [ "$RECOVER_OLD_RUN" = "1" ] && [ -n "$old_run" ]; then
    job recover-claims --run-id "$old_run" --force --reason "overnight launcher recovered stale claims before fresh run" \
      > "$LOG_DIR/colosseum-recover-$old_run.log" 2>&1 || true
  fi
  RUN_ID="$(
    job init-run \
      --goal-kind matched_code_percent \
      --goal-value 100 \
      --desired-workers "$DESIRED_WORKERS" \
      --candidate-limit "$CANDIDATE_LIMIT" \
      --candidate-window "$CANDIDATE_WINDOW" \
      --exclude-sources "$EXCLUDE_SOURCES" | parse_init_run_id
  )"
fi

echo "$RUN_ID" > "$LOG_DIR/colosseum-overnight.run-id"
echo "RUN_ID=$RUN_ID"

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -c "$HARNESS_ROOT"
fi

replace_window() {
  local name="$1"
  local command="$2"
  if tmux list-windows -t "$SESSION" -F '#W' | grep -Fxq "$name"; then
    tmux kill-window -t "$SESSION:$name"
  fi
  tmux new-window -t "$SESSION" -n "$name" -c "$HARNESS_ROOT" "$command"
}

kill_legacy_lane_windows() {
  local name
  for name in colosseum-codex colosseum-glm52 colosseum-glm52-4 colosseum-claude colosseum-deepseek colosseum-deepseek-v4 colosseum-deepseek-cloud; do
    if tmux list-windows -t "$SESSION" -F '#W' | grep -Fxq "$name"; then
      tmux kill-window -t "$SESSION:$name"
    fi
  done
}

babysit_loop() {
  local lane="$1"
  local provider="$2"
  local model="$3"
  local thinking="$4"
  local workers="$5"
  local worker_thinking="$6"
  shift 6
  local log_file="$LOG_DIR/$lane.log"
  local extra_args=""
  local quoted
  for arg in "$@"; do
    printf -v quoted '%q' "$arg"
    extra_args+=" $quoted"
  done

  cat <<EOF
set -euo pipefail
cd "$HARNESS_ROOT"
mkdir -p "$LOG_DIR"
echo "[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting $lane provider=$provider model=$model run=$RUN_ID" >> "$log_file"
while true; do
  bun apps/server/src/job-runner.ts --project "$PROJECT" \\
    --provider "$provider" --model "$model" --thinking-level "$thinking" \\
    --agent-timeout-seconds "$AGENT_TIMEOUT_SECONDS" \\
    babysit --run-id "$RUN_ID" \\
    --max-workers "$workers" \\
    --idle-sleep-ms "$IDLE_SLEEP_MS" \\
    --worker-thinking-level "$worker_thinking" \\
    --candidate-limit "$CANDIDATE_LIMIT" \\
    --queue-target-size "$QUEUE_TARGET_SIZE" \\
    --candidate-window "$CANDIDATE_WINDOW" \\
    --epoch-ready-queue-size "$QUEUE_TARGET_SIZE" \\
    --ttl-seconds "$TTL_SECONDS" \\
    --exclude-sources "$EXCLUDE_SOURCES" \\
    --epoch-exclude-paths "$EPOCH_EXCLUDE_PATHS" \\
    --force-recover-claims$extra_args >> "$log_file" 2>&1
  rc=\$?
  echo "[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] $lane exited rc=\$rc; restarting in 10s" >> "$log_file"
  sleep 10
done
EOF
}

claude_watcher() {
  cat <<EOF
set -euo pipefail
cd "$HARNESS_ROOT"
RUN_ID="$RUN_ID" \\
  LOG_DIR="$LOG_DIR" \\
  AGENT_TIMEOUT_SECONDS="$AGENT_TIMEOUT_SECONDS" \\
  TTL_SECONDS="$TTL_SECONDS" \\
  IDLE_SLEEP_MS="$IDLE_SLEEP_MS" \\
  EXCLUDE_SOURCES="$EXCLUDE_SOURCES" \\
  EPOCH_EXCLUDE_PATHS="$EPOCH_EXCLUDE_PATHS" \\
  CLAUDE_WORKERS="\${CLAUDE_WORKERS:-$SONNET_WORKERS}" \\
  CLAUDE_MAX_WORKERS="\${CLAUDE_MAX_WORKERS:-$SONNET_WORKER_CAP}" \\
  CLAUDE_THINKING="\${CLAUDE_THINKING:-low}" \\
  CLAUDE_TARGET_MIN_SIZE="\${CLAUDE_TARGET_MIN_SIZE:-$SONNET_TARGET_MIN_SIZE}" \\
  CLAUDE_TARGET_MAX_SIZE="\${CLAUDE_TARGET_MAX_SIZE:-$SONNET_TARGET_MAX_SIZE}" \\
  CLAUDE_TARGET_MIN_FUZZY="\${CLAUDE_TARGET_MIN_FUZZY:-$SONNET_TARGET_MIN_FUZZY}" \\
  scripts/colosseum_claude_2am_watch.sh
EOF
}

kill_legacy_lane_windows
replace_window "colosseum-codex-hard" "$(babysit_loop colosseum-codex-hard openai-codex gpt-5.5 medium "$CODEX_WORKER_CAP" low --target-min-size "$CODEX_TARGET_MIN_SIZE")"
replace_window "colosseum-glm52-tiny" "$(babysit_loop colosseum-glm52-tiny zai glm-5.2 low "$GLM_WORKER_CAP" low --target-max-size "$GLM_TARGET_MAX_SIZE" --target-min-fuzzy "$GLM_TARGET_MIN_FUZZY")"
if [ "$ENABLE_DEEPSEEK" = "1" ]; then
  replace_window "colosseum-deepseek-cloud" "$(babysit_loop colosseum-deepseek-cloud "$DEEPSEEK_PROVIDER" "$DEEPSEEK_MODEL" low "$DEEPSEEK_WORKER_CAP" low --target-max-size "$DEEPSEEK_TARGET_MAX_SIZE" --target-min-fuzzy "$DEEPSEEK_TARGET_MIN_FUZZY")"
else
  for name in colosseum-deepseek-v4 colosseum-deepseek-cloud; do
    if tmux list-windows -t "$SESSION" -F '#W' | grep -Fxq "$name"; then
      tmux kill-window -t "$SESSION:$name"
    fi
  done
fi
replace_window "colosseum-claude-2am" "$(claude_watcher)"

job status
