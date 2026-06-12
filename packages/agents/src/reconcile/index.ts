export { reconcilePrompt, type ReconcileMode, type ReconcilePromptOptions } from "./prompt.js";

export const reconcileAgent = {
  id: "reconcile",
  role: "reconcile",
  toolProfile: "reconcile",
  schemaPath: "packages/agents/src/reconcile/schema.json",
  purpose: "Make a bundle safe at run-cycle boundaries: fix regressions before PR handoff (ship-validate) and resolve merge conflicts, duplicates, and build errors after upstream sync (sync-merge).",
} as const;
