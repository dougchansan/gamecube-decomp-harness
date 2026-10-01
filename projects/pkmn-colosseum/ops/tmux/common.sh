#!/usr/bin/env bash
# Portable adaptation of Colosseum's tools/decomp_work/tmux_control helpers.
CONTROL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$CONTROL_DIR/../../../.." && pwd)"
TMUX_BIN="${TMUX_BIN:-tmux}"
TMUX_SESSION="${TMUX_SESSION:-decomp}"
TMUX_WINDOW="${TMUX_WINDOW:-pipeline}"
STATE_DIR="${TMUX_STATE_DIR:-$HARNESS_ROOT/.decomp-orchestrator-state/tmux/$TMUX_SESSION/$TMUX_WINDOW}"
ROLES=(claude codex local status watcher)

die() { echo "ERROR: $*" >&2; exit 1; }
assert_session() {
  "$TMUX_BIN" has-session -t "=$TMUX_SESSION" 2>/dev/null || die "Session missing: $TMUX_SESSION"
}
log_event() {
  mkdir -p "$STATE_DIR"
  # Record actions, never prompt text or provider credentials.
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$STATE_DIR/control.log"
}
resolve_pane_target() {
  local role="$1" target found=false
  for name in "${ROLES[@]}"; do
    if [ "$name" = "$role" ]; then found=true; fi
  done
  $found || die "Unknown role: $role"
  [ -f "$STATE_DIR/$role.pane" ] || die "No registered $role pane; bootstrap first"
  read -r target < "$STATE_DIR/$role.pane"
  [[ "$target" =~ ^%[0-9]+$ ]] || die "Invalid pane ID for $role"
  # Fail closed if a pane was removed, replaced, or moved into another window.
  "$TMUX_BIN" list-panes -t "=$TMUX_SESSION:=$TMUX_WINDOW" -F '#{pane_id}' |
    grep -Fxq "$target" || die "Stale $role registry; inspect the session"
  printf '%s\n' "$target"
}
safe_send_text() {
  "$TMUX_BIN" send-keys -t "$1" -l -- "$2"
}
