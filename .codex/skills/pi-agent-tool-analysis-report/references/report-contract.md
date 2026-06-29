# Pi Agent Tool-Analysis Report Contract

Read this before changing the analyzer, renderer, or HTML format for
`reports/pi-agent-tool-analysis-*.html`.

## Source Files

- `scripts/analyze-pi-agent-tools.py`: reads data and emits stats JSON.
- `scripts/render-pi-agent-tool-report.py`: renders self-contained HTML.
- `docs/20-implementation/99-appendix/50-pi-agent-run-reports.md`: existing
  implementation notes and interpretation guidance.
- `reports/pi-agent-tool-analysis-2026-06-16.html`: rich-layout reference for
  the "Big Sweep Round Two" branch-delta style.

## Inputs

- `projects/melee/state/orchestrator.sqlite`, table `events`: terminal worker
  events and `runner_validation`. This is the canonical outcome source.
- `projects/melee/state/orchestrator.sqlite`, table `pi_sessions`: worker
  session to lease mapping, transcript paths, thinking level, status, and times.
- `.pi-sessions/worker/*.jsonl`: duration, tool calls, advertised tools parsed
  from the initial prompt's `<available_tools>` block.
- Optional branch-delta input:
  `projects/melee/checkout/build/GALE01/report_changes_production.json`.

The analyzer groups by lease. Repair sessions are summed into the owning lease.

## Required Semantics

- Confirmed exact: terminal worker/score event result is `exact` and
  `runner_validation.status` is `passed`.
- Confirmed improved: terminal worker/score event result is `improved` and
  `runner_validation.status` is `passed`.
- Exact rejected: runner validation says the target was exact, but validation
  did not pass.
- Improved rejected: runner validation says the target improved and validation
  did not pass or was not skipped.
- Error: worker error or provider error.
- No change: terminal event without confirmed/rejected/error outcome.
- Aborted: error/no-change/in-flight lease with zero tool calls, used to detect
  empty worker returns.
- In-flight: no terminal event yet. Exclude from terminal statistics and state
  the exclusion count in the method note.

Do not count a worker's self-reported exact/improved claim as confirmed unless
runner validation accepted it.

## Run Mapping

`scripts/analyze-pi-agent-tools.py` currently uses a two-entry `RUNS` dict:

- `run1`: baseline/control/prior sweep.
- `run2`: experiment/latest sweep.

The renderer expects these labels. If comparing more than two sweeps, update
both scripts deliberately instead of adding unrendered labels.

## Stats JSON Shape

The renderer expects:

- `leases`: per-lease records with `run`, `outcome`, `duration_min`, `tools`,
  `total_calls`, target metadata, runner-validation fields, and event fields.
- `advertised_tools`: run label to advertised tool names.
- `funnel`: counts by run and combined.
- `durations`: duration summaries keyed as `<run>|<outcome>`.
- `kill_table`: survival-style threshold rows.
- `overall_p_success`: terminal confirmed success rate.
- `tools`: per-tool adoption/lift rows.
- `never_called`: advertised tools never observed.
- `confirmed_exact_details`: exact-match detail rows.
- `exact_rejected_details`: gate-loss detail rows.

If adding richer HTML cards or branch-delta panels, keep this base JSON shape
stable unless both scripts are updated together.

## HTML Sections

Keep the report self-contained and scannable. A complete report should include:

1. Header with title, run IDs, generation date, data sources, and snapshot caveat.
2. Headline metrics: successes, exact/improved split, success rate, worker-hours,
   and key duration metric.
3. Outcome funnel or outcome mix by lease count and worker-hours.
4. Duration distribution by outcome.
5. Kill-threshold or timeout read, including when it is not useful.
6. Gate-loss/rejected-work breakdown using runner-validation reasons.
7. Tool-surface breakdown: core loop, automatic/injected gates, specialists,
   secondary/lookup tools, and prune candidates.
8. Lift/adoption detail with a warning that lift is correlational.
9. Confirmed exact lease table sorted by speed or another explicit criterion.
10. Method notes with data sources, filters, caveats, and generator scripts.

For the 2026-06-16 rich style, include branch-delta visualization only when the
production report exists. Make clear that branch delta describes current WIP vs
production, while lease outcomes describe worker targets.

## Formatting Guidelines

- Use inline CSS and static HTML only.
- Keep cards and panels at 8px border radius or less.
- Use compact tables for dense operational data.
- Use color consistently:
  - exact: green
  - improved: teal
  - exact rejected: amber
  - improved rejected: orange
  - no change: slate
  - error: red
  - aborted: muted purple/slate
- Use tabular numeric alignment for counts, rates, minutes, and hours.
- Keep bar widths bounded and derived from normalized data; avoid layout shifts.
- Avoid external fonts, images, scripts, or generated SVG files. Inline SVG or
  CSS-only charts are acceptable when they make dense report data easier to read.

## Validation Checklist

- Stats JSON parses with `python3 -m json.tool`.
- `leases` is non-empty and `funnel` contains `run1` and `run2`.
- Header run IDs match the analyzer `RUNS` dict.
- HTML contains no raw template placeholders or tracebacks.
- Method note states runner validation is canonical.
- If branch-delta numbers appear, the source path is named and the report
  distinguishes branch-level deltas from lease-level outcomes.
- If tool tiers changed since the last report, tier lists and recommendations
  were updated before rendering.
