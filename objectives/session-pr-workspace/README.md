# Session PR Workspace

Durable objective bundle for promoting the orchestrator's derived session/PR
UI flow into a local session PR workspace model.

The key product rule is separation of phases:

- run mode produces candidate work on a session branch;
- PR mode splits verified work into local PR objects;
- local PR objects can be prepared and validated in persistent worktrees;
- only a bounded, explicit batch is opened as GitHub drafts;
- the next autonomous session is blocked until active-session PR work is
  resolved, intaken, abandoned, or carried forward by an explicit policy.

Objective path: `objectives/session-pr-workspace/`
