#!/usr/bin/env python3
"""Dump the tool-local mwcc_debug pcdump section for one function."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from toolpack_runtime import clamp_int, print_json, resolve_repo_root, run_tool_script


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target project checkout root.")
    parser.add_argument("--function", required=True, help="Function symbol to dump.")
    parser.add_argument("--runner", choices=("auto", "wibo", "wine"), default="auto", help="Execution backend for mwcc_debug.")
    parser.add_argument("--timeout-seconds", type=int, default=180, help="Maximum runtime for the tool-local command.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    payload = run_tool_script(
        "mwcc_dump.py",
        ["--runner", args.runner, args.function],
        repo_root=repo_root,
        operation="mwcc_debug:dump_function",
        timeout_seconds=clamp_int(args.timeout_seconds, default=180, minimum=10, maximum=900),
    )
    payload.update({"function": args.function, "runner": args.runner})
    print_json(payload)


if __name__ == "__main__":
    main()
