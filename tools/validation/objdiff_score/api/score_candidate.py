#!/usr/bin/env python3
"""Score a candidate object with objdiff-cli for one function."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[3] / "_shared"))
from harness import clamp_int, harness_env, import_harness_module, print_json, resolve_repo_root


def parse_score_line(line: str) -> dict[str, Any]:
    """Parse the harness objdiff score-server response line."""

    parts = line.split()
    if not parts:
        return {"status": "empty_score_line", "raw_line": line}
    if parts[0] == "ERR":
        return {"status": "score_error", "raw_line": line}
    payload: dict[str, Any] = {"status": "ok", "raw_score": int(parts[0]), "code_hash": parts[1] if len(parts) > 1 else None}
    if len(parts) >= 5:
        payload.update({"hard": int(parts[2]), "regswap": int(parts[3]), "stack": int(parts[4])})
    return payload


def percent_diff(objdiff_cli: str, target: Path, candidate: Path, function: str, repo_root: Path, timeout: int) -> dict[str, Any]:
    """Run objdiff percent output as supplemental human-readable score evidence."""

    command = [
        objdiff_cli,
        "diff",
        "--format",
        "percent",
        "-c",
        "functionRelocDiffs=data_value",
        "-1",
        str(target),
        "-2",
        str(candidate),
        function,
    ]
    result = subprocess.run(command, cwd=repo_root, env=harness_env(repo_root), capture_output=True, text=True, timeout=timeout, check=False)
    return {
        "command": command,
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Target Melee checkout root.")
    parser.add_argument("--function", required=True, help="Function symbol to score.")
    parser.add_argument("--candidate-object", required=True, help="Candidate object path.")
    parser.add_argument("--unit", help="Unit path without main/ prefix or .o suffix.")
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Maximum runtime for score/diff commands.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    timeout = clamp_int(args.timeout_seconds, default=60, minimum=5, maximum=300)
    candidate = Path(args.candidate_object)
    if not candidate.is_absolute():
        candidate = repo_root / candidate

    payload: dict[str, Any] = {
        "operation": "objdiff_score:score_candidate",
        "repo_root": str(repo_root),
        "function": args.function,
        "candidate_object": str(candidate),
    }
    if not candidate.exists():
        payload.update({"status": "candidate_object_not_found"})
        print_json(payload)
        return

    try:
        ninja_compile = import_harness_module("ninja_compile", repo_root)
        objdiff_path = import_harness_module("objdiff_path", repo_root)
        unit = args.unit or ninja_compile.find_unit_for_function(args.function)
        if not unit:
            payload.update({"status": "function_not_found", "message": "Function was not found in build/GALE01/report.json."})
            print_json(payload)
            return
        target = repo_root / "build" / "GALE01" / "obj" / f"{unit}.o"
        if not target.exists():
            payload.update({"status": "target_object_not_found", "unit": unit, "target_object": str(target)})
            print_json(payload)
            return
        cli = objdiff_path.objdiff_cli()
        command = [cli, "score", str(target), args.function]
        proc = subprocess.Popen(command, cwd=repo_root, env=harness_env(repo_root), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            ready = proc.stdout.readline() if proc.stdout else ""
            if ready.strip() != "READY":
                stderr = proc.stderr.read() if proc.stderr else ""
                payload.update({"status": "score_server_not_ready", "command": command, "stdout": ready, "stderr": stderr})
            else:
                assert proc.stdin is not None
                proc.stdin.write(str(candidate) + "\n")
                proc.stdin.flush()
                line = proc.stdout.readline() if proc.stdout else ""
                score = parse_score_line(line.strip())
                payload.update({"status": score.get("status"), "unit": unit, "target_object": str(target), "command": command, "score": score})
            if proc.stdin:
                proc.stdin.close()
            proc.wait(timeout=2)
        finally:
            if proc.poll() is None:
                proc.kill()
        payload["percent_diff"] = percent_diff(cli, target, candidate, args.function, repo_root, timeout)
    except subprocess.TimeoutExpired as error:
        payload.update({"status": "timed_out", "error": str(error), "timeout_seconds": timeout})
    except Exception as error:  # noqa: BLE001 - API boundary should report every scoring failure.
        payload.update({"status": "bridge_error", "error": str(error)})
    print_json(payload)


if __name__ == "__main__":
    main()
