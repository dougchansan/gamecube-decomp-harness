#!/usr/bin/env bash
set -euo pipefail
# send_enter.sh <name> — Send Enter key to a pane.

source "$(cd "$(dirname "$0")" && pwd)/common.sh"
assert_session

name="${1:?Usage: send_enter.sh <name>}"
target="$(resolve_pane_target "$name")"

"$TMUX_BIN" send-keys -t "$target" Enter
log_event "send_enter" "Sent Enter to $name"
