# Source Permuter Runners

The source permuter is intentionally on-demand. A persistent runner would be
target-specific because it depends on current source text, build artifacts,
compiler setup, and random seeds.

Store replay recipes or long-running search transcripts in `cache/` only when
they are useful for later audit.
