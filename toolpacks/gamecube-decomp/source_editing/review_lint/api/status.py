#!/usr/bin/env python3
"""Report readiness for native decomp review lint scans."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from toolpack_runtime import print_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    parser.parse_args()
    print_json(
        {
            "tool": "review_lint",
            "status": "ok",
            "operation_mode": "native_api_v1",
            "rules": ["type_erasing_casts", "m2c_residue", "inline_pointer_vars"],
            "message": "Review lint is available for files or source snippets.",
        }
    )


if __name__ == "__main__":
    main()
