#!/usr/bin/env bash
set -euo pipefail
# Real tmux test on a private socket; never targets a user's agent session.
HERE="$(cd "$(dirname "$0")" && pwd)"
scratch="$(mktemp -d)"
export TMUX_SESSION=harness-test TMUX_WINDOW=pipeline
export TMUX_STATE_DIR="$scratch/state" REPO_ROOT="$scratch"
real_tmux="$(command -v tmux)"
export TMUX_BIN="$scratch/tmux"
printf '#!/usr/bin/env bash\nexec "%s" -L "harness-test-%s" "$@"\n' "$real_tmux" "$$" > "$TMUX_BIN"
chmod +x "$TMUX_BIN"
trap '"$TMUX_BIN" kill-server 2>/dev/null || true; rm -rf -- "$scratch"' EXIT
control() { bash "$HERE/control.sh" "$@"; }
control bootstrap
test "$(control list | wc -l)" -eq 5
if control bootstrap >/dev/null 2>&1; then echo 'bootstrap overwrote session'; exit 1; fi
if control capture unknown >/dev/null 2>&1; then echo 'unknown role accepted'; exit 1; fi
# Literal key names and shell metacharacters stay text until Enter is explicit.
control text local 'Enter C-c ; $(touch injected)'
sleep 0.5
control capture local all | grep -Fq 'Enter C-c ; $(touch injected)'
test ! -e "$scratch/injected"
! grep -Fq injected "$TMUX_STATE_DIR/control.log"
control keys local C-u
control send local 'printf "HARNESS_OK\n"'
sleep 0.5
control capture local all | grep -Fxq HARNESS_OK
# Pane indices can change without retargeting semantic roles.
target="$(bash "$HERE/resolve_pane.sh" codex)"
"$TMUX_BIN" set-window-option -t "$TMUX_SESSION:$TMUX_WINDOW" pane-base-index 7
test "$(bash "$HERE/resolve_pane.sh" codex)" = "$target"
"$TMUX_BIN" kill-pane -t "$target"
if control text codex wrong >/dev/null 2>&1; then echo 'stale pane accepted'; exit 1; fi
echo 'PASS: isolated tmux bootstrap, role routing, literal text, submission, index changes, stale IDs and log privacy'
