#!/usr/bin/env bash
set -euo pipefail
# resolve_pane.sh <name> — Print the tmux target for a semantic pane name.

source "$(cd "$(dirname "$0")" && pwd)/common.sh"
resolve_pane_target "${1:?Usage: resolve_pane.sh <claude|codex|status|watcher|pokedex>}"
