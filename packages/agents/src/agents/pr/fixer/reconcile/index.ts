export { reconcilePrompt, type ReconcileMode, type ReconcilePromptOptions } from "./prompt.js";

export const reconcileAgent = {
  id: "reconcile",
  role: "reconcile",
  toolProfile: "reconcile",
  schemaPath: "packages/agents/src/agents/pr/fixer/reconcile/schema.json",
  purpose: "Legacy PR fixer mode for bundle-wide ship validation and upstream-sync fallout.",
} as const;
