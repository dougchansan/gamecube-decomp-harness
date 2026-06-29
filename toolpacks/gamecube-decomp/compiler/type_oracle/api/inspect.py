#!/usr/bin/env python3
"""Inspect clang-derived expression types for one source file."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from toolpack_runtime import clamp_int, import_tool_module, print_json, resolve_repo_root


def expression_occurrences(source: bytes, expression: str) -> list[tuple[int, int]]:
    """Return byte spans where the expression text occurs exactly."""

    needle = expression.encode("utf-8")
    spans: list[tuple[int, int]] = []
    start = 0
    while needle:
        index = source.find(needle, start)
        if index < 0:
            break
        spans.append((index, index + len(needle)))
        start = index + max(1, len(needle))
    return spans


def format_span(source: bytes, start: int, end: int, type_text: str) -> dict[str, Any]:
    """Format a source byte span with a short expression preview."""

    return {
        "byte_start": start,
        "byte_end": end,
        "type": type_text,
        "expression": source[start:end].decode("utf-8", "replace"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target project checkout root.")
    parser.add_argument("--source-path", required=True, help="Project-relative source path.")
    parser.add_argument("--expression", help="Exact expression text to look up.")
    parser.add_argument("--byte-start", type=int, help="Exact expression byte start.")
    parser.add_argument("--byte-end", type=int, help="Exact expression byte end.")
    parser.add_argument("--limit", type=int, default=20, help="Maximum span rows to return.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    source_path = repo_root / args.source_path
    payload: dict[str, Any] = {
        "operation": "type_oracle:inspect",
        "repo_root": str(repo_root),
        "source_path": args.source_path,
    }
    if not source_path.exists():
        payload.update({"status": "source_not_found", "absolute_path": str(source_path)})
        print_json(payload)
        return

    try:
        type_oracle = import_tool_module("type_oracle", repo_root)
        if not type_oracle.available():
            payload.update({"status": "libclang_unavailable", "types": []})
            print_json(payload)
            return
        flags = type_oracle.clang_flags_for(source_path, repo_root / "compile_commands.json")
        if flags is None:
            payload.update({"status": "compile_commands_entry_missing", "types": []})
            print_json(payload)
            return
        type_map = type_oracle.build_oracle(source_path, flags)
        source = source_path.read_bytes()
        limit = clamp_int(args.limit, default=20, minimum=1, maximum=100)

        requested_spans: list[tuple[int, int]] = []
        if args.byte_start is not None and args.byte_end is not None:
            requested_spans.append((args.byte_start, args.byte_end))
        if args.expression:
            requested_spans.extend(expression_occurrences(source, args.expression))

        if requested_spans:
            rows = [
                format_span(source, start, end, type_map[(start, end)])
                for start, end in requested_spans
                if (start, end) in type_map
            ]
            containing = []
            if not rows:
                for start, end in requested_spans:
                    for (span_start, span_end), type_text in type_map.items():
                        if span_start <= start and end <= span_end:
                            containing.append(format_span(source, span_start, span_end, type_text))
                            if len(containing) >= limit:
                                break
                    if len(containing) >= limit:
                        break
            payload.update(
                {
                    "status": "ok",
                    "expression": args.expression,
                    "requested_spans": requested_spans,
                    "type_count": len(type_map),
                    "types": rows[:limit],
                    "containing_types": containing[:limit],
                }
            )
        else:
            rows = [
                format_span(source, start, end, type_text)
                for (start, end), type_text in sorted(type_map.items())[:limit]
            ]
            payload.update({"status": "ok", "type_count": len(type_map), "types": rows})
    except Exception as error:  # noqa: BLE001 - API boundary should report every oracle failure.
        payload.update({"status": "tool_impl_error", "error": str(error)})
    print_json(payload)


if __name__ == "__main__":
    main()
