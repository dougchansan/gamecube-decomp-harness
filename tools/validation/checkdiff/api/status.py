#!/usr/bin/env python3
"""Report readiness for the checkdiff/direct-compile harness bridge."""

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
            tool="checkdiff",
            scripts=("checkdiff.py", "ninja_compile.py", "fix_includes.py", "objdiff_path.py"),
            repo_root=repo_root,
            required_paths=("build/GALE01/report.json", "build.ninja"),
            optional_paths=("build/GALE01/obj", "build/tools/wibo"),
            message="Checkdiff bridge is ready when harness scripts and Melee build metadata are present.",
        )
    )


if __name__ == "__main__":
    main()
