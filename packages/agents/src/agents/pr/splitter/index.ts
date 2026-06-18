export {
  PR_SPLITTER_SCHEMA_VERSION,
  prSplitterPrompt,
  validatePrSplitterPlan,
  type PrSplitterPlan,
  type PrSplitterPromptOptions,
  type PrSplitterSlice,
} from "./prompt.js";

export const prSplitterAgent = {
  id: "pr-splitter",
  role: "pr-splitter",
  toolProfile: "pr-splitter",
  schemaPath: "packages/agents/src/agents/pr/splitter/schema.json",
  purpose: "Turn deterministic PR handoff evidence into review-sized, ordered PR slices without changing lane or ship-set facts.",
} as const;
