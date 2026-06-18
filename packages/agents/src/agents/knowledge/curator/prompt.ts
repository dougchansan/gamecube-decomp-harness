import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PiPromptBundle, RunProjectMetadata } from "@decomp-orchestrator/core/types";
import { readTemplate, renderTemplate, stableJson } from "../../../runtime/index.js";
import { availableToolsPromptXml, type AgentToolRuntimeContext } from "../../../tools/index.js";

export interface KnowledgeCuratorPromptOptions {
  curatorContext: unknown;
  project?: RunProjectMetadata;
  repoRoot?: string;
  stateDir?: string;
}

function templatePath(name: "system" | "initial_user" | "schema"): string {
  return fileURLToPath(new URL(name === "schema" ? "./schema.json" : `./templates/${name}.md`, import.meta.url));
}

function toolContext(options: KnowledgeCuratorPromptOptions): AgentToolRuntimeContext {
  const repoRoot = options.repoRoot ?? ".";
  return {
    role: "knowledge-curator",
    cwd: repoRoot,
    repoRoot,
    stateDir: options.stateDir,
    project: options.project,
  };
}

export function knowledgeCuratorPrompt(options: KnowledgeCuratorPromptOptions): PiPromptBundle {
  const systemTemplatePath = templatePath("system");
  const userTemplatePath = templatePath("initial_user");
  const values = {
    AVAILABLE_TOOLS_XML: availableToolsPromptXml(toolContext(options)),
    CURATOR_CONTEXT_JSON: stableJson(options.curatorContext),
    CURATOR_OUTPUT_SCHEMA_JSON: stableJson(JSON.parse(readFileSync(templatePath("schema"), "utf8"))),
  };
  return {
    systemPrompt: renderTemplate(readTemplate(systemTemplatePath), values),
    userPrompt: renderTemplate(readTemplate(userTemplatePath), values),
    systemTemplatePath,
    userTemplatePath,
  };
}
