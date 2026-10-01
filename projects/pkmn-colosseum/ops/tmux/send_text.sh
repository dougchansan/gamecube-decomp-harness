#!/usr/bin/env bash
set -euo pipefail
# send_text.sh <name> "<text>" — Send literal text to a pane (no Enter).

source "$(cd "$(dirname "$0")" && pwd)/common.sh"
assert_session

name="${1:?Usage: send_text.sh <name> \"<text>\"}"
shift
text="$*"
target="$(resolve_pane_target "$name")"

safe_send_text "$target" "$text"
log_event "send_text"
echo "Sent text to $name"
