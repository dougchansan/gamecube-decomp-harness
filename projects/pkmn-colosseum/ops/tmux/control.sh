#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
action="${1:-help}"
shift || true
case "$action" in
  bootstrap) bash "$CONTROL_DIR/bootstrap_layout.sh" "$@" ;;
  list)
    assert_session
    for role in "${ROLES[@]}"; do printf '%s %s\n' "$role" "$(resolve_pane_target "$role")"; done
    ;;
  capture) bash "$CONTROL_DIR/capture_pane.sh" "$@" ;;
  text) bash "$CONTROL_DIR/send_text.sh" "$@" ;;
  enter) bash "$CONTROL_DIR/send_enter.sh" "$@" ;;
  keys) bash "$CONTROL_DIR/send_keys.sh" "$@" ;;
  send)
    role="${1:?Usage: control.sh send <role> <prompt>}"
    prompt="${2:?Usage: control.sh send <role> <prompt>}"
    # Rendered capture is evidence for the operator, not an idle detector.
    bash "$CONTROL_DIR/capture_pane.sh" "$role" 50
    bash "$CONTROL_DIR/send_text.sh" "$role" "$prompt"
    sleep 0.3
    bash "$CONTROL_DIR/send_enter.sh" "$role"
    ;;
  help) echo 'Usage: control.sh bootstrap|list|capture ROLE [LINES|all]|text ROLE TEXT|enter ROLE|keys ROLE KEY...|send ROLE PROMPT' ;;
  *) die "Unknown action: $action" ;;
esac
