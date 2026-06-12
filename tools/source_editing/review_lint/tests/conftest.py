"""Shared paths and helpers for review_lint QA gate tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
REVIEW_LINT_DIR = TESTS_DIR.parent
API_DIR = REVIEW_LINT_DIR / "api"
ORCHESTRATOR_ROOT = REVIEW_LINT_DIR.parents[2]
MELEE_CHECKOUT = ORCHESTRATOR_ROOT / "projects" / "melee" / "checkout"
FIXTURES_DIR = TESTS_DIR / "fixtures"
SCAN_DIFF = API_DIR / "scan_diff.py"

sys.path.insert(0, str(API_DIR))


@pytest.fixture(scope="session")
def melee_checkout() -> Path:
    if not (MELEE_CHECKOUT / "config" / "GALE01" / "splits.txt").is_file():
        pytest.skip(f"melee checkout not available at {MELEE_CHECKOUT}")
    return MELEE_CHECKOUT
