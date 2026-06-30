#!/usr/bin/env python3
"""
Compile a single colosseum translation unit using the exact MWCC command that
`build.ninja` would, without going through Ninja itself.

Extracted from checkdiff.py so the permuter (permute.py) and checkdiff.py
share one faithful, ninja-coupled compile path. The functions here parse the
TU's `build` edge out of build.ninja (rule, mw_version, cflags), then invoke
`<runner> [sjiswrap] mwcceppc.exe <cflags> -c <src> -o <tmp.o>` (plus
`dtk extab clean` for extab rules), writing the object to a throwaway temp dir.
The runner is wibo when available, with Wine as the macOS fallback.

`compile_source_text()` additionally lets a caller compile an in-memory
*candidate* source (the permuter's mutated text): it writes the text to a
hidden temp `.c` **in the original source file's directory**, so that
`-cwd source` and quote-includes (`#include "foo.h"`) resolve byte-identically
to the real build, then compiles that file with the TU's real flags.
"""

from __future__ import annotations

import atexit
import contextlib
import json
import os
import platform
import re
import shutil
import shlex
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

# Project checkout root: explicit override, then Claude Code's project dir,
# then assume this script lives at <colosseum>/tools/.
from project_root import resolve_root

ROOT = resolve_root()
REPORT_PATH = ROOT / "build/GC6E01/report.json"
SRC_ROOT = ROOT / "src"

MWCC_RULES = {"mwcc", "mwcc_sjis", "mwcc_extab", "mwcc_sjis_extab"}
WORKER_COMPILE_SLOT_STALE_SECONDS = 60 * 60
WORKER_COMPILE_SLOT_MISSING_OWNER_STALE_SECONDS = 30


@dataclass
class BuildBlock:
    rule: str
    src: str
    mw_version: str
    cflags: str
    extab_padding: Optional[str] = None


@dataclass
class CompiledObject:
    obj: Path
    tmpdir: tempfile.TemporaryDirectory


def find_unit_for_function(func_name: str) -> Optional[str]:
    """Return the unit path (e.g. 'colosseum/it/itdrop') containing func_name."""
    with REPORT_PATH.open("r") as f:
        for unit in json.load(f).get("units", []):
            for function in unit.get("functions", []):
                if function.get("name") == func_name:
                    return unit.get("name", "").removeprefix("main/")
    return None


def find_build_block(obj_path: str) -> BuildBlock:
    """Parse build.ninja for the MWCC build edge that produces obj_path."""
    target = f"build/GC6E01/src/{obj_path}.o"
    text = (ROOT / "build.ninja").read_text()
    # Unfold ninja line continuations so cflags can be read as one value.
    text = text.replace("$\n", " ")

    blocks = re.split(r"^build ", text, flags=re.M)
    for block in blocks:
        if not (block.startswith(f"{target}:") or block.startswith(f"{target} :")):
            continue

        build_line = block.splitlines()[0]
        match = re.match(rf"{re.escape(target)}\s*:\s*(\S+)\s+(.+)", build_line)
        if match is None:
            raise RuntimeError(f"could not parse build edge for {target}")

        rule = match.group(1)
        explicit_inputs = re.split(r"\s+\|\|?\s+", match.group(2), maxsplit=1)[0]
        inputs = shlex.split(explicit_inputs)
        if not inputs:
            raise RuntimeError(f"build edge for {target} has no source input")

        vars = {
            m.group(1): m.group(2).strip()
            for m in re.finditer(r"^\s+([A-Za-z_][A-Za-z0-9_]*) = (.*)$", block, re.M)
        }
        try:
            mw_version = vars["mw_version"]
            cflags = vars["cflags"]
        except KeyError as e:
            raise RuntimeError(f"build edge for {target} is missing {e.args[0]}") from e

        return BuildBlock(
            rule=rule,
            src=inputs[0],
            mw_version=mw_version,
            cflags=cflags,
            extab_padding=vars.get("extab_padding"),
        )

    raise RuntimeError(f"no build edge for {target}")


def _root_rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def _worker_compile_concurrency() -> int:
    value = os.environ.get("ORCH_WORKER_COMPILE_CONCURRENCY") or os.environ.get("ORCH_WORKER_NINJA_CONCURRENCY")
    try:
        parsed = int(value) if value else 12
    except ValueError:
        parsed = 12
    return max(1, min(64, parsed))


def _worker_compile_queue_dir() -> Path:
    worktree_dir = ROOT.parent
    workers_dir = worktree_dir.parent
    if workers_dir.name == "workers":
        return workers_dir.parent / ".worker-ninja-slots"
    return worktree_dir / ".worker-ninja-slots"


def _slot_is_stale(slot_dir: Path) -> bool:
    try:
        age = time.time() - slot_dir.stat().st_mtime
    except OSError:
        return True
    try:
        owner = json.loads((slot_dir / "owner.json").read_text())
        pid = int(owner.get("pid") or 0)
        if pid > 0:
            try:
                os.kill(pid, 0)
                return age > WORKER_COMPILE_SLOT_STALE_SECONDS
            except OSError:
                return True
    except Exception:
        return age > WORKER_COMPILE_SLOT_MISSING_OWNER_STALE_SECONDS
    return age > WORKER_COMPILE_SLOT_STALE_SECONDS


@contextlib.contextmanager
def worker_compile_slot() -> Iterator[None]:
    queue_dir = _worker_compile_queue_dir()
    queue_dir.mkdir(parents=True, exist_ok=True)
    limit = _worker_compile_concurrency()
    while True:
        for index in range(limit):
            slot_dir = queue_dir / f"slot-{index}"
            try:
                slot_dir.mkdir()
                (slot_dir / "owner.json").write_text(json.dumps({
                    "pid": os.getpid(),
                    "repoRoot": str(ROOT),
                    "acquiredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "kind": "toolpack_mwcc",
                }, indent=2))
            except FileExistsError:
                if _slot_is_stale(slot_dir):
                    shutil.rmtree(slot_dir, ignore_errors=True)
                continue
            try:
                yield
            finally:
                shutil.rmtree(slot_dir, ignore_errors=True)
            return
        time.sleep(0.25 + (os.getpid() % 10) * 0.03)


def _runner_command() -> tuple[str, Path | str] | None:
    """Resolve the MWCC runner.

    Prefer wibo when available because it is faster and closer to the Linux
    project setup, but the macOS checkout's build.ninja uses Wine directly.
    """
    override = os.environ.get("MWCC_WIBO")
    if override:
        return ("wibo", override)
    machine = platform.machine()
    auto_wibo_supported = (
        sys.platform == "linux" and machine in ("i386", "x86_64", "aarch64", "arm64")
    ) or (
        sys.platform == "darwin" and machine in ("x86_64", "aarch64", "arm64")
    )
    state_wibo = _state_wibo_path()
    if auto_wibo_supported and state_wibo is not None:
        return ("wibo", state_wibo)
    project_wibo = ROOT / "build/tools/wibo"
    if auto_wibo_supported and project_wibo.exists():
        return ("wibo", project_wibo)
    path_wibo = shutil.which("wibo")
    if auto_wibo_supported and path_wibo:
        return ("wibo", path_wibo)
    wine_candidates = [
        os.environ.get("WINE"),
        shutil.which("wine"),
        "/usr/local/bin/wine",
        "/opt/homebrew/bin/wine",
    ]
    for wine in wine_candidates:
        if wine and (Path(wine).exists() or shutil.which(wine)):
            return ("wine", wine)
    return None


def _state_wibo_path() -> Path | None:
    state_dir = os.environ.get("ORCH_PROJECT_STATE_DIR")
    if state_dir:
        candidate = Path(state_dir).expanduser() / "tools" / "wibo"
        if candidate.is_file():
            return candidate
    for parent in (ROOT, *ROOT.parents):
        if parent.name == "worktrees":
            candidate = parent.parent / "state" / "tools" / "wibo"
            if candidate.is_file():
                return candidate
        candidate = parent / "state" / "tools" / "wibo"
        if candidate.is_file():
            return candidate
    return None


def _compiler_prefix(block: BuildBlock, *, quiet: bool) -> Optional[list]:
    """[runner, (sjiswrap,) mwcceppc.exe] for this TU's rule, or None if a
    prerequisite is missing."""
    sjiswrap = ROOT / "build/tools/sjiswrap.exe"
    compiler = ROOT / "build" / "compilers" / block.mw_version / "mwcceppc.exe"
    runner = _runner_command()
    required = [compiler]
    if "sjis" in block.rule:
        required.append(sjiswrap)
    missing = [str(p) for p in required if not p.exists()]
    if runner is None:
        missing.append("MWCC runner: build/tools/wibo, MWCC_WIBO, wibo, WINE, or Wine at /usr/local/bin/wine or /opt/homebrew/bin/wine")
    if missing:
        if not quiet:
            print("missing build prerequisite(s):", file=sys.stderr)
            for p in missing:
                print(f"  {p}", file=sys.stderr)
            print("run `ninja tools` once to fetch/build prerequisites", file=sys.stderr)
        return None
    _, runner_path = runner
    cmd = [str(runner_path)]
    if "sjis" in block.rule:
        cmd.append(str(sjiswrap))
    cmd.append(str(compiler))
    return cmd


def direct_compile(
    obj_path: str,
    *,
    src_override: Optional[str] = None,
    quiet: bool = False,
    prefix: Optional[str] = None,
) -> Optional[CompiledObject]:
    """Compile one TU directly from its build.ninja MWCC settings.

    The output goes to a unique temporary object, avoiding Ninja state and the
    normal build-tree object path. When `src_override` is given, that file is
    compiled instead of the TU's real source (used by the permuter to score a
    candidate). It must sit in the same directory as the real source so that
    `-cwd source` and quote-includes resolve identically.

    `quiet=True` suppresses all diagnostic prints (the permuter expects many
    candidates to fail to compile; that is normal, not noteworthy).
    """
    try:
        block = find_build_block(obj_path)
    except RuntimeError as e:
        if not quiet:
            print(f"build.ninja lookup failed: {e}", file=sys.stderr)
        return None

    if block.rule not in MWCC_RULES:
        if not quiet:
            print(f"unsupported build rule for direct compile: {block.rule}", file=sys.stderr)
        return None

    cmd_prefix = _compiler_prefix(block, quiet=quiet)
    if cmd_prefix is None:
        return None
    dtk = ROOT / "build/tools/dtk"
    if "extab" in block.rule and not dtk.exists():
        if not quiet:
            print(f"missing build prerequisite: {dtk}", file=sys.stderr)
            print("run `ninja tools` once to fetch/build prerequisites", file=sys.stderr)
        return None

    build_tmp = ROOT / "build"
    build_tmp.mkdir(exist_ok=True)
    tmpdir = tempfile.TemporaryDirectory(prefix="ninja-compile-", dir=build_tmp)
    tmp_obj = Path(tmpdir.name) / f"{Path(obj_path).name}.o"

    src = src_override if src_override is not None else block.src

    cmd = list(cmd_prefix) + shlex.split(block.cflags)
    if prefix is not None:
        # Inject a precompiled header onto the source (mwcc -prefix). The arg is
        # resolved like an #include (relative to the source dir, due to
        # -cwd source), so callers pass the PCH's basename and keep it colocated.
        cmd += ["-prefix", prefix]
    cmd += ["-c", src, "-o", str(tmp_obj)]

    with worker_compile_slot():
        result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        if not quiet:
            print("direct compile failed:", file=sys.stderr)
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
        tmpdir.cleanup()
        return None

    if not tmp_obj.exists():
        objs = list(Path(tmpdir.name).glob("*.o"))
        if len(objs) == 1:
            tmp_obj = objs[0]
        else:
            if not quiet:
                print(f"direct compile did not produce {tmp_obj}", file=sys.stderr)
            tmpdir.cleanup()
            return None

    if "extab" in block.rule:
        padding = block.extab_padding or ""
        result = subprocess.run(
            [str(dtk), "extab", "clean", "--padding", padding, str(tmp_obj), str(tmp_obj)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            if not quiet:
                print("extab post-processing failed:", file=sys.stderr)
                print(result.stdout)
                print(result.stderr, file=sys.stderr)
            tmpdir.cleanup()
            return None

    return CompiledObject(obj=tmp_obj, tmpdir=tmpdir)


def source_dir_for(obj_path: str) -> Path:
    """Directory holding the real .c for obj_path (where candidates must live)."""
    return (ROOT / f"src/{obj_path}.c").parent


def compile_source_text(
    obj_path: str,
    source_text: str,
    *,
    show_errors: bool = False,
    prefix_pch: Optional[Path] = None,
) -> Optional[CompiledObject]:
    """Compile candidate `source_text` for `obj_path` with the TU's real flags.

    Writes the text to a hidden temp .c in the real source's directory (so
    include resolution matches the real build), compiles it, removes the temp
    .c, and returns the CompiledObject (whose .o lives in a temp dir the caller
    keeps alive). Returns None on compile failure.

    If `prefix_pch` is given (a .mch built by build_pch, colocated in the same
    source dir), it is injected via mwcc -prefix so the TU's headers are not
    reparsed; `source_text` must then be the TU *body* (everything after the
    precompiled prefix region).
    """
    src_dir = source_dir_for(obj_path)
    fd, tmp_c = tempfile.mkstemp(suffix=".c", prefix=".permute-", dir=str(src_dir))
    tmp_c_path = Path(tmp_c)
    _TEMP_CANDIDATES.add(tmp_c_path)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(source_text)
        return direct_compile(
            obj_path,
            src_override=_root_rel(tmp_c_path),
            quiet=not show_errors,
            prefix=prefix_pch.name if prefix_pch is not None else None,
        )
    finally:
        try:
            tmp_c_path.unlink()
        except OSError:
            pass
        _TEMP_CANDIDATES.discard(tmp_c_path)


def compile_batch(
    obj_path: str,
    sources: List[str],
    *,
    prefix_pch: Optional[Path] = None,
    quiet: bool = True,
) -> Tuple[List[Optional[Path]], List]:
    """Compile several candidate sources in ONE mwcc invocation to amortize the
    fixed process startup. Returns (objs, cleanups):

      objs[i]   -- Path to the .o for sources[i], or None if it failed.
      cleanups  -- handles the caller must release (tmpdir.cleanup()) once it
                   has finished scoring every objs[i].

    mwcc aborts at the first file with an error (-maxerrors 1), leaving files
    after it uncompiled; those are recompiled individually to salvage them
    (so one bad candidate only costs itself, not the rest of the batch).
    """
    if not sources:
        return [], []
    none = [None] * len(sources)
    try:
        block = find_build_block(obj_path)
    except RuntimeError as e:
        if not quiet:
            print(f"build.ninja lookup failed: {e}", file=sys.stderr)
        return none, []
    if block.rule not in MWCC_RULES:
        return none, []
    cmd_prefix = _compiler_prefix(block, quiet=quiet)
    if cmd_prefix is None:
        return none, []

    src_dir = source_dir_for(obj_path)
    cfiles: List[Path] = []
    for s in sources:
        fd, p = tempfile.mkstemp(suffix=".c", prefix=".permute-", dir=str(src_dir))
        pp = Path(p)
        _TEMP_CANDIDATES.add(pp)
        with os.fdopen(fd, "w") as f:
            f.write(s)
        cfiles.append(pp)

    build_tmp = ROOT / "build"
    build_tmp.mkdir(exist_ok=True)
    outdir = tempfile.TemporaryDirectory(prefix="ninja-batch-", dir=build_tmp)
    cleanups: List = [outdir]

    cmd = list(cmd_prefix) + shlex.split(block.cflags)
    if prefix_pch is not None:
        cmd += ["-prefix", prefix_pch.name]
    # -o <dir> writes each input's object as <dir>/<source-stem>.o
    cmd += ["-o", _root_rel(Path(outdir.name)), "-c"] + [_root_rel(c) for c in cfiles]
    with worker_compile_slot():
        subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)

    objs: List[Optional[Path]] = []
    for c in cfiles:
        o = Path(outdir.name) / (c.stem + ".o")
        objs.append(o if o.exists() else None)

    if "extab" in block.rule:
        dtk = ROOT / "build/tools/dtk"
        padding = block.extab_padding or ""
        for o in objs:
            if o is not None:
                subprocess.run(
                    [str(dtk), "extab", "clean", "--padding", padding, str(o), str(o)],
                    cwd=ROOT, capture_output=True, text=True)

    # Salvage anything mwcc skipped after a -maxerrors abort.
    for i, o in enumerate(objs):
        if o is None:
            co = compile_source_text(obj_path, sources[i], prefix_pch=prefix_pch)
            if co is not None:
                objs[i] = co.obj
                cleanups.append(co.tmpdir)

    for c in cfiles:
        try:
            c.unlink()
        except OSError:
            pass
        _TEMP_CANDIDATES.discard(c)
    return objs, cleanups


def build_pch(
    obj_path: str, prefix_text: str, *, quiet: bool = True
) -> Optional[Path]:
    """Precompile `prefix_text` (the TU's leading #include/#define block) into a
    .mch in the source dir, with the TU's real flags. Returns the .mch path
    (caller unlinks it when done) or None on failure.

    The .mch is colocated with where candidates are written so that
    `compile_source_text(..., prefix_pch=<this>)` can reference it by basename.
    """
    try:
        block = find_build_block(obj_path)
    except RuntimeError as e:
        if not quiet:
            print(f"build.ninja lookup failed: {e}", file=sys.stderr)
        return None
    if block.rule not in MWCC_RULES:
        return None
    cmd_prefix = _compiler_prefix(block, quiet=quiet)
    if cmd_prefix is None:
        return None

    src_dir = source_dir_for(obj_path)
    fd, pch_c = tempfile.mkstemp(suffix=".c", prefix=".permute-pch-", dir=str(src_dir))
    pch_c_path = Path(pch_c)
    mch_path = pch_c_path.with_suffix(".mch")
    _TEMP_CANDIDATES.add(pch_c_path)
    _TEMP_CANDIDATES.add(mch_path)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(prefix_text)
        cmd = (
            list(cmd_prefix)
            + shlex.split(block.cflags)
            + ["-precompile", _root_rel(mch_path), "-c", _root_rel(pch_c_path)]
        )
        with worker_compile_slot():
            result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if not mch_path.exists():
            if not quiet:
                print("PCH precompile failed:", file=sys.stderr)
                print(result.stdout)
                print(result.stderr, file=sys.stderr)
            _TEMP_CANDIDATES.discard(mch_path)
            return None
        return mch_path
    finally:
        try:
            pch_c_path.unlink()
        except OSError:
            pass
        _TEMP_CANDIDATES.discard(pch_c_path)


# Safety net: remove any candidate temp files if the process dies mid-compile.
_TEMP_CANDIDATES: "set[Path]" = set()


@atexit.register
def _cleanup_temp_candidates() -> None:
    for p in list(_TEMP_CANDIDATES):
        try:
            p.unlink()
        except OSError:
            pass
