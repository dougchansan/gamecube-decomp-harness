# Knowledge Curator Agent

Reviews worker states, checkpoint artifacts, PR intake postmortems, and deterministic proposals,
then emits graph-safe curated lessons plus proposal-only source updates. This is
the context-bridge agent: accepted records may feed graph-owned knowledge, while
source-owned changes stay proposals for their source owners.

The deterministic `kg-curate` reducer owns the v1 ingestion path. This agent
slice is the canonical prompt/schema for future model-reviewed curation batches.

Live curator agent sessions are stored under
`decomp-orchestrator/.pi-sessions/knowledge-curator/` by default. That
directory is ignored by git and exists only to make ingestion-agent reasoning
locally inspectable.

Curator Pi runs use the shared agent runtime defaults: provider `codex-lb`,
model `gpt-5.5`, and thinking `medium`, unless explicitly overridden. Auth is
loaded from ignored repo-local `.pi-agent/models.json` through
`PI_CODING_AGENT_DIR=.pi-agent` in `local.env`.
