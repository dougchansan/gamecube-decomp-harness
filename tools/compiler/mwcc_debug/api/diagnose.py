#!/usr/bin/env python3
"""Run a mode-oriented tool-local MWCC diagnosis for one function."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from melee_tooling import clamp_int, print_json, resolve_repo_root, run_tool_script


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    parser.add_argument("--mode", choices=("stack", "regflow", "inlines", "raw"), required=True, help="Diagnosis mode.")
    parser.add_argument("--function", required=True, help="Function symbol to diagnose.")
    parser.add_argument("--runner", choices=("auto", "wibo", "wine"), default="auto", help="Execution backend for mwcc_debug.")
    parser.add_argument("--show-lines", action="store_true", help="Include detailed mismatch instruction windows where the mode supports it.")
    parser.add_argument("--show-mwcc", action="store_true", help="Include raw stack-slot facts for stack mode.")
    parser.add_argument("--timeout-seconds", type=int, default=240, help="Maximum runtime for the tool-local command.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    command_args = [args.mode, "--runner", args.runner]
    if args.show_lines and args.mode in {"stack", "regflow"}:
        command_args.append("--show-lines")
    if args.show_mwcc and args.mode == "stack":
        command_args.append("--show-mwcc")
    command_args.append(args.function)

    repo_root = resolve_repo_root(args.repo_root)
    payload = run_tool_script(
        "mwcc_diagnose.py",
        command_args,
        repo_root=repo_root,
        operation=f"mwcc_debug:diagnose:{args.mode}",
        timeout_seconds=clamp_int(args.timeout_seconds, default=240, minimum=10, maximum=1200),
    )
    payload.update(
        {
            "function": args.function,
            "mode": args.mode,
            "runner": args.runner,
            "show_lines": bool(args.show_lines),
            "show_mwcc": bool(args.show_mwcc and args.mode == "stack"),
        }
    )
    print_json(payload)


if __name__ == "__main__":
    main()
