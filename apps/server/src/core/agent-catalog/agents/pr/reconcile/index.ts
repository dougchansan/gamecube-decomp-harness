export { reconcilePrompt, type ReconcileMode, type ReconcilePromptOptions } from "./prompt.js";

export const reconcileAgent = {
  id: "reconcile",
  role: "reconcile",
  toolProfile: "reconcile",
  schemaPath: "apps/server/src/core/agent-catalog/agents/pr/reconcile/schema.json",
  purpose: "Bundle-wide boundary repair for ship validation regressions and upstream-sync fallout.",
} as const;
