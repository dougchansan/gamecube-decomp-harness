#!/usr/bin/env python3
"""Shared helpers for harness-backed tool APIs.

The orchestrator keeps worker-facing tools under the top-level ``tools`` tree
while the prototype implementations live in ``reference/melee-harness-master``.
This module provides the bridge: locate both checkouts, set ``MELEE_ROOT`` for
the harness scripts, run commands with bounded output, and return JSON-shaped
payloads that Pi tools can safely place in model context.
"""

from __future__ import annotations

import contextlib
import importlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence


MAX_STREAM_CHARS = 80_000


def package_root() -> Path:
    """Return the decomp-orchestrator repository root."""

    return Path(__file__).resolve().parents[2]


def harness_root() -> Path:
    """Return the checked-in melee-harness reference root."""

    return package_root() / "reference" / "melee-harness-master"


def harness_tools_root() -> Path:
    """Return the directory containing callable harness scripts."""

    return harness_root() / "tools"


def looks_like_melee_root(path: Path) -> bool:
    """Return true when ``path`` has enough Melee checkout shape for tools."""

    return (path / "src").is_dir() and (
        (path / "build" / "GALE01").exists()
        or (path / "compile_commands.json").exists()
        or (path / "config" / "GALE01").exists()
    )


def resolve_repo_root(value: str | Path | None = None) -> Path:
    """Resolve the target Melee checkout root used by harness scripts."""

    if value:
        return Path(value).expanduser().resolve()
    for env_name in ("MELEE_ROOT", "CLAUDE_PROJECT_DIR"):
        env_value = os.environ.get(env_name)
        if env_value:
            return Path(env_value).expanduser().resolve()
    cwd = Path.cwd().resolve()
    if looks_like_melee_root(cwd):
        return cwd
    sibling = package_root().parent / "melee"
    return sibling.resolve()


def clip(text: str, max_chars: int = MAX_STREAM_CHARS) -> str:
    """Bound command output while preserving the most useful beginning."""

    if len(text) <= max_chars:
        return text
    omitted = len(text) - max_chars
    return f"{text[:max_chars].rstrip()}\n...<truncated {omitted} characters>...\n"


def clamp_int(value: int | None, *, default: int, minimum: int, maximum: int) -> int:
    """Clamp optional integer API values to predictable safe bounds."""

    if value is None:
        return default
    return max(minimum, min(maximum, int(value)))


def command_payload(
    *,
    operation: str,
    command: Sequence[str],
    cwd: Path,
    repo_root: Path,
    exit_code: int | None,
    stdout: str,
    stderr: str,
    status: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the common JSON payload returned by command-style APIs."""

    payload: dict[str, Any] = {
        "status": status or ("ok" if exit_code == 0 else "failed"),
        "operation": operation,
        "repo_root": str(repo_root),
        "harness_root": str(harness_root()),
        "cwd": str(cwd),
        "command": list(command),
        "exit_code": exit_code,
        "stdout": clip(stdout),
        "stderr": clip(stderr),
    }
    if extra:
        payload.update(extra)
    return payload


def harness_env(repo_root: Path) -> dict[str, str]:
    """Create an environment that points harness scripts at the target repo."""

    env = dict(os.environ)
    env["MELEE_ROOT"] = str(repo_root)
    env.setdefault("CLAUDE_PROJECT_DIR", str(repo_root))
    tools = str(harness_tools_root())
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = tools if not existing else os.pathsep.join([tools, existing])
    return env


def run_harness_script(
    script_name: str,
    args: Sequence[str],
    *,
    repo_root: Path,
    operation: str,
    timeout_seconds: int = 60,
) -> dict[str, Any]:
    """Run a harness script and return a structured bounded command result."""

    script = harness_tools_root() / script_name
    if not script.exists():
        return {
            "status": "missing_harness_script",
            "operation": operation,
            "script": str(script),
            "repo_root": str(repo_root),
            "harness_root": str(harness_root()),
        }
    command = [sys.executable, str(script), *args]
    cwd = repo_root if repo_root.exists() else package_root()
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=harness_env(repo_root),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        return command_payload(
            operation=operation,
            command=command,
            cwd=cwd,
            repo_root=repo_root,
            exit_code=None,
            stdout=error.stdout or "",
            stderr=error.stderr or "",
            status="timed_out",
            extra={"timeout_seconds": timeout_seconds},
        )
    except OSError as error:
        return command_payload(
            operation=operation,
            command=command,
            cwd=cwd,
            repo_root=repo_root,
            exit_code=None,
            stdout="",
            stderr=str(error),
            status="spawn_failed",
        )
    return command_payload(
        operation=operation,
        command=command,
        cwd=cwd,
        repo_root=repo_root,
        exit_code=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )


def import_harness_module(module_name: str, repo_root: Path) -> Any:
    """Import one harness ``tools`` module after binding ``MELEE_ROOT``."""

    os.environ["MELEE_ROOT"] = str(repo_root)
    os.environ.setdefault("CLAUDE_PROJECT_DIR", str(repo_root))
    tools_root = str(harness_tools_root())
    if tools_root not in sys.path:
        sys.path.insert(0, tools_root)
    return importlib.import_module(module_name)


@contextlib.contextmanager
def captured_stdio() -> Iterable[tuple[io.StringIO, io.StringIO]]:
    """Capture stdout/stderr from imported harness helper calls."""

    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        yield stdout, stderr


def tool_bridge_status(
    *,
    tool: str,
    scripts: Sequence[str],
    repo_root: Path,
    required_paths: Sequence[str] = (),
    optional_paths: Sequence[str] = (),
    message: str,
) -> dict[str, Any]:
    """Report bridge availability without running heavyweight harness work."""

    script_status = [
        {"script": script, "path": str(harness_tools_root() / script), "exists": (harness_tools_root() / script).exists()}
        for script in scripts
    ]
    required = [
        {"path": path, "absolute_path": str(repo_root / path), "exists": (repo_root / path).exists()}
        for path in required_paths
    ]
    optional = [
        {"path": path, "absolute_path": str(repo_root / path), "exists": (repo_root / path).exists()}
        for path in optional_paths
    ]
    return {
        "tool": tool,
        "status": "ok" if all(item["exists"] for item in script_status) else "missing_harness_script",
        "operation_mode": "harness_bridge_v1",
        "repo_root": str(repo_root),
        "repo_root_exists": repo_root.exists(),
        "looks_like_melee_root": looks_like_melee_root(repo_root),
        "harness_root": str(harness_root()),
        "harness_root_exists": harness_root().exists(),
        "scripts": script_status,
        "required_paths": required,
        "optional_paths": optional,
        "message": message,
    }


def print_json(payload: dict[str, Any]) -> None:
    """Emit a deterministic JSON payload for Pi tool consumption."""

    print(json.dumps(payload, indent=2, sort_keys=True))
