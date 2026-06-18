# Session Page Tree Example

```text
Dashboard
+-- Projects
|   +-- project cards
|   +-- active session verdict
|   +-- access/config warnings
|
+-- Project Home
|   +-- project identity
|   +-- current baseline and branch
|   +-- active session gate
|   +-- recommended next action
|
+-- Project Access
|   +-- standards
|   +-- knowledge
|   +-- tools
|   +-- missing capability checks
|
+-- Active Session
|   +-- session summary
|   +-- mode verdict
|   +-- timeline
|   +-- save points and artifacts
|
+-- Run Mode
|   +-- run setup and bounds
|   +-- progress and epochs
|   +-- workers, queue, leases
|   +-- reports and logs
|
+-- PR Mode
|   +-- ship set and split plan
|   +-- QA rounds and fixer attempts
|   +-- draft PR board
|   +-- human review loop
|   +-- blockers and next action
|
+-- Session History
    +-- completed sessions
    +-- PR intake history
    +-- carry-forward ledger
    +-- archived artifacts
```

Current Melee session target:

```text
Project: melee
+-- Active Session
    +-- Mode: PR Mode
    +-- Run Mode: stopped/paused/not primary
    +-- PR Mode
        +-- show planned or real PR slices
        +-- show QA/routed blockers
        +-- show draft/open/sync actions
        +-- show human-review loop status
```
