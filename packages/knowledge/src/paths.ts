import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export function knowledgeRoot(): string {
  return resolve(packageRoot(), "knowledge");
}

export function pastPrsRoot(): string {
  return resolve(sourceRoot("past_prs"), "data");
}

export function sourceDataRoot(sourceId: string): string {
  return resolve(sourceRoot(sourceId), "data");
}

export function knowledgeSourcesRoot(): string {
  return resolve(knowledgeRoot(), "sources");
}

export function sourceRoot(sourceId: string): string {
  return resolve(knowledgeSourcesRoot(), sourceRegistryPath(sourceId));
}

export function codeGraphFunctionsIndexPath(): string {
  return resolve(sourceRoot("code_graph"), "indexes/functions.jsonl");
}

export function knowledgeSourceRegistryPath(): string {
  return resolve(knowledgeSourcesRoot(), "registry.json");
}

export function toolsRoot(): string {
  return resolve(packageRoot(), "tools");
}

export function knowledgeToolsRoot(): string {
  return toolsRoot();
}

export function knowledgeToolRegistryPath(): string {
  return resolve(toolsRoot(), "registry.json");
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
  return resolve(resourceGraphRoot(), "graph.sqlite");
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
