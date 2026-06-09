import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  knowledgeSourceRegistryPath,
  knowledgeSourcesRoot,
  knowledgeToolRegistryPath,
  knowledgeToolsRoot,
  packageRoot,
} from "../paths.js";
import type { SourceDescriptor, ToolDescriptor, ToolRegistryEntry, ToolRegistryObject } from "./types.js";

interface RegistryFile {
  sources?: string[];
  tools?: ToolRegistryEntry[];
}

export function readSourceRegistry(): SourceDescriptor[] {
  const registryPath = knowledgeSourceRegistryPath();
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryFile;
  return (registry.sources ?? []).map((id) => readSourceDescriptor(id));
}

export function readToolRegistry(): ToolDescriptor[] {
  return readToolRegistryEntries().map((entry) => readToolDescriptor(entry.id));
}

export function readToolRegistryEntries(): ToolRegistryObject[] {
  const registryPath = knowledgeToolRegistryPath();
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryFile;
  return (registry.tools ?? []).map(normalizeToolRegistryEntry);
}

export function readSourceDescriptor(id: string): SourceDescriptor {
  const path = resolve(knowledgeSourcesRoot(), id, "source.json");
  return JSON.parse(readFileSync(path, "utf8")) as SourceDescriptor;
}

export function readToolDescriptor(id: string): ToolDescriptor {
  const entry = toolRegistryEntry(id);
  const path = resolveToolRoot(id);
  const descriptor = JSON.parse(readFileSync(resolve(path, "tool.json"), "utf8")) as ToolDescriptor;
  return {
    ...descriptor,
    category: descriptor.category ?? entry?.category,
    path: descriptor.path ?? entry?.path,
    process_role: descriptor.process_role ?? entry?.process_role,
    usage: descriptor.usage ?? (descriptor as { workflow?: Record<string, unknown> }).workflow ?? entry?.usage ?? (entry as { workflow?: Record<string, unknown> } | undefined)?.workflow,
  };
}

export function toolRegistryEntry(id: string): ToolRegistryObject | undefined {
  return readToolRegistryEntries().find((entry) => entry.id === id);
}

export function resolveToolRoot(id: string): string {
  const entry = toolRegistryEntry(id);
  return resolve(knowledgeToolsRoot(), entry?.path ?? id);
}

function normalizeToolRegistryEntry(entry: ToolRegistryEntry): ToolRegistryObject {
  if (typeof entry === "string") {
    return { id: entry, path: entry };
  }
  return { ...entry, path: entry.path ?? entry.id };
}

export function resolvePackagePath(path: string): string {
  return path.startsWith("/") ? path : resolve(packageRoot(), path);
}
