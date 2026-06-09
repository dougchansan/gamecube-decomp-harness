#!/usr/bin/env python3
"""Directly compile one function's translation unit with the exact MWCC rule."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from harness import captured_stdio, import_harness_module, print_json, resolve_repo_root


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--function", help="Function symbol whose owning translation unit should compile.")
    group.add_argument("--unit", help="Unit path without src/ prefix or .c suffix, for example melee/it/items/itkinoko.")
    parser.add_argument("--keep-object", action="store_true", help="Keep the temporary object alive after the API exits.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    payload: dict[str, Any] = {
        "operation": "checkdiff:direct_compile",
        "repo_root": str(repo_root),
        "function": args.function,
        "unit": args.unit,
        "keep_object": bool(args.keep_object),
    }
    try:
        ninja_compile = import_harness_module("ninja_compile", repo_root)
        unit = args.unit or ninja_compile.find_unit_for_function(args.function)
        if not unit:
            payload.update({"status": "function_not_found", "message": "Function was not found in build/GALE01/report.json."})
            print_json(payload)
            return
        with captured_stdio() as (stdout, stderr):
            compiled = ninja_compile.direct_compile(unit)
        payload.update({"unit": unit, "stdout": stdout.getvalue(), "stderr": stderr.getvalue()})
        if compiled is None:
            payload.update({"status": "compile_failed", "object_path": None})
        else:
            payload.update({"status": "ok", "object_path": str(compiled.obj), "object_exists": compiled.obj.exists()})
            if not args.keep_object:
                compiled.tmpdir.cleanup()
                payload["object_exists_after_cleanup"] = compiled.obj.exists()
    except Exception as error:  # noqa: BLE001 - API boundary should report every bridge failure.
        payload.update({"status": "bridge_error", "error": str(error)})
    print_json(payload)


if __name__ == "__main__":
    main()
