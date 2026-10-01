#!/usr/bin/env bash
set -euo pipefail
# capture_pane.sh <name> [lines] — Capture visible pane contents.
# Defaults to last 50 lines. Use "all" for full scrollback.

source "$(cd "$(dirname "$0")" && pwd)/common.sh"
assert_session

name="${1:?Usage: capture_pane.sh <name> [lines|all]}"
lines="${2:-50}"
target="$(resolve_pane_target "$name")"

if [ "$lines" = "all" ]; then
  "$TMUX_BIN" capture-pane -t "$target" -p -J -S -
else
  "$TMUX_BIN" capture-pane -t "$target" -p -J -S "-${lines}"
fi
