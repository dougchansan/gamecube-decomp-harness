# Local Claude, Codex and model coordination

The Colosseum campaign developed a direct terminal workflow alongside the Pi
orchestrator: Claude coordinated scoped tasks, Codex researched and implemented
source candidates, and local-model workers proposed drafts and repairs. tmux
kept their terminals visible; file-based work packets and result reports carried
the durable handoff. The compiler and objdiff decided which proposals survived.

`projects/pkmn-colosseum/ops/tmux/` adapts the local checkout's
`tools/decomp_work/tmux_control/{capture_pane,send_text,send_enter,send_keys,resolve_pane}.sh`
and its bootstrap pattern. The local bundle was incomplete (`common.sh` was
missing) and its config/registry disagreed on pane roles. This version supplies
the shared implementation, replaces machine paths with configuration, and uses
explicit stable pane IDs without an index fallback. It needs Bash and tmux,
with no Bun, dashboard or provider dependency.

## Start a terminal workspace

Use Linux/macOS or WSL with tmux installed. Run every helper in the same host
environment and with the same settings. On Windows, WSL paths use `/mnt/c/...`;
native PowerShell does not run these Bash scripts directly. A native Windows
tmux-compatible binary can be selected with `TMUX_BIN`, but is unverified.

```bash
export REPO_ROOT=/path/to/pkmn-colosseum
export TMUX_SESSION=decomp
export TMUX_WINDOW=pipeline
bash projects/pkmn-colosseum/ops/tmux/control.sh bootstrap
bash projects/pkmn-colosseum/ops/tmux/control.sh list
tmux attach -t decomp
```

The five panes are `claude`, `codex`, `local`, `status`, and `watcher`. Bootstrap
opens shells and records IDs; it does not launch model requests. Start your
already configured Claude/Codex CLI in its pane. Start your existing local-model
worker or Ollama client in `local`, using your selected model and endpoint.
Use a separate assigned worktree for each editing agent, and change each agent's
shell to that worktree before launching it. Status and watcher shells can inspect
work packets, result files and build reports using your existing commands.

```bash
bash projects/pkmn-colosseum/ops/tmux/control.sh capture codex 80
bash projects/pkmn-colosseum/ops/tmux/control.sh text codex 'Read the assigned work packet and report a candidate.'
# Inspect the TUI and confirm its input state before submitting:
bash projects/pkmn-colosseum/ops/tmux/control.sh enter codex
# When already ready to submit, capture + literal text + Enter:
bash projects/pkmn-colosseum/ops/tmux/control.sh send local 'Read the assigned packet; write a proposal and validation evidence.'
```

`send` displays a capture but cannot determine whether a TUI is ready. Text is
literal (`Enter` or `C-c` inside a prompt is not a key command). `keys` explicitly
sends tmux keys, such as `keys codex C-c`; use it only when interrupting that
agent is intended. Captures can contain sensitive terminal output. Event logs
record action names without prompt bodies.

Registry files and logs live under ignored
`.decomp-orchestrator-state/tmux/<session>/<window>/`. `TMUX_STATE_DIR` overrides
that location. Deleted or moved panes fail closed. Bootstrap refuses existing
sessions; it never remaps a live session by pane index or kills its windows.
If the layout was interrupted or changed, inspect it and create a fresh named
session once existing work has been handed off.

## Task and handoff contract

Assign one function or small residual object set, source/header ownership,
baseline commit, compiler flags, current score, and rejection rules. All agents
must read the checkout's AGENTS.md. Store a work packet and a result containing
the commit/candidate path, commands run, exact score, sibling/data/relocation
effects, and remaining blockers. When Claude hands coordination to Codex or vice
versa, include active owners, worktrees, outstanding tasks and the last verified
report; receiving ownership does not imply restarting other workers.

Copy [the example work packet](../../projects/pkmn-colosseum/ops/tmux/work-packet.example.md)
into ignored runtime state, then fill its assignment, result and takeover fields.

The historical JSON task/claim scripts were read-modify-write without a shared
lock. They are not a safe concurrent scheduler. For Pi workers use the harness's
existing SQLite leases and file locks. For direct CLI lanes, have one coordinator
assign disjoint worktrees and track ownership in packets; tmux controls do not
claim tasks or synchronize source edits. Do not let direct lanes and Pi workers
edit the same files or share mutable compiler/build directories.

Accept local-model output through the same source-fidelity gate as other output.
In Colosseum, forbid `.inc` edits, assembly wrappers and compiler-shaping tricks,
subject to the checkout's existing narrow SDK policy. Validate survivors in an
isolated integration worktree, sequentially:

```bash
python configure.py --no-progress
ninja all_source build/GC6E01/report.json
ninja
python configure.py progress
```

Record exact-source gains separately from newly linked objects. An isolated
score-zero proposal is not an integrated win. Rebuild the report explicitly;
plain `ninja` can leave stale scores. Check semantics, sibling regressions,
data, relocations and the retail link before integration.

Historical overnight scripts also contained fixed pane IDs, approval-bypass
launch flags, automatic restarts/commits and retired accelerator endpoints.
Those are not part of this portable control layer. Configure active local
providers yourself; importing the workflow does not restart an old farm.

## Verification

```bash
bash projects/pkmn-colosseum/ops/tmux/test_control.sh
```

This uses a temporary directory and private tmux socket, exercises real panes,
and kills only its test server. It covers bootstrap ownership, literal text,
submission, role validation, index changes, stale IDs and prompt-log privacy.
Live authenticated agents and native Windows tmux compatibility are separate
operator checks.
