import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decompResourcesRoot, globalStandardsContext, pastPrsRoot, resourceMap } from "@decomp-orchestrator/knowledge";
import type { PiPromptBundle, RunProjectMetadata } from "@decomp-orchestrator/core/types";
import { agentContextManifestPath, agentContextReferences, agentContextScripts, agentContextSummary } from "../context.js";
import { readTemplate, renderTemplate, stableJson } from "../runtime/index.js";
import { agentToolProfileSummary } from "../tools/index.js";
import { enabledCapabilities } from "./packet.js";

export interface WorkerPromptOptions {
  packet: Record<string, unknown>;
  repoRoot: string;
  stateDir: string;
  project?: RunProjectMetadata;
  initialBoardPath: string;
  workerLogDir: string;
}

function templatePath(name: "system" | "initial_user"): string {
  return fileURLToPath(new URL(`./templates/${name}.md`, import.meta.url));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function workerResourceSummary(resources: Record<string, unknown>): Record<string, unknown> {
  const agentContext = asRecord(resources.agent_context);
  const pastPrs = asRecord(resources.past_prs);
  const decompResources = asRecord(resources.decomp_resources);
  const knowledgeGraph = asRecord(resources.knowledge_graph);
  return {
    roots: resources.roots,
    objective: resources.objective,
    agent_context: {
      manifest: agentContext.manifest ?? null,
      selected_references: agentContext.selected_references ?? [],
      capability_routes: agentContext.capability_routes ?? {},
    },
    progress_inputs: resources.progress_inputs,
    target_metadata: resources.target_metadata,
    local_context: resources.local_context,
    past_prs: {
      structured_index: pastPrs.structured_index ?? null,
      known_fixes: pastPrs.known_fixes ?? null,
      per_pr_detail_pattern: pastPrs.per_pr_detail_pattern ?? null,
    },
    decomp_resources: {
      index: decompResources.index ?? null,
      notes: decompResources.notes ?? null,
      data_sheet_csv_dir: decompResources.data_sheet_csv_dir ?? null,
      trust_rule: decompResources.trust_rule ?? null,
    },
    knowledge_graph: {
      sources_root: knowledgeGraph.sources_root ?? null,
      tools_root: knowledgeGraph.tools_root ?? null,
      graph_db: knowledgeGraph.graph_db ?? null,
      source_ids: knowledgeGraph.source_ids ?? [],
    },
    validation_policy:
      "Use Pi validation/review tools for ordinary attempt feedback; fall back to narrow repo commands only when tool output or local evidence makes that necessary. Global progress refreshes are operator/orchestrator work.",
  };
}

export function workerPrompt(options: WorkerPromptOptions): PiPromptBundle {
  const systemTemplatePath = templatePath("system");
  const userTemplatePath = templatePath("initial_user");
  const target = (options.packet.target ?? {}) as Record<string, unknown>;
  const primarySourcePath = String(target.source_path ?? "");
  const primarySourceAbs = primarySourcePath ? resolve(options.repoRoot, primarySourcePath) : "";
  const capabilities = enabledCapabilities(options.packet);
  const selectedAgentContextReferences = agentContextReferences("worker", capabilities);
  const filesToRead = [
    {
      path: primarySourceAbs,
      reason: "primary leased source file",
    },
    {
      path: resolve(options.repoRoot, "objdiff.json"),
      reason: "unit metadata, compiler flags, source path, and scratch provenance",
    },
    {
      path: resolve(options.repoRoot, "build/GALE01/report.json"),
      reason: "baseline function/unit metrics",
    },
    {
      path: options.initialBoardPath,
      reason: "run board snapshot used to queue this target",
    },
    {
      path: resolve(decompResourcesRoot(), "index.md"),
      reason: "resource library entry point and trust rules",
    },
    {
      path: resolve(pastPrsRoot(), "prs/index.jsonl"),
      reason: "structured searchable past-PR index",
    },
    {
      path: agentContextManifestPath(),
      reason: "orchestrator-owned agent context manifest and capability routing",
    },
    ...selectedAgentContextReferences.map((reference) => ({
      path: reference.path,
      reason: `worker agent context: ${reference.purpose}`,
    })),
  ];
  const currentState = {
    role: "worker",
    project: options.project ?? null,
    state_dir: options.stateDir,
    worker_log_dir: options.workerLogDir,
    selected_agent_context_references: selectedAgentContextReferences,
    ...options.packet,
  };
  const resources = resourceMap(options.repoRoot, {
    agentContext: agentContextSummary("worker", capabilities),
    project: options.project,
    scripts: agentContextScripts(),
  });
  const values = {
    CURRENT_STATE_JSON: stableJson(currentState),
    DECOMP_STANDARDS_JSON: stableJson(globalStandardsContext()),
    PRIMARY_SOURCE_PATH: primarySourcePath,
    FILES_TO_READ_JSON: stableJson(filesToRead),
    PI_TOOLS_JSON: stableJson(agentToolProfileSummary("worker")),
    RESOURCES_JSON: stableJson(workerResourceSummary(resources)),
  };
  return {
    systemPrompt: renderTemplate(readTemplate(systemTemplatePath), values),
    userPrompt: renderTemplate(readTemplate(userTemplatePath), values),
    systemTemplatePath,
    userTemplatePath,
  };
}
