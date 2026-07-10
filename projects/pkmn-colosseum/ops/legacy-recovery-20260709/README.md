# Legacy recovery queue

This directory preserves snapshots for the eight local scratch candidates
identified by the 2026-07-09 previous-campaign audit. The authoritative queue
manifest lives at
`knowledge/sources/code_context/legacy_colosseum_kg/data/recovery_manifest.json`
and is indexed into the searchable legacy knowledge source. Candidate snapshots
are historical code-generation evidence only and are not compiled by the
harness.

Three candidates are already exact upstream. Five remain actionable. For
semantics, start from the tracked previous-campaign source cited in the
manifest; use the snapshots only to explain the recorded permuter score.

Every candidate must be rebuilt in its current dtk translation unit before it
can be accepted. The snapshots for `fn_80068738` and `fn_800E8EFC` are known to
contain suspicious loop-pointer placement and must not be ported literally.
