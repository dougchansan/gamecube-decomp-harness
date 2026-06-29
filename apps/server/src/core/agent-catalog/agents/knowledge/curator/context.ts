import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type { LoaderDeclaration } from "@agent-kernel/kernel/context";
import type { PiPromptBundle, RunProjectMetadata } from "@server/core/shared/types";
import { availableToolsPromptXml, type AgentToolRuntimeContext } from "@server/core/tools/index.js";
import { renderTemplate, stableJson } from "@server/infrastructure/agent-runtime/runtime";
import {
  createInlineAgentContextResolver,
  rootContextLoaderDeclaration,
} from "@server/core/agent-catalog/kernel-context.js";

const loaders = [
  rootContextLoaderDeclaration,
  { kind: "curator-context", ref: "curator-context", label: "curator-context" },
] as const satisfies readonly LoaderDeclaration[];

export interface KnowledgeCuratorPromptOptions {
  curatorContext: unknown;
  project?: RunProjectMetadata;
  repoRoot?: string;
  stateDir?: string;
}

export const KNOWLEDGE_CURATOR_TURN_PROMPT = [
  "Use the injected knowledge curator context packet.",
  "Review the batch and return graph-safe curation decisions as exactly one JSON object.",
].join(" ");

export const context = defineContext(
  createInlineAgentContextResolver(loaders, KNOWLEDGE_CURATOR_TURN_PROMPT),
);

const CURATOR_CONTEXT_TEMPLATE = `<task>
    Review this curator batch and return graph-safe curation decisions.
    Promote only evidence-backed reusable records; leave source-owned changes as proposals.
</task>

{{AVAILABLE_TOOLS_XML}}

<curator_context>
{{CURATOR_CONTEXT_JSON}}
</curator_context>

<output_contract>
Use this top-level shape:

{{CURATOR_OUTPUT_SCHEMA_JSON}}
</output_contract>

Return exactly one JSON object.`;

function schemaPath(): string {
  return fileURLToPath(new URL("./schema.json", import.meta.url));
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

export function buildKnowledgeCuratorKernelContext(options: KnowledgeCuratorPromptOptions): NonNullable<PiPromptBundle["kernelContext"]> {
  const renderedContext = renderTemplate(CURATOR_CONTEXT_TEMPLATE, {
    AVAILABLE_TOOLS_XML: availableToolsPromptXml(toolContext(options)),
    CURATOR_CONTEXT_JSON: stableJson(options.curatorContext),
    CURATOR_OUTPUT_SCHEMA_JSON: stableJson(JSON.parse(readFileSync(schemaPath(), "utf8"))),
  });
  return {
    turnPrompt: KNOWLEDGE_CURATOR_TURN_PROMPT,
    renderedContext,
    inputs: [
      {
        loaderKind: "curator-context",
        inputRef: "curator-context",
        content: renderedContext,
      },
    ],
  };
}

export default context;
