# Decomp Orchestrator Agent Instructions

## UI Server

When working on the orchestrator UI, assume the UI server is already running in
the background. Do not start `bun run ui:server`, `bun run ui`, or a UI dev
server unless the user specifically asks you to start one.

## UI Process Name

The dashboard-managed Melee process name is `melee-live`. Keep that project
process name stable instead of adding UI controls that let it drift. The UI
server may die while the detached process continues running, so a constant name
keeps the saved process file, status view, drain/stop controls, and kill command
easy to find.
