"""Resubmission tombstone test: the particle.c blob, rejected once on
dougchansan/pkmn-colosseum#2659, must be blocked forever with the original comment URL.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import conftest  # noqa: F401  (inserts api/ into sys.path)
import _qa_rules
import scan_diff as scan_diff_mod

from conftest import FIXTURES_DIR, SCAN_DIFF

COMMENT_URL = "https://github.com/dougchansan/pkmn-colosseum/pull/2659#discussion_r3399334540"


def _particle_blob_hunk_text() -> str:
    """Extract the added lines of the real particle.c blob hunk."""

    diff_text = (FIXTURES_DIR / "string_blob_particle.patch").read_text(encoding="utf-8")
    for record in scan_diff_mod.parse_unified_diff(diff_text):
        for hunk in record["hunks"]:
            added = "\n".join(text for _, text in hunk["added"])
            if "lbl_8040A540[0x268]" in added:
                return added
    raise AssertionError("particle blob hunk not found in fixture")


def test_tombstone_blocks_resubmitted_particle_blob(colosseum_checkout, tmp_path: Path):
    blob_text = _particle_blob_hunk_text()
    tombstone = {
        "id": "particle-mcc-string-blob",
        "file": "src/sysdolphin/baselib/particle.c",
        "symbol": "lbl_8040A540",
        "source_pr": "dougchansan/pkmn-colosseum#2659",
        "comment_url": COMMENT_URL,
        "threshold": 0.7,
        "shingles": sorted(_qa_rules.normalized_shingles(blob_text)),
        "excerpt": blob_text.splitlines()[0].strip(),
        "created": "2026-06-11",
    }
    (tmp_path / "tombstones.jsonl").write_text(
        json.dumps(tombstone) + "\n", encoding="utf-8"
    )

    env = dict(os.environ)
    env["REVIEW_LINT_BANNED_DIR"] = str(tmp_path)
    result = subprocess.run(
        [
            "python3",
            str(SCAN_DIFF),
            "--repo",
            str(colosseum_checkout),
            "--diff-file",
            str(FIXTURES_DIR / "string_blob_particle.patch"),
            "--gate",
            "--json",
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 1, result.stderr
    payload = json.loads(result.stdout)
    tombstone_findings = [
        f for f in payload["findings"] if f["rule_id"] == "resubmission_tombstone"
    ]
    assert tombstone_findings, json.dumps(payload["findings"], indent=2)
    finding = tombstone_findings[0]
    assert finding["severity"] == "error"
    assert COMMENT_URL in finding["message"]
    assert finding["detail"]["comment_url"] == COMMENT_URL
    assert finding["detail"]["similarity"] >= 0.7
    assert finding["file"] == "src/sysdolphin/baselib/particle.c"
