#!/usr/bin/env python3
"""Report readiness for the m2c decompilation harness bridge."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from harness import harness_root, print_json, resolve_repo_root, tool_bridge_status


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    payload = tool_bridge_status(
        tool="m2c_decomp",
        scripts=("decomp.py",),
        repo_root=repo_root,
        required_paths=("build/GALE01/obj", "build/GALE01/asm", "tools/m2ctx/m2ctx.py"),
        optional_paths=("build/ctx.c",),
        message="m2c bridge is ready when generated objects/asm and m2ctx.py are present.",
    )
    payload["m2c_root"] = str(harness_root() / "m2c")
    payload["m2c_license"] = "GPL-3.0"
    print_json(payload)


if __name__ == "__main__":
    main()
