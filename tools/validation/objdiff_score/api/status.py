#!/usr/bin/env python3
"""Report readiness for objdiff candidate scoring."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from harness import print_json, resolve_repo_root, tool_bridge_status


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    print_json(
        tool_bridge_status(
            tool="objdiff_score",
            scripts=("objdiff_path.py", "ninja_compile.py"),
            repo_root=repo_root,
            required_paths=("build/GALE01/report.json", "build/GALE01/obj"),
            optional_paths=("objdiff.json",),
            message="objdiff scoring is ready when target objects and objdiff-cli are available.",
        )
    )


if __name__ == "__main__":
    main()
