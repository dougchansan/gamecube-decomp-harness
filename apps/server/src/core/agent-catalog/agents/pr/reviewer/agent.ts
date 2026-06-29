import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context.js";
import { prompt } from "./prompt.js";
import { tools } from "./tools.js";

export const agent = defineAgent({
  name: "pr-reviewer",
  description: "Review planned PR slices for known maintainer issues and report findings for the PR fixer.",
  model: "codex-lb/gpt-5.5",
  coreTools: [],
  disallowedTools: [],
  extensions: false,
  canSpawnSubagent: false,
  variables: {},
  runInBackground: false,
  thinking: "medium",
  prompt,
  context,
  tools,
});

export default agent;
