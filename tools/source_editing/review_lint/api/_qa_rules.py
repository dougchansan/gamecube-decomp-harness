#!/usr/bin/env python3
"""Shared QA ship-gate rules for review_lint.

Implements the deterministic maintainer-rejection rules from the QA ship
gate plan (docs/30-plans/2026-06-11-qa-ship-gate-and-pr-review-wiring.md):

- ``extern_literal_anchor``: added ``extern`` declarations that anchor a
  literal by address-style name (``lbl_804DA60C``-shaped).
- ``string_literal_to_symbol``: a string literal argument replaced by a data
  symbol or pointer-offset expression within the same hunk.
- ``packed_string_blob``: hand-packed ``\\0``-padded string blobs and
  pointer-offset ``#define`` macros over address-style symbols.
- ``unrolled_assert``: open-coded ``__assert``/``__assert_msg`` call sites
  where the source idiom is ``HSD_ASSERT*``.
- data-driven banned-pattern rules loaded from
  ``knowledge/sources/injectable/banned_patterns/data/banned.jsonl``.
- resubmission tombstones (fuzzy token-shingle hashes of previously rejected
  hunks) loaded from ``.../banned_patterns/data/tombstones.jsonl``.

The module is shared by ``scan.py`` (whole-file advisory mode) and
``scan_diff.py`` (diff-aware gate mode).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from fnmatch import fnmatch
from pathlib import Path
from typing import Any, Callable

# Orchestrator repository root: tools/source_editing/review_lint/api/ -> up 4.
ORCHESTRATOR_ROOT = Path(__file__).resolve().parents[4]
BANNED_DIR_ENV = "REVIEW_LINT_BANNED_DIR"
DEFAULT_BANNED_DIR = (
    ORCHESTRATOR_ROOT / "knowledge" / "sources" / "injectable" / "banned_patterns" / "data"
)

DEFAULT_APPLIES_TO = ["src/**/*.c"]

# Identifier ending in an encoded address: lbl_804DA60C, ftColl_804D82E0,
# un_803FF074, grKg_803E1A00, ...
ADDRESS_NAME_RE = re.compile(r"\b[A-Za-z_]\w*_8[0-9A-Fa-f]{7}\b")
ADDRESS_SUFFIX_RE = re.compile(r"_(8[0-9A-Fa-f]{7})$")

FLOAT_TYPES = {"f32", "f64", "float", "double"}
STRING_TYPES = {"char", "u8"}

# `extern [const] <type> [const] name[optional array];` with NO initializer.
EXTERN_DECL_RE = re.compile(
    r"^\s*extern\s+(?:(?:const|volatile)\s+)*"
    r"(?P<ctype>f32|f64|float|double|char|u8)\b"
    r"(?:\s+(?:const|volatile))*"
    r"\s+(?P<name>[A-Za-z_]\w*_8[0-9A-Fa-f]{7})"
    r"\s*(?P<array>\[[^\]]*\])?\s*;\s*$"
)

# `static char name[0xNN] =` (blob declarations; `char*` tables do not match).
BLOB_DECL_RE = re.compile(
    r"(?:static\s+)?(?:unsigned\s+)?char\s+(?P<name>[A-Za-z_]\w*)"
    r"\s*\[\s*(?:0[xX][0-9A-Fa-f]+|\d+)\s*\]\s*="
)
STRING_LIT_RE = re.compile(r'"(?:\\.|[^"\\])*"')

# `#define NAME (lbl_8XXXXXXX + 0xNN)` pointer-offset macro.
PTR_OFFSET_DEFINE_RE = re.compile(
    r"^\s*#\s*define\s+\w+\s+\(?\s*"
    r"(?P<base>[A-Za-z_]\w*_8[0-9A-Fa-f]{7})\s*\+\s*0[xX][0-9A-Fa-f]+\s*\)?\s*$"
)

ASSERT_CALL_RE = re.compile(r"\b__assert(?:_msg)?\s*\(")

# `ident + 0xNN` offset expression (string-table pointer arithmetic).
OFFSET_EXPR_RE = re.compile(r"\b(?P<base>[A-Za-z_]\w*)\s*\+\s*0[xX][0-9A-Fa-f]+\b")

# Files where a raw __assert call is legitimately allowed. Macro-definition
# headers (src/sysdolphin/baselib/debug.h etc.) are already excluded because
# the rules only apply to .c files; macro-continuation lines inside .c files
# are skipped structurally, so the allowlist starts empty.
ASSERT_ALLOWLIST: list[str] = []

STANDARD_TITLES = {
    "global_standard:literals-and-data-ownership": (
        "Keep literals inline unless data ownership evidence says otherwise"
    ),
    "global_standard:no-string-literal-symbol-regression": (
        "Do not replace string literals with data symbols"
    ),
    "global_standard:assert-report-macros": (
        "Use project assert/report macros (HSD_ASSERT*) when they represent the source"
    ),
}

C_KEYWORDS = {
    "auto", "break", "case", "char", "const", "continue", "default", "do",
    "double", "else", "enum", "extern", "float", "for", "goto", "if",
    "inline", "int", "long", "register", "return", "short", "signed",
    "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned",
    "void", "volatile", "while",
    # Common decomp typedefs kept as keywords so renames don't dodge shingles.
    "u8", "u16", "u32", "u64", "s8", "s16", "s32", "s64", "f32", "f64",
    "bool", "size_t", "define", "include",
}

TOKEN_RE = re.compile(
    r'"(?:\\.|[^"\\])*"'          # string literal (contents kept verbatim)
    r"|'(?:\\.|[^'\\])*'"         # char literal
    r"|[A-Za-z_]\w*"              # identifier / keyword
    r"|0[xX][0-9A-Fa-f]+"         # hex literal
    r"|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFlLuU]*"  # numeric literal
    r"|\S"                        # punctuation
)


def strip_comments_and_strings(src: str) -> str:
    """Replace comments and string/char literals with spaces, preserving lines."""

    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            end = src.find("\n", i)
            if end < 0:
                end = n
            for k in range(i, end):
                out[k] = " "
            i = end
        elif c == "/" and nxt == "*":
            end = src.find("*/", i + 2)
            end = n if end < 0 else end + 2
            for k in range(i, end):
                if src[k] != "\n":
                    out[k] = " "
            i = end
        elif c in {'"', "'"}:
            quote = c
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\" and i + 1 < n:
                    if src[i] != "\n":
                        out[i] = " "
                    if src[i + 1] != "\n":
                        out[i + 1] = " "
                    i += 2
                else:
                    if src[i] != "\n":
                        out[i] = " "
                    i += 1
            if i < n:
                i += 1
        else:
            i += 1
    return "".join(out)


def blank_line(line: str) -> str:
    """Blank string/char literals and comments on a single line."""

    return strip_comments_and_strings(line)


def address_from_name(name: str) -> int | None:
    """Parse the encoded address from an address-style symbol name."""

    match = ADDRESS_SUFFIX_RE.search(name)
    if not match:
        return None
    return int(match.group(1), 16)


def path_matches(path: str | None, patterns: list[str]) -> bool:
    """Return whether a repo-relative path matches any glob pattern."""

    if path is None:
        return True
    normalized = path.replace("\\", "/").lstrip("./")
    return any(fnmatch(normalized, pattern) for pattern in patterns)


# ---------------------------------------------------------------------------
# Rule check implementations. Each receives a hunk dict:
#   {"file": str | None,
#    "added": [(new_lineno, text), ...],
#    "removed": [text, ...]}
# and returns partial findings: {"line", "excerpt", optional overrides}.
# ---------------------------------------------------------------------------


def check_extern_literal_anchor(hunk: dict[str, Any]) -> list[dict[str, Any]]:
    """Flag added extern declarations of literal-bearing types with address names."""

    findings: list[dict[str, Any]] = []
    for lineno, text in hunk["added"]:
        match = EXTERN_DECL_RE.match(text)
        if not match:
            continue
        ctype = match.group("ctype")
        name = match.group("name")
        address = address_from_name(name)
        detail = {
            "symbol": name,
            "ctype": ctype,
            "address": f"0x{address:08X}" if address is not None else None,
        }
        if ctype in STRING_TYPES:
            standard = "global_standard:no-string-literal-symbol-regression"
            findings.append(
                {
                    "line": lineno,
                    "excerpt": text.strip(),
                    "severity": "error",
                    "standard_id": standard,
                    "message": (
                        f"Added `extern {ctype} {name}` anchors string data by address "
                        f"instead of keeping the literal inline. {STANDARD_TITLES[standard]}."
                    ),
                    "detail": detail,
                }
            )
        else:
            standard = "global_standard:literals-and-data-ownership"
            findings.append(
                {
                    "line": lineno,
                    "excerpt": text.strip(),
                    "severity": "warning",
                    "standard_id": standard,
                    "message": (
                        f"Added `extern {ctype} {name}` with no initializer anchors a "
                        f"literal by address. {STANDARD_TITLES[standard]} (ownership "
                        "check decides whether this is a self-TU dodge)."
                    ),
                    "detail": detail,
                }
            )
    return findings


def _symbol_candidates(blanked: str) -> list[tuple[int, str]]:
    """Return (start_offset, candidate_text) symbol-ish argument candidates."""

    candidates: list[tuple[int, str]] = []
    for match in ADDRESS_NAME_RE.finditer(blanked):
        candidates.append((match.start(), match.group(0)))
    for match in OFFSET_EXPR_RE.finditer(blanked):
        candidates.append((match.start(), match.group(0)))
    candidates.sort(key=lambda item: item[0])
    return candidates


def _normalize_ws(text: str) -> str:
    return " ".join(text.split())


def check_string_literal_to_symbol(hunk: dict[str, Any]) -> list[dict[str, Any]]:
    """Detect string-literal arguments replaced by symbols/offset expressions.

    Conservative paired-line analysis: an added line containing an
    address-style identifier or `ident + 0xNN` expression inside a call's
    argument list matches a removed line in the same hunk with the same call
    prefix where that argument position held a string literal.
    """

    findings: list[dict[str, Any]] = []
    removed_norm = [_normalize_ws(line) for line in hunk["removed"]]
    if not removed_norm:
        return findings
    for lineno, text in hunk["added"]:
        blanked = blank_line(text)
        matched = False
        for start, candidate in _symbol_candidates(blanked):
            prefix = text[:start]
            # Candidate must sit inside an open call argument list.
            if "(" not in prefix or prefix.count("(") <= prefix.count(")"):
                continue
            norm_prefix = _normalize_ws(prefix)
            if not norm_prefix:
                continue
            for norm_removed in removed_norm:
                if not norm_removed.startswith(norm_prefix):
                    continue
                remainder = norm_removed[len(norm_prefix):].lstrip()
                if remainder.startswith('"'):
                    standard = "global_standard:no-string-literal-symbol-regression"
                    findings.append(
                        {
                            "line": lineno,
                            "excerpt": text.strip(),
                            "message": (
                                f"String literal argument replaced by `{candidate.strip()}`. "
                                f"{STANDARD_TITLES[standard]}."
                            ),
                            "detail": {"replacement": candidate.strip()},
                        }
                    )
                    matched = True
                    break
            if matched:
                break
    return findings


def check_packed_string_blob(hunk: dict[str, Any]) -> list[dict[str, Any]]:
    """Detect hand-packed string blobs and pointer-offset #define macros."""

    findings: list[dict[str, Any]] = []
    standard = "global_standard:no-string-literal-symbol-regression"
    added = hunk["added"]

    # Signal (a): char array declaration whose initializer concatenates
    # string literals with \0 padding (possibly spanning multiple lines).
    block = "\n".join(text for _, text in added)
    line_starts: list[int] = []
    offset = 0
    for _, text in added:
        line_starts.append(offset)
        offset += len(text) + 1
    for match in BLOB_DECL_RE.finditer(block):
        tail = block[match.end():]
        literals = []
        pos = 0
        while True:
            stripped = tail[pos:].lstrip()
            consumed = len(tail) - pos - len(stripped)
            lit = STRING_LIT_RE.match(stripped)
            if not lit:
                break
            literals.append(lit.group(0))
            pos += consumed + lit.end()
        zero_escapes = sum(lit.count("\\0") for lit in literals)
        if (len(literals) >= 2 and zero_escapes >= 1) or (
            len(literals) == 1 and zero_escapes >= 2
        ):
            index = max(
                i for i, start in enumerate(line_starts) if start <= match.start()
            )
            findings.append(
                {
                    "line": added[index][0],
                    "excerpt": added[index][1].strip(),
                    "message": (
                        f"Hand-packed string blob `{match.group('name')}` concatenates "
                        f"{len(literals)} literal(s) with {zero_escapes} \\0 padding "
                        f"escapes. {STANDARD_TITLES[standard]}."
                    ),
                    "detail": {
                        "symbol": match.group("name"),
                        "literal_count": len(literals),
                        "zero_escapes": zero_escapes,
                    },
                }
            )

    # Signal (b): pointer-offset macro over an address-style symbol.
    for lineno, text in added:
        match = PTR_OFFSET_DEFINE_RE.match(text)
        if match:
            findings.append(
                {
                    "line": lineno,
                    "excerpt": text.strip(),
                    "message": (
                        f"Pointer-offset macro over packed data symbol "
                        f"`{match.group('base')}`. {STANDARD_TITLES[standard]}."
                    ),
                    "detail": {"symbol": match.group("base")},
                }
            )
    return findings


def check_unrolled_assert(hunk: dict[str, Any]) -> list[dict[str, Any]]:
    """Detect open-coded __assert/__assert_msg call sites on added lines."""

    findings: list[dict[str, Any]] = []
    standard = "global_standard:assert-report-macros"
    path = hunk.get("file")
    if path is not None and path_matches(path, ASSERT_ALLOWLIST):
        return findings
    for lineno, text in hunk["added"]:
        # Skip macro definitions and continuation lines.
        if re.search(r"\\\s*$", text) or re.search(r"^\s*#\s*define\b", text):
            continue
        if ASSERT_CALL_RE.search(blank_line(text)):
            findings.append(
                {
                    "line": lineno,
                    "excerpt": text.strip(),
                    "message": (
                        "Open-coded __assert call; the source idiom is HSD_ASSERT / "
                        "HSD_ASSERTMSG (or the inline helper containing it). "
                        f"{STANDARD_TITLES[standard]}."
                    ),
                }
            )
    return findings


RULES: list[dict[str, Any]] = [
    {
        "rule_id": "extern_literal_anchor",
        "severity": "warning",
        "standard_id": "global_standard:literals-and-data-ownership",
        "check": check_extern_literal_anchor,
        "message": "Added extern declaration anchors a literal by address.",
        "applies_to": DEFAULT_APPLIES_TO,
    },
    {
        "rule_id": "string_literal_to_symbol",
        "severity": "error",
        "standard_id": "global_standard:no-string-literal-symbol-regression",
        "check": check_string_literal_to_symbol,
        "message": "String literal replaced by a data symbol.",
        "applies_to": DEFAULT_APPLIES_TO,
    },
    {
        "rule_id": "packed_string_blob",
        "severity": "error",
        "standard_id": "global_standard:no-string-literal-symbol-regression",
        "check": check_packed_string_blob,
        "message": "Hand-packed string blob or pointer-offset macro.",
        "applies_to": DEFAULT_APPLIES_TO,
    },
    {
        "rule_id": "unrolled_assert",
        "severity": "error",
        "standard_id": "global_standard:assert-report-macros",
        "check": check_unrolled_assert,
        "message": "Open-coded __assert call.",
        "applies_to": ["src/melee/**/*.c", "src/sysdolphin/**/*.c"],
    },
]


# ---------------------------------------------------------------------------
# Banned patterns + tombstones (external data-driven rules).
# ---------------------------------------------------------------------------


def banned_dir() -> Path:
    """Resolve the banned-pattern data directory (env-overridable for tests)."""

    override = os.environ.get(BANNED_DIR_ENV)
    if override:
        return Path(override)
    return DEFAULT_BANNED_DIR


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            records.append(record)
    return records


def load_banned_pattern_rules() -> list[dict[str, Any]]:
    """Load regex-type banned-pattern records as additional rules."""

    rules: list[dict[str, Any]] = []
    for record in _read_jsonl(banned_dir() / "banned.jsonl"):
        detector = record.get("detector") or {}
        if detector.get("type") != "regex" or not detector.get("pattern"):
            continue
        try:
            pattern = re.compile(detector["pattern"])
        except re.error:
            continue
        comment_url = record.get("comment_url") or "<no comment url>"
        rules.append(
            {
                "rule_id": f"banned_pattern:{record.get('id', 'unknown')}",
                "severity": "error",
                "standard_id": record.get("standard_id"),
                "pattern": pattern,
                "message": (
                    f"Matches maintainer-banned pattern from "
                    f"{record.get('source_pr', 'a past PR')} ({comment_url})."
                ),
                "applies_to": DEFAULT_APPLIES_TO,
                "detail": {
                    "banned_id": record.get("id"),
                    "comment_url": record.get("comment_url"),
                    "source_pr": record.get("source_pr"),
                },
            }
        )
    return rules


def load_tombstones() -> list[dict[str, Any]]:
    """Load resubmission tombstones (missing file -> empty list)."""

    return [
        record
        for record in _read_jsonl(banned_dir() / "tombstones.jsonl")
        if record.get("shingles")
    ]


def normalized_shingles(text: str) -> set[str]:
    """Build normalized 4-token shingle hashes for fuzzy hunk matching.

    Identifiers normalize to "ID" and numeric literals to "NUM"; string
    literal contents are kept verbatim (the packed data is the signal);
    keywords and punctuation are kept.
    """

    tokens: list[str] = []
    for match in TOKEN_RE.finditer(text):
        token = match.group(0)
        if token.startswith('"') or token.startswith("'"):
            tokens.append(token)
        elif re.match(r"^[A-Za-z_]", token):
            tokens.append(token if token in C_KEYWORDS else "ID")
        elif re.match(r"^(?:0[xX][0-9A-Fa-f]+|\d)", token):
            tokens.append("NUM")
        else:
            tokens.append(token)
    shingles: set[str] = set()
    for i in range(len(tokens) - 3):
        joined = " ".join(tokens[i : i + 4])
        shingles.add(hashlib.md5(joined.encode("utf-8")).hexdigest()[:8])
    return shingles


def shingle_similarity(a: set[str], b: set[str]) -> float:
    """Jaccard similarity between two shingle sets."""

    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


MIN_TOMBSTONE_TOKENS = 12


def check_tombstones(
    hunk: dict[str, Any], tombstones: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Compare a hunk's added lines against resubmission tombstones."""

    findings: list[dict[str, Any]] = []
    if not tombstones or not hunk["added"]:
        return findings
    added_text = "\n".join(text for _, text in hunk["added"])
    if len(TOKEN_RE.findall(added_text)) < MIN_TOMBSTONE_TOKENS:
        return findings
    shingles = normalized_shingles(added_text)
    if not shingles:
        return findings
    for record in tombstones:
        threshold = float(record.get("threshold") or 0.7)
        similarity = shingle_similarity(shingles, set(record["shingles"]))
        if similarity < threshold:
            continue
        comment_url = record.get("comment_url") or "<no comment url>"
        first_line, first_text = hunk["added"][0]
        findings.append(
            {
                "rule_id": "resubmission_tombstone",
                "severity": "error",
                "line": first_line,
                "excerpt": first_text.strip(),
                "standard_id": record.get("standard_id"),
                "message": (
                    f"Hunk is {similarity:.0%} similar to a change a maintainer "
                    f"already rejected on {record.get('source_pr', 'a past PR')}; "
                    f"do not resubmit it. Original rejection: {comment_url}"
                ),
                "detail": {
                    "tombstone_id": record.get("id"),
                    "source_pr": record.get("source_pr"),
                    "comment_url": record.get("comment_url"),
                    "similarity": round(similarity, 4),
                    "threshold": threshold,
                    "tombstone_file": record.get("file"),
                    "tombstone_symbol": record.get("symbol"),
                },
            }
        )
    return findings


# ---------------------------------------------------------------------------
# Rule engine.
# ---------------------------------------------------------------------------


def _pattern_check(pattern: re.Pattern[str], hunk: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for lineno, text in hunk["added"]:
        if pattern.search(text):
            findings.append({"line": lineno, "excerpt": text.strip()})
    return findings


def all_rules(include_banned: bool = True) -> list[dict[str, Any]]:
    """Return built-in rules plus data-driven banned-pattern rules."""

    rules = list(RULES)
    if include_banned:
        rules.extend(load_banned_pattern_rules())
    return rules


def run_rules_on_hunk(
    rules: list[dict[str, Any]],
    hunk: dict[str, Any],
    skip_path_filter: bool = False,
) -> list[dict[str, Any]]:
    """Run rules over one hunk, returning complete finding dicts."""

    findings: list[dict[str, Any]] = []
    for rule in rules:
        applies_to = rule.get("applies_to") or DEFAULT_APPLIES_TO
        if not skip_path_filter and not path_matches(hunk.get("file"), applies_to):
            continue
        check: Callable[[dict[str, Any]], list[dict[str, Any]]] | None = rule.get("check")
        if check is not None:
            partials = check(hunk)
        elif rule.get("pattern") is not None:
            partials = _pattern_check(rule["pattern"], hunk)
        else:
            partials = []
        for partial in partials:
            finding: dict[str, Any] = {
                "rule_id": partial.get("rule_id", rule["rule_id"]),
                "severity": partial.get("severity", rule["severity"]),
                "file": hunk.get("file") or "<text>",
                "line": partial["line"],
                "excerpt": partial["excerpt"][:240],
                "message": partial.get("message", rule["message"]),
                "standard_id": partial.get("standard_id", rule.get("standard_id")),
            }
            detail = partial.get("detail", rule.get("detail"))
            if detail is not None:
                finding["detail"] = detail
            findings.append(finding)
    return findings


def scan_text_as_hunk(
    text: str, rule_ids: set[str], path: str | None = None
) -> list[dict[str, Any]]:
    """Whole-file advisory scan: treat every line as an added line."""

    hunk = {
        "file": path,
        "added": [(i + 1, line) for i, line in enumerate(text.splitlines())],
        "removed": [],
    }
    rules = [rule for rule in RULES if rule["rule_id"] in rule_ids]
    return run_rules_on_hunk(rules, hunk, skip_path_filter=True)


def main() -> None:
    """Debug CLI: compute shingles for other tooling (tombstone authoring)."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--shingles-from-file",
        required=True,
        help="Compute normalized shingles for the given text file.",
    )
    args = parser.parse_args()
    text = Path(args.shingles_from_file).read_text(encoding="utf-8", errors="replace")
    print(json.dumps({"shingles": sorted(normalized_shingles(text))}, indent=2))


if __name__ == "__main__":
    main()
