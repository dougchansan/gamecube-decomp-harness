export { PRESHIP_DIFF_CHAR_LIMIT, prPreshipReviewPrompt, type PrPreshipReviewPromptOptions } from "./prompt.js";
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

export const prReviewerAgent = {
  id: "pr-reviewer",
  role: "pr-reviewer",
  toolProfile: "pr-reviewer",
  schemaPath: "packages/agents/src/agents/pr/reviewer/templates/preship_schema.json",
  purpose: "Review planned PR slices for known maintainer issues and report findings for the PR fixer.",
} as const;
