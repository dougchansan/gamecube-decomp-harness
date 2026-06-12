export {
  PRESHIP_DIFF_CHAR_LIMIT,
  prContextPromptXml,
  prPreshipReviewPrompt,
  prReviewPrompt,
  type PrPreshipReviewPromptOptions,
  type PrReviewPromptOptions,
} from "./prompt.js";
export {
  PRESHIP_REVIEW_SCHEMA_VERSION,
  loadPreshipExhibits,
  preshipExhibitsPath,
  preshipExhibitsPromptXml,
  validatePreshipReview,
  type PreshipExhibit,
  type PreshipExhibitKind,
  type PreshipFindingVerdict,
  type PreshipReview,
  type PreshipReviewFinding,
  type PreshipSliceVerdict,
} from "./preship.js";

export const prReviewAgent = {
  id: "pr-review",
  role: "pr-review",
  toolProfile: "pr-review",
  schemaPath: "packages/agents/src/pr-review/schema.json",
  purpose: "Intake one GitHub PR dump slice into a compact postmortem record for knowledge-curator handoff.",
} as const;
