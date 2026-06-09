# Operations Utilities

Operations utilities are scripts for humans, directors, or maintenance jobs.
They are not registered Pi tool suites, but they remain under `tools/` because
they automate decompilation workflow.

| Utility | What it does |
| --- | --- |
| `rank_decomp_candidates.py` | Ranks high-ROI decomp targets from an objdiff report. |
| `decomp_context_lookup.py` | Builds a first-pass evidence packet for a file or symbol. |
| `sweeps/` | Scaffolds and analyzes larger experimental sweep runs. |
