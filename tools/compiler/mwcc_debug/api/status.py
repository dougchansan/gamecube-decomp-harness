#!/usr/bin/env python3
"""Report MWCC debug suite readiness and generated evidence status."""

import argparse
import json
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from search_index import status_payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Report MWCC debug tool status.")
    parser.add_argument("--repo-root", help="Target Melee checkout root used to check cache freshness.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    tool_root = Path(__file__).resolve().parents[1]
    payload = status_payload("mwcc_debug", tool_root, "No MWCC debug cache has been generated yet.", args.repo_root)
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
