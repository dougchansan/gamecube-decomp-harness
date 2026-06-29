import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  knowledgeSourceRegistryPath,
  knowledgeSourcesRoot,
  knowledgeToolRegistryPath,
  knowledgeToolsRoot,
  packageRoot,
  sourceRoot,
} from "../../paths.js";
import type {
  SourceDescriptor,
  SourceRegistryEntry,
  SourceRegistryObject,
  ToolDescriptor,
  ToolRegistryEntry,
  ToolRegistryObject,
} from "../types.js";

interface RegistryFile {
  sources?: SourceRegistryEntry[];
  tools?: ToolRegistryEntry[];
}

export function readSourceRegistry(): SourceDescriptor[] {
  return readSourceRegistryEntries().map((entry) => readSourceDescriptor(entry));
}

export function readSourceRegistryEntries(): SourceRegistryObject[] {
  const registryPath = knowledgeSourceRegistryPath();
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryFile;
  const entries = (registry.sources ?? []).map(normalizeSourceRegistryEntry);
  return entries.filter((entry) => entry.active !== false);
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

export function readSourceDescriptor(entry: string | SourceRegistryObject): SourceDescriptor {
  const normalized = normalizeSourceRegistryEntry(entry);
  const root = normalized.path ? resolve(knowledgeSourcesRoot(), normalized.path) : sourceRoot(normalized.id);
  const path = resolve(root, "source.json");
  const descriptor = JSON.parse(readFileSync(path, "utf8")) as SourceDescriptor;
  return {
    ...descriptor,
    section: descriptor.section ?? normalized.section,
    access_modes: descriptor.access_modes ?? normalized.access_modes,
    active: descriptor.active ?? normalized.active ?? true,
    path: descriptor.path ?? normalized.path ?? normalized.id,
  };
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

function normalizeSourceRegistryEntry(entry: SourceRegistryEntry): SourceRegistryObject {
  if (typeof entry === "string") {
    return { id: entry, path: entry, active: true };
  }
  return { ...entry, path: entry.path ?? entry.id, active: entry.active ?? true };
}

export function resolvePackagePath(path: string): string {
  return path.startsWith("/") ? path : resolve(packageRoot(), path);
}
