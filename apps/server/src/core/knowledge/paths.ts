import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface SourceRegistryEntry {
  id: string;
  path?: string;
  active?: boolean;
}

interface SourceRegistryFile {
  sources?: Array<string | SourceRegistryEntry>;
}

export function packageRoot(): string {
  return fileURLToPath(new URL("../../../../..", import.meta.url));
}

export function knowledgeRoot(): string {
  return projectKnowledgeRoot();
}

export function projectKnowledgeRoot(projectId = "melee"): string {
  const override = process.env.ORCH_PROJECT_KNOWLEDGE_ROOT ?? process.env.ORCHESTRATOR_PROJECT_KNOWLEDGE_ROOT;
  if (override) return isAbsolute(override) ? override : resolve(packageRoot(), override);
  return resolve(packageRoot(), "projects", projectId, "knowledge");
}

export function pastPrsRoot(): string {
  return sourceDataRoot("past_prs");
}

export function sourceDataRoot(sourceId: string): string {
  return resolve(sourceStorageRoot(sourceId), "data");
}

export function knowledgeSourcesRoot(): string {
  return resolve(projectKnowledgeRoot(), "sources");
}

export function sourceRoot(sourceId: string): string {
  return resolve(knowledgeSourcesRoot(), sourceRegistryPath(sourceId));
}

export function sourceStorageRoot(sourceId: string): string {
  return resolve(projectKnowledgeRoot(), "sources", sourceRegistryPath(sourceId));
}

export function codeGraphFunctionsIndexPath(): string {
  return resolve(sourceStorageRoot("code_graph"), "indexes/functions.jsonl");
}

export function knowledgeSourceRegistryPath(): string {
  return resolve(knowledgeSourcesRoot(), "registry.json");
}

export function toolsRoot(): string {
  return toolpackRoot();
}

export function knowledgeToolsRoot(): string {
  return toolsRoot();
}

export function knowledgeToolRegistryPath(): string {
  return toolpackToolRegistryPath();
}

export function toolpacksRoot(): string {
  return resolve(packageRoot(), "toolpacks");
}

export function defaultToolpackId(): string {
  return process.env.ORCH_DEFAULT_TOOLPACK_ID ?? "gamecube-decomp";
}

export function toolpackRoot(toolpackId = defaultToolpackId()): string {
  const override = process.env.ORCH_TOOLPACK_ROOT;
  if (override && toolpackId === defaultToolpackId()) {
    return isAbsolute(override) ? override : resolve(packageRoot(), override);
  }
  return resolve(toolpacksRoot(), toolpackId);
}

export function toolpackRegistryPath(toolpackId = defaultToolpackId()): string {
  return resolve(toolpackRoot(toolpackId), "toolpack.json");
}

export function toolpackToolRegistryPath(toolpackId = defaultToolpackId()): string {
  return resolve(toolpackRoot(toolpackId), "registry.json");
}

export function projectRoot(projectId = "melee"): string {
  return resolve(packageRoot(), "projects", projectId);
}

export function projectToolBindingRoot(projectId = "melee"): string {
  return resolve(projectRoot(projectId), "tool-bindings");
}

export function projectSharedToolDataRoot(projectId = "melee"): string {
  return resolve(projectRoot(projectId), "shared/tool-data");
}

export function projectWorktreeRoot(projectId = "melee", worktreeId = "main"): string {
  return resolve(projectRoot(projectId), "worktrees", worktreeId);
}

export function projectWorktreeToolCacheRoot(projectId = "melee", worktreeId = "main"): string {
  return resolve(projectWorktreeRoot(projectId, worktreeId), "tool-cache");
}

export function resourceGraphRoot(): string {
  return resolve(knowledgeRoot(), "resource_graph");
}

export function resourceGraphEnrichmentsRoot(): string {
  return resolve(resourceGraphRoot(), "enrichments");
}

export function agentSharedStateEnrichmentPath(): string {
  return resolve(resourceGraphEnrichmentsRoot(), "agent_shared_state_lessons.jsonl");
}

export function knowledgeCuratorEnrichmentPath(): string {
  return resolve(resourceGraphEnrichmentsRoot(), "knowledge_curator_updates.jsonl");
}

export function resourceGraphDbPath(): string {
  return resolve(packageRoot(), "projects/melee/graph/graph.sqlite");
}

function sourceRegistryPath(sourceId: string): string {
  const path = knowledgeSourceRegistryPath();
  if (!existsSync(path)) return sourceId;
  const registry = JSON.parse(readFileSync(path, "utf8")) as SourceRegistryFile;
  for (const entry of registry.sources ?? []) {
    const normalized = typeof entry === "string" ? { id: entry, path: entry } : entry;
    if (normalized.id === sourceId) return normalized.path ?? normalized.id;
  }
  return sourceId;
}
