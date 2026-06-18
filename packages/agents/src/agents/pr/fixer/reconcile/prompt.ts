import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PiPromptBundle, RunProjectMetadata } from "@decomp-orchestrator/core/types";
import { globalStandardsPromptXml } from "@decomp-orchestrator/knowledge";
import { readTemplate, renderTemplate, stableJson } from "../../../../runtime/index.js";
import { availableToolsPromptXml, type AgentToolRuntimeContext } from "../../../../tools/index.js";

export type ReconcileMode = "ship-validate" | "sync-merge";

export interface ReconcilePromptOptions {
  mode: ReconcileMode;
  reconcileContext: unknown;
  project?: RunProjectMetadata;
  repoRoot?: string;
  stateDir?: string;
}

function templatePath(name: "system" | "initial_user" | "schema"): string {
  return fileURLToPath(new URL(name === "schema" ? "./schema.json" : `./templates/${name}.md`, import.meta.url));
}

function toolContext(options: ReconcilePromptOptions): AgentToolRuntimeContext {
  const repoRoot = options.repoRoot ?? ".";
  return {
    role: "reconcile",
    cwd: repoRoot,
    repoRoot,
    stateDir: options.stateDir,
    project: options.project,
  };
}

export function reconcilePrompt(options: ReconcilePromptOptions): PiPromptBundle {
  const systemTemplatePath = templatePath("system");
  const userTemplatePath = templatePath("initial_user");
  const values = {
    AVAILABLE_TOOLS_XML: availableToolsPromptXml(toolContext(options)),
    DECOMP_STANDARDS_XML: globalStandardsPromptXml(),
    RECONCILE_MODE: options.mode,
    RECONCILE_CONTEXT_JSON: stableJson(options.reconcileContext),
    RECONCILE_OUTPUT_SCHEMA_JSON: stableJson(JSON.parse(readFileSync(templatePath("schema"), "utf8"))),
  };
  return {
    systemPrompt: renderTemplate(readTemplate(systemTemplatePath), values),
    userPrompt: renderTemplate(readTemplate(userTemplatePath), values),
    systemTemplatePath,
    userTemplatePath,
  };
}
