import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context.js";
import { prompt } from "./prompt.js";
import { tools } from "./tools.js";

export const agent = defineAgent({
  name: "pr-indexer",
  description: "Intake one GitHub PR dump slice into a compact postmortem record for knowledge-curator handoff.",
  model: "codex-lb/gpt-5.5",
  coreTools: [
      "code_graph_search",
      "path_facts_resolve",
      "review_lint_scan",
  ],
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
