/**
 * Pi tool for routed decomp knowledge lookup.
 *
 * This is the first reusable lookup surface shared by future agents. It exposes
 * bounded operations over the resource graph, source APIs, and registered tool
 * APIs without requiring the prompt to carry raw filesystem paths or command
 * recipes.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "@decomp-orchestrator/core/shell";
import {
  fileGraphCard,
  globalStandardsContext,
  graphDbExists,
  openKnowledgeGraph,
  packageRoot,
  readSourceRegistry,
  readToolRegistry,
  resolveToolRoot,
  resolvePathFactsContext,
  resourceGraphDbPath,
  searchKnowledgeGraph,
  sourceRoot,
} from "@decomp-orchestrator/knowledge";
import type { AgentToolRegistration, AgentToolRuntimeContext, PiToolDefinition } from "./types.js";
import { boundedLimit, commandToolPayload, jsonToolResult, safeRegistryId } from "./util.js";

const lookupParameters = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      enum: [
        "file_card",
        "graph_search",
        "source_search",
        "source_status",
        "tool_lookup",
        "tool_status",
        "path_facts",
        "standards",
        "powerpc_instruction",
      ],
      description: "The bounded lookup operation to run.",
    },
    query: {
      type: "string",
      description: "Search term, symbol, address, opcode pattern, mismatch symptom, or instruction mnemonic depending on operation.",
    },
    source_id: {
      type: "string",
      description: "Registered source id for source_search/source_status or graph_search filtering.",
    },
    tool_id: {
      type: "string",
      description: "Registered tool id for tool_lookup/tool_status, such as ghidra, opseq, mismatch_db, or mwcc_debug.",
    },
    source_path: {
      type: "string",
      description: "Project-relative source path for file_card or path_facts.",
    },
    limit: {
      type: "number",
      description: "Maximum results to return. Values are clamped to a small safe bound.",
    },
  },
  required: ["operation"],
  additionalProperties: false,
};

const toolLookupScripts: Record<string, string[]> = {
  ghidra: ["lookup.py"],
  opseq: ["similar_functions.py"],
  mismatch_db: ["search.py"],
  mwcc_debug: ["lookup_dump.py"],
};

/** Determine the graph DB path from project metadata or global defaults. */
function graphDbForContext(context: AgentToolRuntimeContext): string {
  return context.project?.graphDbPath ?? resourceGraphDbPath();
}

/** Return the set of currently registered knowledge source ids. */
function registeredSourceIds(): Set<string> {
  return new Set(readSourceRegistry().map((source) => source.id));
}

/** Return the set of currently registered knowledge tool ids. */
function registeredToolIds(): Set<string> {
  return new Set(readToolRegistry().map((tool) => tool.id));
}

/** Run a source-local API script with fixed arguments. */
async function runSourceApi(sourceId: string, scriptName: string, args: string[]): Promise<Record<string, unknown>> {
  const cwd = packageRoot();
  const scriptPath = resolve(sourceRoot(sourceId), "api", scriptName);
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
async function runToolApi(toolId: string, scriptName: string, args: string[]): Promise<Record<string, unknown>> {
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
function graphSearch(context: AgentToolRuntimeContext, query: string, sourceId: string, limit: number): Record<string, unknown> {
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
function graphFileCard(context: AgentToolRuntimeContext, sourcePath: string): Record<string, unknown> {
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

/** Create the LLM-callable decomp lookup tool for the supplied agent context. */
export function createDecompLookupTool(context: AgentToolRuntimeContext): PiToolDefinition {
  return {
    name: "decomp_lookup",
    label: "Decomp Lookup",
    description: "Query resource graph cards/search, source indexes, path facts, standards, and registered decomp tool APIs.",
    promptSnippet: "decomp_lookup: bounded lookup across graph cards/search, source indexes, path facts, standards, and decomp tool APIs.",
    promptGuidelines: [
      "Use decomp_lookup for concrete source paths, symbols, addresses, opcode patterns, mismatch symptoms, data-sheet terms, PR history, and MWCC/compiler questions.",
      "Use decomp_lookup results as evidence with provenance; verify source edits with local source, builds, and objdiff/checkdiff.",
    ],
    parameters: lookupParameters,
    executionMode: "parallel",
    async execute(_toolCallId, params) {
      const operation = String(params.operation ?? "");
      const query = String(params.query ?? "").trim();
      const sourcePath = String(params.source_path ?? "").trim();
      const sourceId = safeRegistryId(params.source_id);
      const toolId = safeRegistryId(params.tool_id);
      const limit = boundedLimit(params.limit);

      if (operation === "file_card") {
        return jsonToolResult("decomp_lookup", graphFileCard(context, sourcePath));
      }
      if (operation === "graph_search") {
        if (!query) return jsonToolResult("decomp_lookup", { status: "missing_query", operation });
        if (sourceId && !registeredSourceIds().has(sourceId)) {
          return jsonToolResult("decomp_lookup", { status: "unknown_source_id", source_id: sourceId, available_source_ids: [...registeredSourceIds()].sort() });
        }
        return jsonToolResult("decomp_lookup", graphSearch(context, query, sourceId, limit));
      }
      if (operation === "source_status") {
        if (!sourceId) {
          return jsonToolResult("decomp_lookup", {
            status: "ok",
            sources: readSourceRegistry().map((source) => ({
              id: source.id,
              title: source.title,
              section: source.section,
              trust_tier: source.trust_tier,
              access_modes: source.access_modes ?? [],
              capabilities: source.capabilities,
            })),
          });
        }
        if (!registeredSourceIds().has(sourceId)) {
          return jsonToolResult("decomp_lookup", { status: "unknown_source_id", source_id: sourceId, available_source_ids: [...registeredSourceIds()].sort() });
        }
        return jsonToolResult("decomp_lookup", await runSourceApi(sourceId, "status.py", ["--json"]));
      }
      if (operation === "source_search") {
        if (!sourceId) return jsonToolResult("decomp_lookup", { status: "missing_source_id", operation });
        if (!query) return jsonToolResult("decomp_lookup", { status: "missing_query", operation });
        if (!registeredSourceIds().has(sourceId)) {
          return jsonToolResult("decomp_lookup", { status: "unknown_source_id", source_id: sourceId, available_source_ids: [...registeredSourceIds()].sort() });
        }
        return jsonToolResult("decomp_lookup", await runSourceApi(sourceId, "search.py", ["--query", query, "--limit", String(limit), "--json"]));
      }
      if (operation === "tool_status") {
        if (!toolId) {
          return jsonToolResult("decomp_lookup", {
            status: "ok",
            tools: readToolRegistry().map((tool) => ({
              id: tool.id,
              title: tool.title,
              category: tool.category,
              path: tool.path,
              trust_tier: tool.trust_tier,
              process_role: tool.process_role,
              capabilities: tool.capabilities,
              usage: tool.usage,
              description: tool.description,
            })),
          });
        }
        const tool = readToolRegistry().find((candidate) => candidate.id === toolId);
        if (!tool) {
          return jsonToolResult("decomp_lookup", { status: "unknown_tool_id", tool_id: toolId, available_tool_ids: [...registeredToolIds()].sort() });
        }
        const args = tool.commands?.status?.includes("--repo-root") ? ["--repo-root", context.repoRoot, "--json"] : ["--json"];
        return jsonToolResult("decomp_lookup", await runToolApi(toolId, "status.py", args));
      }
      if (operation === "tool_lookup") {
        if (!toolId) return jsonToolResult("decomp_lookup", { status: "missing_tool_id", operation });
        if (!query) return jsonToolResult("decomp_lookup", { status: "missing_query", operation });
        const script = toolLookupScripts[toolId]?.[0];
        if (!script || !registeredToolIds().has(toolId)) {
          return jsonToolResult("decomp_lookup", { status: "unsupported_tool_lookup", tool_id: toolId, available_tool_ids: Object.keys(toolLookupScripts).sort() });
        }
        return jsonToolResult("decomp_lookup", await runToolApi(toolId, script, ["--query", query, "--limit", String(limit), "--json"]));
      }
      if (operation === "path_facts") {
        const path = sourcePath || query;
        if (!path) return jsonToolResult("decomp_lookup", { status: "missing_source_path", operation });
        return jsonToolResult("decomp_lookup", {
          status: "ok",
          operation,
          source_path: path,
          result: resolvePathFactsContext(path, limit),
        });
      }
      if (operation === "standards") {
        return jsonToolResult("decomp_lookup", {
          status: "ok",
          operation,
          global_standards: globalStandardsContext(),
        });
      }
      if (operation === "powerpc_instruction") {
        if (!query) return jsonToolResult("decomp_lookup", { status: "missing_query", operation });
        return jsonToolResult("decomp_lookup", await runSourceApi("powerpc_docs", "lookup_instruction.py", ["--mnemonic", query, "--limit", String(limit), "--json"]));
      }
      return jsonToolResult("decomp_lookup", {
        status: "invalid_operation",
        operation,
        allowed_operations: lookupParameters.properties.operation.enum,
      });
    },
  };
}

export const decompLookupToolRegistration: AgentToolRegistration = {
  id: "decomp_lookup",
  purpose: "Reusable bounded lookup over decomp resource graph, source indexes, path facts, standards, and tool APIs.",
  allowedRoles: ["worker", "pr-review", "knowledge-curator"],
  capabilities: ["knowledge_lookup", "graph_search", "source_api_lookup", "tool_api_lookup"],
  create: createDecompLookupTool,
};
