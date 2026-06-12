#!/usr/bin/env python3
"""Preview include additions suggested by tool-local fix_includes.py logic."""

from __future__ import annotations

import argparse
import difflib
from pathlib import Path
import sys
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from melee_tooling import import_tool_module, print_json, resolve_repo_root


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    parser.add_argument("--source-path", required=True, help="Project-relative C source file.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    source_path = repo_root / args.source_path
    payload: dict[str, Any] = {
        "operation": "include_fixer:preview",
        "repo_root": str(repo_root),
        "source_path": args.source_path,
    }
    if not source_path.exists():
        payload.update({"status": "source_not_found", "absolute_path": str(source_path)})
        print_json(payload)
        return

    try:
        fix_includes = import_tool_module("fix_includes", repo_root)
        cc_args = fix_includes.load_compile_args(source_path)
        if not cc_args:
            payload.update({"status": "compile_commands_entry_missing"})
            print_json(payload)
            return
        command = [cc_args[0]] + fix_includes.build_syntax_only_args(cc_args[1:], source_path)
        code, stdout, stderr = fix_includes.run_clang_syntax_check(command, repo_root)
        undeclared = fix_includes.extract_undeclared_functions(stderr)
        source_text = source_path.read_text(encoding="utf-8", errors="replace")
        _, already, already_base = fix_includes.parse_existing_includes(source_text)
        proposals: dict[str, str] = {}
        for name in undeclared:
            header = fix_includes.search_headers_for_function(name)
            if header is None:
                continue
            try:
                rel = header.relative_to(repo_root / "src")
            except ValueError:
                rel = header
            parts = rel.as_posix().split("/")
            if parts and parts[0] == "melee":
                parts = parts[1:]
            inc_path = "/".join(parts)
            if inc_path in already or Path(inc_path).name in already_base:
                continue
            if header.resolve() == source_path.with_suffix(".h").resolve():
                continue
            proposals[inc_path] = str(header)
        include_lines = [f"#include \"{path}\"" for path in sorted(proposals)]
        new_text = fix_includes.insert_includes(source_text, include_lines) if include_lines else source_text
        diff = "".join(
            difflib.unified_diff(
                source_text.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"a/{args.source_path}",
                tofile=f"b/{args.source_path}",
            )
        )
        payload.update(
            {
                "status": "proposals_found" if include_lines else "no_proposals",
                "clang_exit_code": code,
                "clang_command": command,
                "clang_stdout": stdout,
                "clang_stderr": stderr,
                "undeclared_functions": undeclared,
                "include_lines": include_lines,
                "headers": proposals,
                "diff": diff,
            }
        )
    except Exception as error:  # noqa: BLE001 - API boundary should report every preview failure.
        payload.update({"status": "tool_impl_error", "error": str(error)})
    print_json(payload)


if __name__ == "__main__":
    main()
