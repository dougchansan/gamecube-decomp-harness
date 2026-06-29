---
name: melee-pr-workflow
description: "Top-level Melee PR workflow skill. Use when syncing the orchestrator-owned past-PR corpus, syncing or rebasing the parent doldecomp/melee checkout, designing reviewer-friendly PRs or PR series, preparing a PR for handoff, running PR regression checks, drafting/updating PR bodies, or coordinating GitHub PR review/CI work."
---

# Melee PR Workflow

This is the single top-level skill for Melee PR-adjacent work. It routes to the
decomp orchestrator for missing PR knowledge sync and regression gates, while keeping
parent Melee git/PR work separate from the nested `decomp-orchestrator/` repo.

## Guardrails

- Treat `decomp-orchestrator/` as an unrelated nested Git repository unless the user explicitly asks to work on the orchestrator itself.
- Run parent Melee git sync/rebase commands from the parent Melee checkout, not from inside `decomp-orchestrator/`.
- Mainline is `master`; use `origin/master` as the rebase and regression baseline.
- Do not stage, commit, reset, rebase, or push `decomp-orchestrator/` as part of parent Melee PR work.
- Inspect `git status --short --ignore-submodules=all` before mutating the parent checkout.
- Never use `git reset --hard` or discard local work as part of this workflow.

## Refresh PR Knowledge

Use this path when the user asks to sync missing PR data, comments, reviews,
diffs, searchable postmortems, file-card context, or past-PR graph/search data.

Preview the fetch scope:

```bash
python3 decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/fetch_recent_pr_dump.py --dry-run
```

Fetch only PRs that are not already present locally and scaffold searchable records:

```bash
python3 decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/fetch_recent_pr_dump.py
```

Run Pi-reviewed postmortems for PRs that need searchable records:

```bash
python3 decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/build_pr_postmortems.py \
  --dump-root decomp-orchestrator/knowledge/sources/code_context/past_prs/data \
  --run-agent \
  --jobs 16
```

Rebuild only the past-PR graph slice after corpus changes:

```bash
bun run --cwd decomp-orchestrator kg:rebuild -- --repo-root "$PWD" --sources past_prs
```

Notes:

- `kg-maintain` and `trigger-agent` can index pending postmortems and rebuild graph state, but they do not fetch fresh GitHub PR data.
- The PR corpus lives under `decomp-orchestrator/knowledge/sources/code_context/past_prs/data`.
- Existing PR dump slices are treated as immutable during sync. To rebuild a
  stale or damaged PR record, delete that PR's local slice first, then run the
  missing-only fetcher.
- The fetcher uses `gh api`; GitHub CLI auth must be available.

## Sync Repo And PR Corpus

Use this path when the user asks to sync, rebase, or update the local checkout
and missing PR library entries together.

Standard sync:

```bash
python3 decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/sync_repo_and_pr_library.py \
  --postmortem-scope fetched \
  --postmortem-jobs 16
```

Skip git and only sync missing PR corpus entries:

```bash
python3 decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/sync_repo_and_pr_library.py \
  --skip-git \
  --postmortem-scope fetched \
  --postmortem-jobs 16
```

If rebase stops, leave the worktree in Git's rebase state and report the
conflicted files plus Git's suggested next command.

## Shape PRs And PR Bodies

Use this path when the user asks to split, group, restructure, create, update,
or explain Melee PRs.

Load `references/pr-shaping-reviewer-guidance.md` before proposing or applying a
PR split. Design PRs around reviewer cognition and regression-tool signal:

- **Only exact matches ship.** Match PRs carry runner-validated exact matches
  (plus supporting headers/declarations the matches need to build); they are
  byte-verified and should read as easy approvals. Fuzzy improvements never go
  into PRs — they stay on the local branch (the split plan's `local-*` slices)
  until they become matches. If a match-lane file also carries unshipped fuzzy
  improvements in other functions, call that out in the PR body.
- Treat the configured max-files-per-PR as a hard ceiling, not a packing
  target. Aim for the fewest PRs that are still comfortable to review in one
  sitting; do not shave slices down to produce a pile of small PRs.
- Keep broad header, naming, symbol, build, metadata, and rename churn separate
  from ordinary implementation/matching work when possible.
- Group small changes only when they share one review context and risk class.
- Treat shared headers, symbol renames, and bot-visible name changes as
  high-risk even when the file count is small.
- Avoid path-only splits when a subsystem, actor/module family, matching
  milestone, API/header change, or mechanical cleanup category gives reviewers
  a clearer unit.
- Write PR bodies as reviewer-facing digests using the reference template:
  summary, PR shape, reviewer notes, and verification/regression status.

## Prepare PR Handoff

Use this path when the user asks to prepare, finalize, refresh, build-check,
regression-check, update, or hand off a Melee PR.

The dashboard's `Prepare Handoff` automates the core of this path (pause →
pull upstream & rebase → PR intake → rebuild the production baseline in a
per-SHA worktree → branch QA vs that baseline → checkpoint with regressed
symbols forced to needs_rework → requeue rework at repair priority →
match-only split plan → ship-set verification, where the match-lane diff is
applied onto the baseline worktree and must build with zero regressions) and
shares the `/tmp/melee-baseline-<sha>` cache with step 5 below. Use the
manual steps for PR-comment triage, PR-body work, and pushing.

For review-style cleanup and regression triage, use the local QA reference in
`references/pr-review-qa-standards.md`. Keep that reference in the workflow
skill, not in upstream Melee docs.

For adversarial cleanup of an existing PR, standards-clean source outranks fuzzy
score. If removing overzealous worker output, pragmas, fake anchors, dummy
padding, or other tactic-shaped code lowers fuzzy score or even loses a match,
keep the clean source, report the score impact, and route the result through
carry-forward or explicit operator policy instead of restoring the tactic.

For PR splitting/grouping and reviewer-facing PR body content, use
`references/pr-shaping-reviewer-guidance.md`.

1. Inspect status and PR context:

```bash
git status --short --branch --ignore-submodules=all
git -C decomp-orchestrator status --short
git remote -v
gh pr status --repo doldecomp/melee
```

2. Sync mainline and missing PR knowledge:

```bash
python3 decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/sync_repo_and_pr_library.py \
  --postmortem-scope fetched \
  --postmortem-jobs 16
```

3. Pull active PR comments and reviews:

```bash
gh pr view --repo doldecomp/melee --comments
gh pr view --repo doldecomp/melee --json number,url,title,state,isDraft,baseRefOid,headRefOid,reviewDecision,mergeStateStatus
gh api --paginate repos/doldecomp/melee/pulls/<PR_NUMBER>/comments
gh api --paginate repos/doldecomp/melee/issues/<PR_NUMBER>/comments
gh api --paginate repos/doldecomp/melee/pulls/<PR_NUMBER>/reviews
```

4. Evaluate PR shape before validation:

- Inventory touched file types and high-risk churn.
- Check the latest checkpoint (`pr_candidates.md`): only the match candidates
  ship; notable improvements are listed in `carry_forward.md` and stay local.
- Decide whether the PR should stay grouped, split, or isolate header/naming
  changes.
- Draft/update the PR body with a clear summary, PR shape, reviewer notes, and
  verification section.
- Call out expected regression false positives caused by renames or declaration
  movement.

5. Rebuild a baseline from current `origin/master`:

```bash
BASE_SHA="$(git rev-parse origin/master)"
BASE_DIR="/tmp/melee-baseline-${BASE_SHA}"
if [ ! -f "$BASE_DIR/build/GALE01/baseline.json" ]; then
  git worktree add --detach "$BASE_DIR" "$BASE_SHA"
  (cd "$BASE_DIR" && ninja baseline)
fi
cp "$BASE_DIR/build/GALE01/baseline.json" build/GALE01/baseline.json
```

6. Run build and regression gates:

```bash
ninja
bun run --cwd decomp-orchestrator orch -- \
  --repo-root "$PWD" \
  --state-dir "$PWD/.decomp-orchestrator-state/pr-prepare" \
  regression-check \
  --target changes_all \
  --report-title "Report for GALE01 PR handoff" \
  --report-max-rows 300
```

7. Fix and rerun until the handoff state is clean:

- `build/GALE01/main.dol: OK`
- zero broken matches
- zero unexplained or unaccepted fuzzy regressions in unmatched items
- zero unit, section, or function metric regressions
- no unresolved actionable review comments or relevant build warnings/errors

8. Run the mandatory pre-ship adversarial review gate (blocks handoff):

Save the match-only split plan as JSON if you do not already have one, then run
the pr-review agent in preship mode over every shipping slice:

```bash
bun run --cwd decomp-orchestrator orch -- \
  --project melee \
  pr-split-plan --checkpoint <checkpoint.json> --ship-status <ship_status.json> --json \
  > /tmp/melee-pr-split-plan.json
bun run --cwd decomp-orchestrator orch -- \
  --project melee \
  pr-preship-review --plan /tmp/melee-pr-split-plan.json --all
```

- ANY `reject` finding blocks handoff; exit 1 means do not draft PR bodies or
  push. Agent/tool failures also exit 1 (the gate fails closed) — fix the
  infrastructure and rerun rather than skipping the gate.
- Disposition of rejects, consistent with the MATCHES-only promotion policy:
  mark the affected symbols `needs_rework`, requeue them at repair priority,
  and ship the slice without them or not at all. Never keep a rejected hunk to
  preserve a match score.
- Per-slice verdicts, findings, and prompts land under
  `decomp-orchestrator/projects/melee/state/preship_reviews/<run-id>/<slice-id>/`
  (`review.md` is the human-readable digest); cite them in the PR body's
  verification section.

9. Commit or amend only parent Melee PR files, then push safely:

```bash
git status --short --untracked-files=no --ignore-submodules=all
git diff --check
git add <melee-source-files>
git commit --amend --no-edit
git push --force-with-lease fork HEAD:<branch>
```

10. Update or create the PR, then watch CI:

```bash
gh pr edit <PR_NUMBER> --repo doldecomp/melee --body-file <report.md>
gh pr checks <PR_NUMBER> --repo doldecomp/melee
gh run view <RUN_ID> --repo doldecomp/melee --log-failed
```

Include PR URL, head SHA, base SHA, changed units, match/regression summary,
local gate results, and CI state in the final response and PR body.

## Verification

For skill maintenance or command sanity checks:

```bash
python3 -m py_compile \
  decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/sync_repo_and_pr_library.py \
  decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/fetch_recent_pr_dump.py \
  decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/build_pr_postmortems.py \
  decomp-orchestrator/knowledge/sources/code_context/past_prs/commands/migrate_pr_data_layout.py
```
