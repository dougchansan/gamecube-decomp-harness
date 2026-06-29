import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context.js";
import { prompt } from "./prompt.js";
import { tools } from "./tools.js";

export const agent = defineAgent({
  name: "knowledge-curator",
  description: "Review worker and PR indexing outputs, then propose graph-safe curated lessons and source update proposals.",
  model: "codex-lb/gpt-5.5",
  coreTools: [
      "code_graph_search",
      "past_prs_search",
      "decomp_standards_context",
      "decomp_standards_proposals",
      "path_facts_resolve",
      "path_facts_proposals",
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
