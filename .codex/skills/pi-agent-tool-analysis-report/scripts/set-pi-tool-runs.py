#!/usr/bin/env python3
"""Update scripts/analyze-pi-agent-tools.py RUNS mapping safely."""

import argparse
import re
import sys
from pathlib import Path


RUNS_RE = re.compile(r"RUNS\s*=\s*\{\s*.*?\n\}", re.S)
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{6,}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Set run1/run2 mapping in scripts/analyze-pi-agent-tools.py."
    )
    parser.add_argument("--run1", required=True, help="Baseline/control/prior run ID.")
    parser.add_argument("--run2", required=True, help="Experiment/latest run ID.")
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root containing scripts/analyze-pi-agent-tools.py.",
    )
    parser.add_argument(
        "--file",
        default="scripts/analyze-pi-agent-tools.py",
        help="Analyzer path relative to repo root.",
    )
    return parser.parse_args()


def validate_run_id(value: str, label: str) -> None:
    if not RUN_ID_RE.match(value):
        raise SystemExit(f"{label} does not look like a run ID: {value!r}")


def main() -> int:
    args = parse_args()
    validate_run_id(args.run1, "--run1")
    validate_run_id(args.run2, "--run2")
    if args.run1 == args.run2:
        raise SystemExit("--run1 and --run2 must be different")

    path = (Path(args.repo_root) / args.file).resolve()
    text = path.read_text(encoding="utf-8")
    replacement = (
        "RUNS = {\n"
        f'    "{args.run1}": "run1",\n'
        f'    "{args.run2}": "run2",\n'
        "}"
    )
    updated, count = RUNS_RE.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"Could not find exactly one RUNS dict in {path}")
    if updated == text:
        print(f"{path}: RUNS already up to date")
        return 0
    path.write_text(updated, encoding="utf-8")
    print(f"{path}: set run1={args.run1} run2={args.run2}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
