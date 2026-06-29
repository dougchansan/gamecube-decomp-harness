export {
  qaRepairPrompt,
  validateQaRepairAgentResult,
  type QaRepairAgentResult,
  type QaRepairPromptOptions,
} from "./prompt.js";

export const qaRepairAgent = {
  id: "qa-repair",
  role: "qa-repair",
  toolProfile: "qa-repair",
  schemaPath: "apps/server/src/core/agent-catalog/agents/pr/qa-repair/schema.json",
  purpose: "Repair deterministic QA findings in PR-bound candidate files before PR split planning, then report minimal edits for runner-owned validation.",
} as const;
