"""Shared paths and helpers for review_lint QA gate tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
REVIEW_LINT_DIR = TESTS_DIR.parent
API_DIR = REVIEW_LINT_DIR / "api"


def find_orchestrator_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "package.json").is_file() and (candidate / "projects").is_dir():
            return candidate
    raise RuntimeError(f"Unable to find orchestrator root from {start}")


ORCHESTRATOR_ROOT = find_orchestrator_root(REVIEW_LINT_DIR)
COLOSSEUM_CHECKOUT = ORCHESTRATOR_ROOT / "projects" / "pkmn-colosseum" / "checkout"
FIXTURES_DIR = TESTS_DIR / "fixtures"
SCAN_DIFF = API_DIR / "scan_diff.py"

sys.path.insert(0, str(API_DIR))


@pytest.fixture(scope="session")
def colosseum_checkout() -> Path:
    if not (COLOSSEUM_CHECKOUT / "config" / "GC6E01" / "splits.txt").is_file():
        pytest.skip(f"colosseum checkout not available at {COLOSSEUM_CHECKOUT}")
    return COLOSSEUM_CHECKOUT
