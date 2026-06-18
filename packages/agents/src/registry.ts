import { knowledgeCuratorAgent } from "./agents/knowledge/curator/index.js";
import { prIndexerAgent } from "./agents/knowledge/pr-indexer/index.js";
import { prFixerAgent } from "./agents/pr/fixer/index.js";
import { reconcileAgent } from "./agents/pr/fixer/reconcile/index.js";
import { prReviewerAgent } from "./agents/pr/reviewer/index.js";
import { prSplitterAgent } from "./agents/pr/splitter/index.js";

export const agentRegistry = {
  worker: {
    id: "worker",
    role: "worker",
    toolProfile: "worker",
    purpose: "Execute one leased Melee decomp target and return a durable worker report.",
  },
  "pr-indexer": prIndexerAgent,
  "pr-reviewer": prReviewerAgent,
  "pr-splitter": prSplitterAgent,
  "knowledge-curator": knowledgeCuratorAgent,
  reconcile: reconcileAgent,
  "qa-repair": prFixerAgent,
} as const;

export type RegisteredAgentId = keyof typeof agentRegistry;
