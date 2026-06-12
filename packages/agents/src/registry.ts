import { knowledgeCuratorAgent } from "./knowledge-curator/index.js";
import { prReviewAgent } from "./pr-review/index.js";
import { reconcileAgent } from "./reconcile/index.js";

export const agentRegistry = {
  director: {
    id: "director",
    role: "director",
    toolProfile: "director",
    purpose: "Schedule decomp worker targets from board state and worker wake events.",
  },
  worker: {
    id: "worker",
    role: "worker",
    toolProfile: "worker",
    purpose: "Execute one leased Melee decomp target and return a durable worker report.",
  },
  "pr-review": prReviewAgent,
  "knowledge-curator": knowledgeCuratorAgent,
  reconcile: reconcileAgent,
} as const;

export type RegisteredAgentId = keyof typeof agentRegistry;
