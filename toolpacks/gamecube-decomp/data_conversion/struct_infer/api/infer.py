#!/usr/bin/env python3
"""Infer a candidate struct layout from one function and pointer register."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from toolpack_runtime import clamp_int, print_json, resolve_repo_root, run_tool_script


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target project checkout root.")
    parser.add_argument("--function", required=True, help="Function symbol to inspect in assembly.")
    parser.add_argument("--ptr-reg", required=True, help="Pointer register to track, such as r3 or r29.")
    parser.add_argument("--name", help="Struct name for rendered output.")
    parser.add_argument("--verbose", action="store_true", help="Include every observed access in stderr.")
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Maximum runtime for inference.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    command_args = [args.function, args.ptr_reg]
    if args.name:
        command_args.extend(["--name", args.name])
    if args.verbose:
        command_args.append("--verbose")

    repo_root = resolve_repo_root(args.repo_root)
    payload = run_tool_script(
        "infer_struct.py",
        command_args,
        repo_root=repo_root,
        operation="struct_infer:infer",
        timeout_seconds=clamp_int(args.timeout_seconds, default=60, minimum=5, maximum=300),
    )
    payload.update({"function": args.function, "ptr_reg": args.ptr_reg, "name": args.name, "verbose": bool(args.verbose)})
    print_json(payload)


if __name__ == "__main__":
    main()
