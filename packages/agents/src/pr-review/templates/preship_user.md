<task>
    Adversarial pre-ship review of PR slice `{{SLICE_ID}}`.
    Find every reason the maintainer would reject this diff. Judge only the diff below.
</task>

{{DECOMP_STANDARDS_XML}}

{{EXHIBITS_XML}}

<lint_findings>
```json
{{LINT_FINDINGS_JSON}}
```
</lint_findings>

<slice_diff>
```diff
{{SLICE_DIFF}}
```
</slice_diff>

Return exactly one JSON object.
