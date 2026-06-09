<worker_target_context>
    <current_state_json>
```json
{{CURRENT_STATE_JSON}}
```
    </current_state_json>

    <decomp_standards_json>
```json
{{DECOMP_STANDARDS_JSON}}
```
    </decomp_standards_json>

    <primary_file_to_read>
{{PRIMARY_SOURCE_PATH}}
    </primary_file_to_read>

    <files_to_read_first_json>
```json
{{FILES_TO_READ_JSON}}
```
    </files_to_read_first_json>

    <available_pi_tools_json>
```json
{{PI_TOOLS_JSON}}
```
    </available_pi_tools_json>

    <available_resources_json>
```json
{{RESOURCES_JSON}}
```
    </available_resources_json>

    <task>
        Decompile this one leased target.

        Use these inputs to decide what to inspect or run:
        - Current state
        - Injected standards
        - Selected context guides
        - Available resources
        - Pi tools

        The tools are composable affordances:
        - Use the ones that answer the current question.
        - Do not treat the tool list as a fixed checklist.

        If `current_state.repair_request` is present:
        - Fix that rejected return first.
        - Read the referenced gate artifact.
        - Repair the named validation/regression issue.
        - Remove only your own unsafe hunks if needed.
        - Return the corrected JSON report for this same target.

        Suggested shape:
        - Use `worker_context_get` when you want selected guides:
            - Worker operating guide
            - Lookup guide
            - Matching guide
        - Start by understanding what is going on:
            - Get the leased file.
            - Identify local style.
            - Identify the target mismatch.
            - Pull in useful context before editing.
        - Research with the knowledge base when it can constrain the puzzle:
            - Code graph
            - Path facts
            - Injected standards
            - Indexed past PRs
            - Curated worker lessons
            - Resource docs and data sheets
            - PowerPC notes
            - External hints
            - Discord/reference knowledge
            - Prior tool outputs
        - Treat the existing codebase as evidence:
            - Human-written source has recurring conventions.
            - Nearby matched files can reveal original programmer habits.
            - Consistent local patterns can suggest the missing type, helper, macro, or shape.
        - Go deeper only for concrete questions:
            - Symbol/decompiler context
            - Similar op sequences
            - Mismatch patterns
            - MWCC diagnostics
            - Type oracle
            - Struct inference
            - m2c scaffolds
            - Bounded source-shape exploration
        - Edit only `current_state.lease.write_set`.
        - Preserve existing dirty work and undo only your own failed attempt hunks.
        - Treat validation/review tools as an attempt-evaluation feedback bundle:
            - Use them for concrete source attempts.
            - Do not treat them as a constant workflow.
        - Before retaining or reporting edits, show local regression status:
            - The target has no unresolved local regression.
            - Affected neighbors have no unresolved local regression.
            - The final JSON includes the `local_regression_check` artifacts.
        - Do not run global progress-report refreshes from a worker:
            - Report narrow evidence.
            - Let the operator/orchestrator handle global refreshes when workers are idle.
        - Stop according to the system output contract:
            - `exact` when the target is finished
            - `improved` when retained score movement exists
            - `no_progress` when no retained score movement exists
            - `stalled` when no useful guesses remain
            - `needs_fact` when missing information blocks the next useful move
    </task>
</worker_target_context>
