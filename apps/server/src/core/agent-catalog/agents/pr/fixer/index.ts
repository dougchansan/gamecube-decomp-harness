export {
  PR_FIXER_SCHEMA_VERSION,
  prFixerPrompt,
  validatePrFixerAgentResult,
  type PrFixerAgentResult,
  type PrFixerPromptOptions,
} from "./prompt.js";

export const prFixerAgent = {
  id: "pr-fixer",
  role: "pr-fixer",
  toolProfile: "pr-fixer",
  schemaPath: "apps/server/src/core/agent-catalog/agents/pr/fixer/schema.json",
  purpose: "Resolve maintainer PR comments and reviewer findings on an opened PR branch, then report edits and manual-review notes.",
} as const;
