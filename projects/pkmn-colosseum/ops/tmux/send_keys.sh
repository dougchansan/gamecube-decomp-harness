#!/usr/bin/env bash
set -euo pipefail
# send_keys.sh <name> <key...> — Send raw tmux key names to a pane.
# Example: ./send_keys.sh codex C-c
# Example: ./send_keys.sh status Up Enter

source "$(cd "$(dirname "$0")" && pwd)/common.sh"
assert_session

name="${1:?Usage: send_keys.sh <name> <key...>}"
shift
keys=("$@")
target="$(resolve_pane_target "$name")"

"$TMUX_BIN" send-keys -t "$target" "${keys[@]}"
log_event "send_keys" "Sent keys to $name: ${keys[*]}"
echo "Sent keys to $name: ${keys[*]}"
