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

## Agent Viewer Prompt Previews

When changing agent prompt templates, prompt placeholders, or injected prompt
context, update the Agent Viewer preview path at the same time. Keep the sample
rendering and placeholder hydration in `apps/agent-viewer/src/server.ts` and the
viewer-side parsing/fallbacks in `apps/agent-viewer/src/components/AgentViewer.tsx`
aligned with the real prompt builder, so rendering changes are visible in the UI
and do not leak raw `{{PLACEHOLDER}}` text. If the existing viewer server is
serving `apps/agent-viewer/dist`, rebuild the viewer bundle; do not start a new
viewer server unless the user asks.
