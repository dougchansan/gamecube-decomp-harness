# Checkdiff Tests

Smoke tests should cover API shape and missing-build failure behavior without
requiring a full Colosseum build. Full validation tests belong in a configured
project checkout with MWCC, objdiff, build artifacts, and a runner available.
Prefer project-state wibo; Wine is a fallback.
