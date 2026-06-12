"""Golden/negative fixture tests for the diff-aware QA ship gate.

Golden fixtures are real diffs extracted from the rejected PR branches
(doldecomp/melee #2655-#2659); each must hard-fail with the expected rule at
the maintainer-flagged location. Negative fixtures must produce zero
error-severity findings.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from conftest import FIXTURES_DIR, SCAN_DIFF


def run_scan_diff(repo: Path, fixture: str, extra_env: dict[str, str] | None = None):
    env = {k: v for k, v in os.environ.items() if k != "REVIEW_LINT_BANNED_DIR"}
    env.update(extra_env or {})
    result = subprocess.run(
        [
            "python3",
            str(SCAN_DIFF),
            "--repo",
            str(repo),
            "--diff-file",
            str(FIXTURES_DIR / fixture),
            "--gate",
            "--json",
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.stdout, f"no stdout from scan_diff (stderr: {result.stderr})"
    return result.returncode, json.loads(result.stdout)


# (fixture, expected rule_id, file, inclusive line range of the finding)
GOLDEN_CASES = [
    # #2656 gm_1832.c — extern f32 lbl_804DA5C8 (no definition anywhere) is
    # the self-TU extern cheat.
    ("extern_f32_gm1832.patch", "self_tu_extern", "src/melee/gm/gm_1832.c", (1270, 1290)),
    # #2656 gm_1832.c:1919 — extern const f32 lbl_804DA60C plus a brand-new
    # in-file definition (line 2708): the symbol does not exist in base, so
    # this invents a data anchor to force data ordering. PsiLupan: "Using an
    # extern to make a function match is just due to data ordering."
    ("extern_f32_gm1832.patch", "new_data_anchor", "src/melee/gm/gm_1832.c", (1915, 1925)),
    # #2656 gm_1832.c:2387 — open-coded assert.
    ("unrolled_assert_gm1832.patch", "unrolled_assert", "src/melee/gm/gm_1832.c", (2384, 2393)),
    # #2657 grkongo.c:1580 — extern const f32 grKg_804DAFA0/A4 in own .sdata2.
    ("extern_floats_grkongo.patch", "self_tu_extern", "src/melee/gr/grkongo.c", (98, 106)),
    # #2657 grkongo.c:662 — string literal replaced by char symbol address.
    ("extern_char_grkongo.patch", "string_literal_to_symbol", "src/melee/gr/grkongo.c", (655, 670)),
    # #2658 tydisplay.c — extern char un_803FF074[0xA8] string anchor.
    ("extern_string_tydisplay.patch", "extern_literal_anchor", "src/melee/ty/tydisplay.c", (137, 145)),
    # #2658 tydisplay.c:1000 — OSReport literal replaced by symbol.
    ("extern_string_tydisplay.patch", "string_literal_to_symbol", "src/melee/ty/tydisplay.c", (1000, 1010)),
    # #2658 mncount.c:782 — packed string blob + offset macros.
    ("string_blob_mncount.patch", "packed_string_blob", "src/melee/mn/mncount.c", (779, 800)),
    # #2659 particle.c:1019 — packed string blob (the tombstone case).
    ("string_blob_particle.patch", "packed_string_blob", "src/sysdolphin/baselib/particle.c", (1016, 1025)),
    # #2657 gricemt.c:1482 — HSD_ASSERT unrolled into raw __assert.
    ("unrolled_assert_gricemt.patch", "unrolled_assert", "src/melee/gr/gricemt.c", (1479, 1492)),
]


@pytest.mark.parametrize("fixture,rule_id,file,line_range", GOLDEN_CASES)
def test_golden_fixture_hard_fails(melee_checkout, fixture, rule_id, file, line_range):
    exit_code, payload = run_scan_diff(melee_checkout, fixture)
    assert exit_code == 1, f"expected gate failure, got {exit_code}: {payload['counts']}"
    assert payload["status"] == "failed"
    matches = [
        f
        for f in payload["findings"]
        if f["rule_id"] == rule_id
        and f["file"] == file
        and line_range[0] <= f["line"] <= line_range[1]
    ]
    assert matches, (
        f"no {rule_id} finding in {file}:{line_range}; findings: "
        + json.dumps(payload["findings"], indent=2)
    )
    assert all(f["severity"] == "error" for f in matches)
    assert all(f["message"] for f in matches)


def test_contract_shape(melee_checkout):
    exit_code, payload = run_scan_diff(melee_checkout, "string_blob_particle.patch")
    assert exit_code == 1
    assert payload["tool"] == "review_lint"
    assert payload["operation"] == "review_lint:scan_diff"
    assert payload["status"] in {"passed", "warned", "failed"}
    assert payload["base"] is None  # diff-file mode
    assert isinstance(payload["repo"], str)
    assert set(payload["counts"]) == {"errors", "warnings"}
    for finding in payload["findings"]:
        for key in ("rule_id", "severity", "file", "line", "excerpt", "message"):
            assert key in finding
        assert "standard_id" in finding


def test_negative_ftcoll_style_note_is_clean(melee_checkout):
    """#2655 ftcoll.c: extern forward decls whose definitions PRE-EXISTED in
    the base file (moved later within the TU) are the accepted style; the
    gate must produce zero error findings."""

    exit_code, payload = run_scan_diff(melee_checkout, "sdata2_decl_ftcoll.patch")
    assert payload["counts"]["errors"] == 0, json.dumps(payload["findings"], indent=2)
    assert exit_code in (0, 2)
    assert exit_code == 0, "ftcoll externs should be fully downgraded (forward_decl_ok)"


def test_gm1832_new_data_anchor_detail(melee_checkout):
    """The invented lbl_804DA60C anchor carries the new_data_anchor verdict
    and the maintainer's data-ordering wording."""

    exit_code, payload = run_scan_diff(melee_checkout, "extern_f32_gm1832.patch")
    assert exit_code == 1
    anchors = [f for f in payload["findings"] if f["rule_id"] == "new_data_anchor"]
    assert len(anchors) == 1, json.dumps(payload["findings"], indent=2)
    finding = anchors[0]
    assert finding["severity"] == "error"
    assert finding["file"] == "src/melee/gm/gm_1832.c"
    assert finding["detail"]["symbol"] == "lbl_804DA60C"
    assert finding["detail"]["verdict"] == "new_data_anchor"
    assert finding["standard_id"] == "global_standard:literals-and-data-ownership"
    assert "data order" in finding["message"]
    # The pre-existing lbl_804DA5C8 self-TU extern must still be flagged.
    assert any(f["rule_id"] == "self_tu_extern" for f in payload["findings"])


def test_negative_cross_tu_extern_stays_warning(melee_checkout):
    exit_code, payload = run_scan_diff(melee_checkout, "cross_tu_extern_ok.patch")
    assert payload["counts"]["errors"] == 0, json.dumps(payload["findings"], indent=2)
    assert exit_code == 2
    warnings = [f for f in payload["findings"] if f["severity"] == "warning"]
    assert warnings and warnings[0]["rule_id"] == "extern_literal_anchor"
    assert warnings[0]["detail"]["verdict"] == "cross_tu_ok"


def test_negative_real_string_table(melee_checkout):
    exit_code, payload = run_scan_diff(melee_checkout, "real_string_table.patch")
    assert exit_code == 0
    assert payload["findings"] == []


def test_negative_assert_macro_header(melee_checkout):
    exit_code, payload = run_scan_diff(melee_checkout, "assert_macro_header.patch")
    assert exit_code == 0
    assert payload["findings"] == []


# ---------------------------------------------------------------------------
# Base-presence inference helper (symbol_in_diff_base / symbol_existed_in_base).
# ---------------------------------------------------------------------------

import scan_diff  # noqa: E402  (conftest puts api/ on sys.path)

INFERENCE_DIFF = """\
diff --git a/src/melee/gm/x.c b/src/melee/gm/x.c
index 1111111..2222222 100644
--- a/src/melee/gm/x.c
+++ b/src/melee/gm/x.c
@@ -10,3 +10,4 @@ void caller(void)
 static int keep_ctx;
-const f32 lbl_80400000 = 0.5f;
+extern const f32 lbl_80400000;
+extern const f32 lbl_80400004;
 use(lbl_80400008);
"""


def test_symbol_in_diff_base_inference():
    file_diffs = scan_diff.parse_unified_diff(INFERENCE_DIFF)
    rel = "src/melee/gm/x.c"
    # Appears in a removed line -> existed in base (moved definition).
    assert scan_diff.symbol_in_diff_base(file_diffs, rel, "lbl_80400000")
    # Appears only in added lines -> new in this diff.
    assert not scan_diff.symbol_in_diff_base(file_diffs, rel, "lbl_80400004")
    # Appears in a context line -> existed in base.
    assert scan_diff.symbol_in_diff_base(file_diffs, rel, "lbl_80400008")
    assert scan_diff.symbol_in_diff_base(file_diffs, rel, "keep_ctx")
    # Word-boundary match: substrings of longer identifiers do not count.
    assert not scan_diff.symbol_in_diff_base(file_diffs, rel, "lbl_8040000")
    # Unknown file -> not present.
    assert not scan_diff.symbol_in_diff_base(file_diffs, "src/other.c", "lbl_80400000")


def test_symbol_existed_in_base_diff_mode_uses_inference(melee_checkout):
    file_diffs = scan_diff.parse_unified_diff(INFERENCE_DIFF)
    rel = "src/melee/gm/x.c"
    cache: dict[str, str | None] = {}
    assert scan_diff.symbol_existed_in_base(
        melee_checkout, rel, "lbl_80400000", "diff", file_diffs, None, cache
    )
    assert not scan_diff.symbol_existed_in_base(
        melee_checkout, rel, "lbl_80400004", "diff", file_diffs, None, cache
    )
    assert cache == {}  # diff mode never consults git


def test_symbol_existed_in_base_ref_mode_prefers_git_show(melee_checkout):
    # Real file at the known base sha: lbl_804DA60C is absent from the base
    # gm_1832.c, while gm_80188454 exists there.
    base = "0b15e713"
    rel = "src/melee/gm/gm_1832.c"
    cache: dict[str, str | None] = {}
    assert scan_diff.symbol_existed_in_base(
        melee_checkout, rel, "gm_80188454", "head", [], base, cache
    )
    assert not scan_diff.symbol_existed_in_base(
        melee_checkout, rel, "lbl_804DA60C", "head", [], base, cache
    )
    assert rel in cache and cache[rel]  # git show result cached
    # Missing base blob falls back to diff inference (empty diff -> False).
    assert not scan_diff.symbol_existed_in_base(
        melee_checkout, "src/does/not/exist.c", "anything", "head", [], base, cache
    )
