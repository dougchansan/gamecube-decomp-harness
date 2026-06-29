---
name: pi-agent-tool-analysis-report
description: "Build, rerun, update, and interpret the repo's Pi agent tool-analysis reports. Use when a user asks to regenerate reports/pi-agent-tool-analysis-*.html or *.stats.json, compare Pi worker sweeps, analyze worker tool usage/lift, review kill thresholds, update report HTML formatting, or preserve the repeatable report workflow from reports/."
---

# Pi Agent Tool Analysis Report

Use this skill to refresh the Pi worker tool-analysis report from repo-local
SQLite events and worker JSONL transcripts. Keep the existing analyzer and
renderer scripts as the source of truth unless the user explicitly asks to
change the report shape.

For report semantics, HTML section expectations, and formatting notes, read
`references/report-contract.md` before changing `scripts/analyze-pi-agent-tools.py`
or `scripts/render-pi-agent-tool-report.py`.

## Standard Workflow

1. Work from the repository root. Inspect recent artifacts and current run
   mapping:

   ```bash
   ls -t reports/pi-agent-tool-analysis-* 2>/dev/null | head -20
   sed -n '/^RUNS = {/,/^}/p' scripts/analyze-pi-agent-tools.py
   ```

2. Discover candidate run IDs from the state database. Do not infer run IDs from
   report filenames.

   ```bash
   python3 - <<'PY'
   import sqlite3
   db = sqlite3.connect("projects/melee/state/orchestrator.sqlite")
   rows = db.execute("""
     SELECT run_id, COUNT(*) AS sessions, MIN(created_at), MAX(created_at)
     FROM pi_sessions
     WHERE role='worker'
     GROUP BY run_id
     ORDER BY MAX(created_at) DESC
     LIMIT 12
   """)
   for run_id, sessions, first, last in rows:
       print(f"{run_id}\t{sessions}\t{first}\t{last}")
   PY
   ```

3. Map the baseline/control sweep to `run1` and the new/experiment/latest sweep
   to `run2`. If the mapping needs to change, prefer the helper:

   ```bash
   python3 .codex/skills/pi-agent-tool-analysis-report/scripts/set-pi-tool-runs.py \
     --run1 <baseline-or-control-run-id> \
     --run2 <experiment-or-latest-run-id>
   ```

4. Build durable artifacts beside the report:

   ```bash
   export OUT="reports/pi-agent-tool-analysis-$(date +%F)"
   python3 scripts/analyze-pi-agent-tools.py "${OUT}.stats.json"
   python3 scripts/render-pi-agent-tool-report.py "${OUT}.stats.json" "${OUT}.html"
   ```

   Use a `/tmp/*.json` stats path only for scratch exploration. For a handoff or
   rerunnable result, keep `reports/*.stats.json` next to `reports/*.html`.

5. Validate the output before reporting success:

   ```bash
   python3 -m json.tool "${OUT}.stats.json" >/dev/null
   python3 - <<'PY'
   import json, os
   out = os.environ.get("OUT", "reports/pi-agent-tool-analysis")
   with open(out + ".stats.json") as f:
       stats = json.load(f)
   assert stats["leases"], "stats JSON has no leases"
   assert {"run1", "run2"} <= set(stats["funnel"]), "missing run1/run2 funnel"
   print(len(stats["leases"]), "leases")
   PY
   rg -n "\\{\\{|TODO|Traceback|nan" "${OUT}.html"
   ```

   `rg` returning no matches for the HTML check is expected.

## Interpretation Rules

- Treat `runner_validation` as canonical. "Confirmed" means result
  `exact`/`improved` with validation status `passed`, not the worker's local
  claim.
- Compare runs by rate and worker-hours, not raw success count alone.
- Keep `run1`/`run2` labels stable for the renderer: `run1` is the comparison
  baseline, `run2` is the new run.
- Remember that medium-thinking leases are filtered out by the analyzer; the
  report is xhigh-only unless the script is intentionally changed.
- Treat lift as correlational. Use it to choose exposure experiments, not to
  declare a tool causally good or bad.
- In-flight leases are excluded from terminal stats. Mid-run refreshes are fine,
  but call out that the report is a snapshot.

## HTML And Format Changes

- Prefer changing `scripts/render-pi-agent-tool-report.py` and rerendering over
  hand-editing generated HTML. If a one-off HTML edit is unavoidable, document
  that in the report's method note.
- Keep the report self-contained: inline CSS, no external JS, no remote assets.
- Preserve the method/caveats block near the end and mention data sources,
  included run IDs, in-flight exclusions, and runner validation.
- When the user asks for branch-delta or "big sweep" formatting, use
  `reports/pi-agent-tool-analysis-2026-06-16.html` as the current rich-layout
  reference and include branch-delta data only when
  `projects/melee/checkout/build/GALE01/report_changes_production.json` is
  present and relevant.
- After any tool surface change, update renderer tier lists before rerendering:
  `PRIMARY_SURFACE_TOOLS`, `INJECTED_CONTEXT_TOOLS`, `AUTO_CLOSE_TOOLS`,
  `SPECIALIST_TOOLS`, and the optional-action rules.
