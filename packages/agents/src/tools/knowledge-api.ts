/**
 * Shared execution helpers for knowledge-backed Pi tools.
 *
 * These helpers are deliberately operation-oriented: source and tool ids are
 * validated against the orchestrator registries, command execution is limited
 * to known API scripts, and graph operations use in-process APIs where they
 * already exist.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "@decomp-orchestrator/core/shell";
import {
  fileGraphCard,
  graphDbExists,
  knowledgeSourcesRoot,
  openKnowledgeGraph,
  packageRoot,
  readSourceRegistry,
  readToolRegistry,
  resolveToolRoot,
  resourceGraphDbPath,
  searchKnowledgeGraph,
} from "@decomp-orchestrator/knowledge";
import type { AgentToolRuntimeContext } from "./types.js";
import { commandToolPayload } from "./util.js";

/** Determine the graph DB path from project metadata or global defaults. */
export function graphDbForContext(context: AgentToolRuntimeContext): string {
  return context.project?.graphDbPath ?? resourceGraphDbPath();
}

/** Return the set of currently registered knowledge source ids. */
export function registeredSourceIds(): Set<string> {
  return new Set(readSourceRegistry().map((source) => source.id));
}

/** Return the set of currently registered knowledge tool ids. */
export function registeredToolIds(): Set<string> {
  return new Set(readToolRegistry().map((tool) => tool.id));
}

/** Run a source-local API script with fixed arguments. */
export async function runSourceApi(sourceId: string, scriptName: string, args: string[]): Promise<Record<string, unknown>> {
  if (!registeredSourceIds().has(sourceId)) {
    return {
      status: "unknown_source_id",
      source_id: sourceId,
      available_source_ids: [...registeredSourceIds()].sort(),
    };
  }
  const cwd = packageRoot();
  const scriptPath = resolve(knowledgeSourcesRoot(), sourceId, "api", scriptName);
  if (!existsSync(scriptPath)) {
    return {
      status: "missing_api_script",
      source_id: sourceId,
      script_path: scriptPath,
    };
  }
  const command = ["python3", scriptPath, ...args];
  const result = await runCommand(cwd, command);
  return commandToolPayload({ operation: `source:${sourceId}:${scriptName}`, command, cwd, ...result });
}

/** Run a registered tool API script with fixed arguments. */
export async function runKnowledgeToolApi(toolId: string, scriptName: string, args: string[]): Promise<Record<string, unknown>> {
  if (!registeredToolIds().has(toolId)) {
    return {
      status: "unknown_tool_id",
      tool_id: toolId,
      available_tool_ids: [...registeredToolIds()].sort(),
    };
  }
  const cwd = packageRoot();
  const scriptPath = resolve(resolveToolRoot(toolId), "api", scriptName);
  if (!existsSync(scriptPath)) {
    return {
      status: "missing_api_script",
      tool_id: toolId,
      script_path: scriptPath,
    };
  }
  const command = ["python3", scriptPath, ...args];
  const result = await runCommand(cwd, command);
  return commandToolPayload({ operation: `tool:${toolId}:${scriptName}`, command, cwd, ...result });
}

/** Search the SQLite resource graph when it is available. */
export function graphSearch(context: AgentToolRuntimeContext, query: string, sourceId: string, limit: number): Record<string, unknown> {
  const graphDb = graphDbForContext(context);
  if (!graphDbExists(graphDb)) {
    return {
      status: "graph_missing",
      graph_db: graphDb,
    };
  }
  const store = openKnowledgeGraph(graphDb);
  try {
    return {
      status: "ok",
      graph_db: graphDb,
      query,
      source_id: sourceId || null,
      limit,
      results: searchKnowledgeGraph(store, { query, sourceId: sourceId || undefined, limit }),
    };
  } finally {
    store.db.close();
  }
}

/** Load a file-card summary from the SQLite resource graph when available. */
export function graphFileCard(context: AgentToolRuntimeContext, sourcePath: string): Record<string, unknown> {
  const graphDb = graphDbForContext(context);
  if (!sourcePath) {
    return {
      status: "missing_source_path",
      graph_db: graphDb,
    };
  }
  if (!graphDbExists(graphDb)) {
    return {
      status: "graph_missing",
      graph_db: graphDb,
      source_path: sourcePath,
    };
  }
  const store = openKnowledgeGraph(graphDb);
  try {
    return {
      status: "ok",
      graph_db: graphDb,
      file_card: fileGraphCard(store, sourcePath),
    };
  } finally {
    store.db.close();
  }
}
