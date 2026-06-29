#!/usr/bin/env python3
"""Preview a C ItemStateTable definition generated from an asm label."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from toolpack_runtime import import_tool_module, print_json, resolve_repo_root


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target project checkout root.")
    parser.add_argument("--label", required=True, help="ItemStateTable data label, for example it_803F93A8.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    payload: dict[str, Any] = {"operation": "item_state_table:preview", "repo_root": str(repo_root), "label": args.label}
    try:
        gen = import_tool_module("gen_item_state_table", repo_root)
        source_file = gen.find_source_file(args.label)
        asm_file = gen.find_asm_file(source_file)
        entries = gen.parse_asm_table(asm_file, args.label)
        c_code = gen.format_table(args.label, entries)
        source_text = source_file.read_text(encoding="utf-8", errors="replace")
        already_defined = re.search(rf"ItemStateTable\s+{re.escape(args.label)}\s*\[\s*\]\s*=", source_text) is not None
        insert_position = gen.find_insert_position(source_text, args.label)
        payload.update(
            {
                "status": "ok",
                "source_file": str(source_file),
                "asm_file": str(asm_file),
                "entry_count": len(entries),
                "already_defined": already_defined,
                "insert_position": insert_position,
                "c_code": c_code,
            }
        )
    except Exception as error:  # noqa: BLE001 - API boundary should report every preview failure.
        payload.update({"status": "tool_impl_error", "error": str(error)})
    print_json(payload)


if __name__ == "__main__":
    main()
