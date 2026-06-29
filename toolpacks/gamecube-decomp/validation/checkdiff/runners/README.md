# Checkdiff Runners

There is no long-lived cache runner for this suite. The APIs are on-demand
tool-local commands because checkdiff and direct MWCC compile results depend
on the current checkout source and build tree.

Operator scripts may later add a runner that records representative validation
artifacts into `cache/`, but worker proof should stay target-specific.
