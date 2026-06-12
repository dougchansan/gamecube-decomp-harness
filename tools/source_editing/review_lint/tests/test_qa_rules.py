"""Unit tests for the shared QA rules module (_qa_rules)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import conftest  # noqa: F401  (inserts api/ into sys.path)
import _qa_rules


# ---------------------------------------------------------------------------
# Address-style name regex.
# ---------------------------------------------------------------------------


def test_address_name_regex_matches_known_symbols():
    for name in ("lbl_804DA60C", "ftColl_804D82E0", "un_803FF074", "grKg_803E1A00"):
        assert _qa_rules.ADDRESS_NAME_RE.search(name), name
        assert _qa_rules.address_from_name(name) is not None


def test_address_name_regex_rejects_non_address_names():
    for name in ("foo_12345678", "lbl_8123", "bar_9ABCDEF0", "lbl_804DA60", "x804DA60C"):
        assert _qa_rules.address_from_name(name) is None, name


def test_address_from_name_value():
    assert _qa_rules.address_from_name("lbl_804DA60C") == 0x804DA60C


# ---------------------------------------------------------------------------
# extern_literal_anchor declaration regex.
# ---------------------------------------------------------------------------


def _externs(text: str):
    hunk = {
        "file": "src/melee/gm/x.c",
        "added": [(i + 1, line) for i, line in enumerate(text.splitlines())],
        "removed": [],
    }
    return _qa_rules.check_extern_literal_anchor(hunk)


def test_extern_decl_both_const_orders_and_arrays():
    findings = _externs(
        "extern const f32 lbl_804DA60C;\n"
        "extern float const ftColl_804D82E0;\n"
        "extern f32 lbl_804DA5C8;\n"
        "extern char un_803FF074[0xA8];\n"
    )
    assert len(findings) == 4
    severities = {f["detail"]["symbol"]: f["severity"] for f in findings}
    assert severities["lbl_804DA60C"] == "warning"
    assert severities["ftColl_804D82E0"] == "warning"
    assert severities["un_803FF074"] == "error"


def test_extern_decl_ignores_initializers_and_other_types():
    findings = _externs(
        "extern const f32 lbl_804DA60C = 1.0f;\n"  # initializer -> not a pure anchor
        "extern ClassicStageEntry lbl_803D9910[65];\n"  # struct type -> ignored
        "const f32 lbl_804DA60C = 1.0f;\n"  # definition, not extern
    )
    assert findings == []


# ---------------------------------------------------------------------------
# packed_string_blob.
# ---------------------------------------------------------------------------


def _blob_findings(text: str):
    hunk = {
        "file": "src/melee/mn/x.c",
        "added": [(i + 1, line) for i, line in enumerate(text.splitlines())],
        "removed": [],
    }
    return _qa_rules.check_packed_string_blob(hunk)


def test_packed_blob_concatenated_literals():
    text = (
        'static char lbl_803EFB60[0xA8] =\n'
        '    "Can\'t get user_data.\\n\\0\\0\\0"\n'
        '    "mncount.c\\0\\0\\0"\n'
        '    "user_data\\0\\0\\0";\n'
    )
    findings = _blob_findings(text)
    assert len(findings) == 1
    assert findings[0]["detail"]["symbol"] == "lbl_803EFB60"
    assert findings[0]["line"] == 1


def test_packed_blob_single_literal_with_multiple_nuls():
    text = 'char un_803FEFF0[0x2C] = "ToyDspPanel_Top_joint\\0\\0\\0ToyDspBg_Top_joint";\n'
    assert len(_blob_findings(text)) == 1


def test_packed_blob_pointer_offset_macro():
    findings = _blob_findings("#define mnCount_AssertFile (lbl_803EFB60 + 0x18)\n")
    assert len(findings) == 1
    assert findings[0]["detail"]["symbol"] == "lbl_803EFB60"


def test_packed_blob_negatives():
    assert _blob_findings('static char buf[64] = "ready";\n') == []
    assert (
        _blob_findings('static char* const names[] = { "a", "b", "c" };\n') == []
    )
    # Offset macro over a non-address-style base is not the cheat.
    assert _blob_findings("#define NEXT (cursor + 0x18)\n") == []


# ---------------------------------------------------------------------------
# unrolled_assert.
# ---------------------------------------------------------------------------


def _assert_findings(text: str, path: str = "src/melee/gr/x.c"):
    hunk = {
        "file": path,
        "added": [(i + 1, line) for i, line in enumerate(text.splitlines())],
        "removed": [],
    }
    return _qa_rules.check_unrolled_assert(hunk)


def test_unrolled_assert_flags_call_sites():
    findings = _assert_findings('        __assert(grIm_803E46F8, 0xAB9, "mgobj");\n')
    assert len(findings) == 1


def test_unrolled_assert_skips_macro_definitions():
    text = (
        "#define HSD_ASSERT(line, cond)                                       \\\n"
        "    ((cond) ? ((void) 0) : __assert(__FILE__, line, #cond))\n"
    )
    # Line 1 is a #define, line 2... is a continuation body without trailing
    # backslash but the #define line itself is skipped; single-line macro:
    findings = _assert_findings('#define MY_ASSERT(c) __assert(__FILE__, 1, #c)\n')
    assert findings == []
    # Continuation lines (ending in backslash) are skipped.
    findings = _assert_findings(
        "    ((cond) ? ((void) 0) : __assert(__FILE__, line, #cond)) \\\n"
    )
    assert findings == []


def test_unrolled_assert_ignores_strings():
    findings = _assert_findings('OSReport("call __assert(x) yourself\\n");\n')
    assert findings == []


# ---------------------------------------------------------------------------
# string_literal_to_symbol.
# ---------------------------------------------------------------------------


def test_string_literal_to_symbol_pairing():
    hunk = {
        "file": "src/melee/gr/grkongo.c",
        "added": [(662, '        __assert(grKg_803E1858, 1719, grKg_803E1A00);')],
        "removed": ['        __assert(grKg_803E1858, 1719, "gp->u.taru.keep");'],
    }
    findings = _qa_rules.check_string_literal_to_symbol(hunk)
    assert len(findings) == 1
    assert findings[0]["detail"]["replacement"] == "grKg_803E1A00"


def test_string_literal_to_symbol_offset_expression():
    hunk = {
        "file": "src/melee/ty/tydisplay.c",
        "added": [(1401, "        OSReport(strbase + 0xC8);")],
        "removed": ['        OSReport("*** BG data aren\'t being loaded!\\n");'],
    }
    findings = _qa_rules.check_string_literal_to_symbol(hunk)
    assert len(findings) == 1


def test_string_literal_to_symbol_requires_string_in_removed():
    hunk = {
        "file": "src/melee/gm/gm_1832.c",
        "added": [(10, "    foo(lbl_804DA60C);")],
        "removed": ["    foo(other_value);"],
    }
    assert _qa_rules.check_string_literal_to_symbol(hunk) == []


# ---------------------------------------------------------------------------
# Shingles + similarity.
# ---------------------------------------------------------------------------

BLOB_A = (
    'static char lbl_8040A540[0x268] =\n'
    '    "MCC is no initialize\\0\\0\\0\\0"\n'
    '    "No responce\\0"\n'
    '    "PING error\\0\\0"\n'
    '    "Could not initialize HIO\\0\\0\\0\\0";\n'
)
# Same blob with every identifier renamed (and a different hex size).
BLOB_B = (
    'static char renamed_blob[0x300] =\n'
    '    "MCC is no initialize\\0\\0\\0\\0"\n'
    '    "No responce\\0"\n'
    '    "PING error\\0\\0"\n'
    '    "Could not initialize HIO\\0\\0\\0\\0";\n'
)
UNRELATED = (
    "int gm_80188454(int idx)\n"
    "{\n"
    "    if (idx < 0) {\n"
    "        return -1;\n"
    "    }\n"
    "    return lbl_803D9910[idx].stage_kind;\n"
    "}\n"
)


def test_shingles_identifier_rename_is_similar():
    a = _qa_rules.normalized_shingles(BLOB_A)
    b = _qa_rules.normalized_shingles(BLOB_B)
    assert _qa_rules.shingle_similarity(a, b) >= 0.9


def test_shingles_unrelated_code_is_dissimilar():
    a = _qa_rules.normalized_shingles(BLOB_A)
    c = _qa_rules.normalized_shingles(UNRELATED)
    assert _qa_rules.shingle_similarity(a, c) < 0.3


def test_shingle_similarity_edges():
    assert _qa_rules.shingle_similarity(set(), set()) == 1.0
    assert _qa_rules.shingle_similarity({"a"}, set()) == 0.0
    assert _qa_rules.shingle_similarity({"a"}, {"a"}) == 1.0


def test_shingles_cli(tmp_path: Path):
    src = tmp_path / "blob.c"
    src.write_text(BLOB_A, encoding="utf-8")
    result = subprocess.run(
        [
            "python3",
            str(Path(_qa_rules.__file__)),
            "--shingles-from-file",
            str(src),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert set(payload["shingles"]) == _qa_rules.normalized_shingles(BLOB_A)


# ---------------------------------------------------------------------------
# Banned-pattern loader (env override).
# ---------------------------------------------------------------------------


def test_load_banned_pattern_rules_env_override(tmp_path: Path, monkeypatch):
    record = {
        "id": "no-osreport-offset",
        "source_pr": "doldecomp/melee#2658",
        "comment_url": "https://github.com/doldecomp/melee/pull/2658#discussion_r1",
        "file": "src/melee/ty/tydisplay.c",
        "excerpt": "OSReport(strbase + 0xC8);",
        "standard_id": "global_standard:no-string-literal-symbol-regression",
        "detector": {"type": "regex", "pattern": r"OSReport\(\w+ \+ 0x[0-9A-Fa-f]+\)"},
        "created": "2026-06-11",
    }
    skipped = {**record, "id": "exhibit-only", "detector": {"type": "agent_exhibit"}}
    (tmp_path / "banned.jsonl").write_text(
        json.dumps(record) + "\n" + json.dumps(skipped) + "\n", encoding="utf-8"
    )
    monkeypatch.setenv(_qa_rules.BANNED_DIR_ENV, str(tmp_path))
    rules = _qa_rules.load_banned_pattern_rules()
    assert len(rules) == 1
    assert rules[0]["rule_id"] == "banned_pattern:no-osreport-offset"
    assert rules[0]["severity"] == "error"
    assert "discussion_r1" in rules[0]["message"]
    hunk = {
        "file": "src/melee/ty/tydisplay.c",
        "added": [(5, "    OSReport(strbase + 0xC8);")],
        "removed": [],
    }
    findings = _qa_rules.run_rules_on_hunk(rules, hunk)
    assert len(findings) == 1


def test_loaders_tolerate_missing_files(tmp_path: Path, monkeypatch):
    monkeypatch.setenv(_qa_rules.BANNED_DIR_ENV, str(tmp_path / "nope"))
    assert _qa_rules.load_banned_pattern_rules() == []
    assert _qa_rules.load_tombstones() == []
