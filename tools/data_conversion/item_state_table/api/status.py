#!/usr/bin/env python3
"""Report readiness for ItemStateTable conversion preview."""

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
            tool="item_state_table",
            scripts=("gen_item_state_table.py",),
            repo_root=repo_root,
            required_paths=("config/GALE01/splits.txt", "build/GALE01/asm", "src"),
            optional_paths=("build/GALE01/report.json",),
            message="ItemStateTable preview is ready when splits, asm, and source files are present.",
        )
    )


if __name__ == "__main__":
    main()
