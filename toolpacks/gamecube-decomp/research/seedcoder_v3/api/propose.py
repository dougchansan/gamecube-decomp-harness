#!/usr/bin/env python3
"""Query the trained SeedCoder V3 service for proposal-only C candidates."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_SERVER = "http://100.116.145.17:8780/gen"
MAX_ASM_CHARS = 30000
MAX_CONTEXT_CHARS = 12000
MAX_CANDIDATE_CHARS = 12000


def print_json(payload: dict) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True))


def clamp_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = limit // 2
    tail = limit - head
    return text[:head] + "\n\n[...clipped...]\n\n" + text[-tail:]


def resolve_repo_root(value: str | None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    env = os.environ.get("ORCH_PROJECT_REPO_ROOT")
    if env:
        return Path(env).expanduser().resolve()
    return Path.cwd().resolve()


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    return data


def find_report_function(repo_root: Path, function: str) -> tuple[dict, dict] | None:
    report_path = repo_root / "build/GC6E01/report.json"
    report = load_json(report_path)
    for unit in report.get("units", []):
        if not isinstance(unit, dict):
            continue
        for fn in unit.get("functions", []) or []:
            if isinstance(fn, dict) and fn.get("name") == function:
                return unit, fn
    return None


def find_objdiff_unit(repo_root: Path, unit_name: str) -> dict | None:
    objdiff_path = repo_root / "objdiff.json"
    objdiff = load_json(objdiff_path)
    for unit in objdiff.get("units", []):
        if isinstance(unit, dict) and unit.get("name") == unit_name:
            return unit
    return None


def target_object_path(repo_root: Path, unit_name: str) -> Path:
    objdiff_unit = find_objdiff_unit(repo_root, unit_name)
    if objdiff_unit:
        raw = objdiff_unit.get("target_path")
        if isinstance(raw, str) and raw:
            return (repo_root / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
    suffix = unit_name.removeprefix("main/")
    return (repo_root / "build/GC6E01/obj" / f"{suffix}.o").resolve()


def objdump_path(repo_root: Path) -> str | None:
    candidates = [
        repo_root / "build/binutils/powerpc-eabi-objdump",
        repo_root / "build/tools/powerpc-eabi-objdump",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which("powerpc-eabi-objdump")


def dump_target_asm(repo_root: Path, target_obj: Path, function: str, timeout: int) -> tuple[bool, str]:
    objdump = objdump_path(repo_root)
    if not objdump:
        return False, "powerpc-eabi-objdump not found"
    if not target_obj.is_file():
        return False, f"target object not found: {target_obj}"
    result = subprocess.run(
        [objdump, "-d", f"--disassemble={function}", str(target_obj)],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    output = (result.stdout or "") + (("\n" + result.stderr) if result.stderr else "")
    if result.returncode != 0:
        return False, output.strip() or f"objdump exited {result.returncode}"
    if f"<{function}>:" not in output:
        return False, output.strip() or f"objdump did not find symbol {function}"
    return True, clamp_text(output, MAX_ASM_CHARS)


def source_context(repo_root: Path, source_path: str | None, function: str) -> str:
    if not source_path:
        return ""
    path = repo_root / source_path
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    idx = text.find(function)
    if idx < 0:
        return clamp_text(text[:MAX_CONTEXT_CHARS], MAX_CONTEXT_CHARS)
    start = max(0, idx - MAX_CONTEXT_CHARS // 2)
    end = min(len(text), idx + MAX_CONTEXT_CHARS // 2)
    return clamp_text(text[start:end], MAX_CONTEXT_CHARS)


def post_candidates(
    server: str,
    function: str,
    asm: str,
    context: str,
    draft: str,
    diff: str,
    n: int,
    temp: float,
    max_new: int,
    timeout: int,
) -> dict:
    body = {
        "asm": asm,
        "fn": function,
        "context": context,
        "n": n,
        "temp": temp,
        "max_new": max_new,
    }
    if draft and diff:
        body["draft"] = draft
        body["diff"] = diff
    req = urllib.request.Request(
        server,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("SeedCoder response is not a JSON object")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target project checkout root.")
    parser.add_argument("--function", required=True, help="Function symbol to propose C for.")
    parser.add_argument("--server", default=os.environ.get("SEED_SERVER", DEFAULT_SERVER), help="SeedCoder V3 /gen endpoint.")
    parser.add_argument("--n", type=int, default=2, help="Number of candidates to request.")
    parser.add_argument("--temp", type=float, default=0.35, help="Sampling temperature.")
    parser.add_argument("--max-new", type=int, default=900, help="Maximum new tokens requested from the server.")
    parser.add_argument("--draft", default="", help="Optional current C draft for repair mode.")
    parser.add_argument("--diff", default="", help="Optional target-vs-current diff for repair mode.")
    parser.add_argument("--timeout-seconds", type=int, default=420, help="HTTP/objdump timeout.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    function = args.function.strip()
    if not function:
        print_json({"status": "missing_function"})
        return 1

    try:
        found = find_report_function(repo_root, function)
        if not found:
            print_json({"status": "function_not_found", "function": function, "repo_root": str(repo_root)})
            return 1
        unit, fn = found
        unit_name = str(unit.get("name") or "")
        metadata = unit.get("metadata") if isinstance(unit.get("metadata"), dict) else {}
        source_path = metadata.get("source_path") if isinstance(metadata.get("source_path"), str) else None
        target_obj = target_object_path(repo_root, unit_name)
        ok, asm_or_error = dump_target_asm(repo_root, target_obj, function, max(10, min(args.timeout_seconds, 120)))
        if not ok:
            print_json({
                "status": "target_asm_unavailable",
                "function": function,
                "unit": unit_name,
                "target_object": str(target_obj),
                "error": asm_or_error,
            })
            return 1
        context = source_context(repo_root, source_path, function)
        response = post_candidates(
            args.server,
            function,
            asm_or_error,
            context,
            args.draft,
            args.diff,
            max(1, min(int(args.n), 6)),
            max(0.0, min(float(args.temp), 1.5)),
            max(32, min(int(args.max_new), 3000)),
            max(10, min(int(args.timeout_seconds), 900)),
        )
        candidates = response.get("candidates", [])
        if not isinstance(candidates, list):
            candidates = []
        payload = {
            "status": "ok",
            "tool": "seedcoder_v3_propose",
            "model": response.get("model", "seedcoder8b-cw-v3"),
            "server": args.server,
            "function": function,
            "unit": unit_name,
            "source_path": source_path,
            "target_object": str(target_obj),
            "baseline_fuzzy_match_percent": fn.get("fuzzy_match_percent"),
            "function_size": fn.get("size"),
            "proposal_policy": "external_hint_only_validate_before_editing",
            "target_assembly": asm_or_error,
            "candidates": [clamp_text(str(candidate), MAX_CANDIDATE_CHARS) for candidate in candidates],
        }
        print_json(payload)
        return 0
    except (OSError, subprocess.SubprocessError, urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
        print_json({"status": "error", "tool_error": True, "function": function, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
