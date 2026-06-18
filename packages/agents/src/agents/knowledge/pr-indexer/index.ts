export {
  prContextPromptXml,
  prIndexerPrompt,
  type PrIndexerPromptOptions,
} from "./prompt.js";

export const prIndexerAgent = {
  id: "pr-indexer",
  role: "pr-indexer",
  toolProfile: "pr-indexer",
  schemaPath: "packages/agents/src/agents/knowledge/pr-indexer/schema.json",
  purpose: "Intake one GitHub PR dump slice into a compact postmortem record for knowledge-curator handoff.",
} as const;
