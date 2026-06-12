#!/usr/bin/env python3
"""Report readiness for the tool-local clang type oracle."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from melee_tooling import import_tool_module, print_json, resolve_repo_root, tool_impl_status


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    payload = tool_impl_status(
        tool="type_oracle",
        scripts=("type_oracle.py",),
        repo_root=repo_root,
        required_paths=("compile_commands.json",),
        optional_paths=("src",),
        message="Type oracle is ready when libclang is importable and compile_commands.json covers the source file.",
    )
    try:
        type_oracle = import_tool_module("type_oracle", repo_root)
        payload["libclang_available"] = bool(type_oracle.available())
    except Exception as error:  # noqa: BLE001 - API boundary should report readiness failures.
        payload["libclang_available"] = False
        payload["libclang_error"] = str(error)
    if not payload["libclang_available"]:
        payload["status"] = "missing_prerequisite"
        payload["missing_required_paths"].append("python:libclang")
    print_json(payload)


if __name__ == "__main__":
    main()
