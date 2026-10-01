#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
REPO_ROOT="${REPO_ROOT:?Set REPO_ROOT to the decomp checkout or assigned worktree}"
[ -d "$REPO_ROOT" ] || die "REPO_ROOT is not a directory"
[[ "$TMUX_SESSION" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Use letters, digits, underscore or hyphen in session names"
[[ "$TMUX_WINDOW" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Use letters, digits, underscore or hyphen in window names"
if "$TMUX_BIN" has-session -t "=$TMUX_SESSION" 2>/dev/null; then
  die "Session already exists; inspect it instead of overwriting pane ownership"
fi
mkdir -p "$STATE_DIR"
pane="$("$TMUX_BIN" new-session -d -s "$TMUX_SESSION" -n "$TMUX_WINDOW" -c "$REPO_ROOT" -x 160 -y 60 -P -F '#{pane_id}')"
printf '%s\n' "$pane" > "$STATE_DIR/claude.pane"
for role in codex local status watcher; do
  pane="$("$TMUX_BIN" split-window -d -t "=$TMUX_SESSION:=$TMUX_WINDOW" -c "$REPO_ROOT" -P -F '#{pane_id}')"
  printf '%s\n' "$pane" > "$STATE_DIR/$role.pane"
  "$TMUX_BIN" select-layout -t "=$TMUX_SESSION:=$TMUX_WINDOW" tiled >/dev/null
done
for role in "${ROLES[@]}"; do
  "$TMUX_BIN" select-pane -t "$(resolve_pane_target "$role")" -T "$role"
done
log_event bootstrap
echo "Created $TMUX_SESSION:$TMUX_WINDOW; launch agents manually in their assigned panes."
