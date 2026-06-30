/**
 * Source-specific Pi tools for each knowledge silo.
 *
 * The model should choose the source it needs, such as code graph, PowerPC
 * docs, standards, or path facts, instead of sending every query through one
 * generic lookup endpoint.
 */
import { globalStandardsContext, resolvePathFactsContext } from "@server/core/knowledge";
import { graphFileCard, graphSearch, runSourceApi } from "../runtime/execution.js";
import type { AgentToolRegistration, AgentToolRuntimeContext, PiToolDefinition } from "../types.js";
import { boundedLimit, jsonToolResult } from "../runtime/results.js";

const sourceContextToolRoles = [
  "worker",
  "integration-resolver",
  "pr-indexer",
  "pr-splitter",
  "knowledge-curator",
  "pr-fixer",
  "reconcile",
  "qa-repair",
] as const;

const searchParameters = {
  type: "object",
  properties: {
    query: { type: "string", description: "Concrete term, source path, symbol, address, field, opcode, or review term to search." },
    limit: { type: "number", description: "Maximum results to return. Values are clamped to a small safe bound." },
  },
  required: ["query"],
  additionalProperties: false,
};

const fileCardParameters = {
  type: "object",
  properties: {
    source_path: { type: "string", description: "Project-relative source file path." },
  },
  required: ["source_path"],
  additionalProperties: false,
};

const pathFactsParameters = {
  type: "object",
  properties: {
    source_path: { type: "string", description: "Project-relative source file path." },
    limit: { type: "number", description: "Maximum path facts to return." },
  },
  required: ["source_path"],
  additionalProperties: false,
};

const powerpcInstructionParameters = {
  type: "object",
  properties: {
    mnemonic: { type: "string", description: "PowerPC instruction mnemonic such as stwu, rlwinm, fcmpo, or cror." },
    limit: { type: "number", description: "Maximum documentation chunks to return." },
  },
  required: ["mnemonic"],
  additionalProperties: false,
};

const noArgumentParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

interface SourceSearchDefinition {
  id: string;
  sourceId: string;
  label: string;
  purpose: string;
  description: string;
  guidance: string;
  graphBacked?: boolean;
}

/** Create a source-specific search tool backed by either graph search or a source API. */
function sourceSearchTool(definition: SourceSearchDefinition): AgentToolRegistration {
  return {
    id: definition.id,
    purpose: definition.purpose,
    allowedRoles: [...sourceContextToolRoles],
    capabilities: ["knowledge_source_search", definition.sourceId],
    create(context) {
      return {
        name: definition.id,
        label: definition.label,
        description: definition.description,
        promptSnippet: `${definition.id}: ${definition.purpose}`,
        promptGuidelines: [definition.guidance],
        parameters: searchParameters,
        executionMode: "parallel",
        async execute(_toolCallId, params) {
          const query = String(params.query ?? "").trim();
          if (!query) return jsonToolResult(definition.id, { status: "missing_query" });
          const limit = boundedLimit(params.limit);
          const payload = definition.graphBacked
            ? graphSearch(context, query, definition.sourceId, limit)
            : await runSourceApi(definition.sourceId, "search.py", ["--query", query, "--limit", String(limit), "--json"]);
          return jsonToolResult(definition.id, payload);
        },
      };
    },
  };
}

/** Create a fixed-argument source API tool for non-search operations. */
function fixedSourceApiTool(params: {
  id: string;
  sourceId: string;
  label: string;
  purpose: string;
  description: string;
  guidance: string;
  parameters: Record<string, unknown>;
  args(toolParams: Record<string, unknown>): string[] | Record<string, unknown>;
  scriptName: string;
}): AgentToolRegistration {
  return {
    id: params.id,
    purpose: params.purpose,
    allowedRoles: [...sourceContextToolRoles],
    capabilities: ["knowledge_source_lookup", params.sourceId],
    create() {
      return {
        name: params.id,
        label: params.label,
        description: params.description,
        promptSnippet: `${params.id}: ${params.purpose}`,
        promptGuidelines: [params.guidance],
        parameters: params.parameters,
        executionMode: "parallel",
        async execute(_toolCallId, toolParams) {
          const args = params.args(toolParams);
          if (!Array.isArray(args)) return jsonToolResult(params.id, args);
          return jsonToolResult(params.id, await runSourceApi(params.sourceId, params.scriptName, args));
        },
      };
    },
  };
}

/** Create a source API tool that lists pending update proposals for a silo. */
function proposalSourceApiTool(params: {
  id: string;
  sourceId: string;
  label: string;
  purpose: string;
  description: string;
  guidance: string;
}): AgentToolRegistration {
  return fixedSourceApiTool({
    ...params,
    parameters: noArgumentParameters,
    scriptName: "proposals.py",
    args() {
      return ["--json"];
    },
  });
}

/** Tool for retrieving the graph-owned context packet for one source file. */
export const codeGraphFileCardToolRegistration: AgentToolRegistration = {
  id: "code_graph_file_card",
  purpose: "Load the graph file card for one source path, including editability, match status, PR history, resources, and scheduling signals.",
  allowedRoles: [...sourceContextToolRoles],
  capabilities: ["code_graph", "file_card", "target_context"],
  create(context): PiToolDefinition {
    return {
      name: "code_graph_file_card",
      label: "Code Graph File Card",
      description: "Load graph-owned source-file context for a project-relative path.",
      promptSnippet: "code_graph_file_card: load editability, match status, PR history, resource hits, and scheduling signals for a source path.",
      promptGuidelines: ["Use code_graph_file_card first when a worker needs target-specific graph context for the claimed source path."],
      parameters: fileCardParameters,
      executionMode: "parallel",
      async execute(_toolCallId, params) {
        const sourcePath = String(params.source_path ?? "").trim();
        return jsonToolResult("code_graph_file_card", graphFileCard(context, sourcePath));
      },
    };
  },
};

/** Tool for searching local code graph entities and metadata. */
export const codeGraphSearchToolRegistration = sourceSearchTool({
  id: "code_graph_search",
  sourceId: "code_graph",
  label: "Code Graph Search",
  purpose: "Search graph-indexed local code entities and file/function metadata.",
  description: "Search the code graph slice for source paths, symbols, functions, units, and local code metadata.",
  guidance: "Use code_graph_search for local source paths, symbols, functions, units, and graph-indexed code metadata.",
  graphBacked: true,
});

/** Tool for searching indexed PowerPC reference documentation. */
export const powerpcDocsSearchToolRegistration = sourceSearchTool({
  id: "powerpc_docs_search",
  sourceId: "powerpc_docs",
  label: "PowerPC Docs Search",
  purpose: "Search indexed PowerPC PDF/docs chunks for ABI and instruction behavior.",
  description: "Search PowerPC documentation chunks for ABI, registers, instructions, branches, conversions, and condition-register behavior.",
  guidance: "Use powerpc_docs_search for ABI, register, stack-frame, condition-register, branch, conversion, and instruction documentation questions.",
});

/** Tool for exact PowerPC mnemonic lookup. */
export const powerpcInstructionLookupToolRegistration = fixedSourceApiTool({
  id: "powerpc_instruction_lookup",
  sourceId: "powerpc_docs",
  label: "PowerPC Instruction Lookup",
  purpose: "Look up documentation chunks for one PowerPC instruction mnemonic.",
  description: "Lookup a PowerPC instruction mnemonic in indexed PDF/documentation pages.",
  guidance: "Use powerpc_instruction_lookup when the question is a concrete mnemonic such as stwu, rlwinm, fcmpo, fcmpu, cror, or mtctr.",
  parameters: powerpcInstructionParameters,
  scriptName: "lookup_instruction.py",
  args(params) {
    const mnemonic = String(params.mnemonic ?? "").trim();
    if (!mnemonic) return { status: "missing_mnemonic" };
    return ["--mnemonic", mnemonic, "--limit", String(boundedLimit(params.limit)), "--json"];
  },
});

/** Tool for listing proposed updates to global decomp standards. */
export const decompStandardsProposalsToolRegistration = proposalSourceApiTool({
  id: "decomp_standards_proposals",
  sourceId: "decomp_standards",
  label: "Decomp Standards Proposals",
  purpose: "List pending proposal records for global decomp standards.",
  description: "Return proposal-only records that could become decomp standards after validation.",
  guidance: "Use decomp_standards_proposals when curating or reviewing potential standards updates; workers should treat proposal rows as unaccepted hints.",
});

/** Tool for reloading the compact global standards bundle already injected into worker context. */
export const decompStandardsContextToolRegistration: AgentToolRegistration = {
  id: "decomp_standards_context",
  purpose: "Return the compact global decomp standards context that is also preloaded into worker packets.",
  allowedRoles: [...sourceContextToolRoles],
  capabilities: ["decomp_standards", "preloaded_context"],
  create(): PiToolDefinition {
    return {
      name: "decomp_standards_context",
      label: "Decomp Standards Context",
      description: "Return the compact global standards context used by agent prompts and worker packets.",
      promptSnippet: "decomp_standards_context: return the compact preloaded global decomp standards context.",
      promptGuidelines: ["Use decomp_standards_context only when you need to inspect the compact standards bundle already available to the worker."],
      parameters: { type: "object", properties: {}, additionalProperties: false },
      executionMode: "parallel",
      async execute() {
        return jsonToolResult("decomp_standards_context", {
          status: "ok",
          global_standards: globalStandardsContext(),
        });
      },
    };
  },
};

/** Tool for resolving accepted path-scoped facts for one source path. */
export const pathFactsResolveToolRegistration: AgentToolRegistration = {
  id: "path_facts_resolve",
  purpose: "Resolve bounded path-scoped decomp facts for one source path.",
  allowedRoles: [...sourceContextToolRoles],
  capabilities: ["path_facts", "path_scoped_context"],
  create(): PiToolDefinition {
    return {
      name: "path_facts_resolve",
      label: "Path Facts Resolve",
      description: "Resolve graph-owned path-scoped facts and hints for one project-relative source path.",
      promptSnippet: "path_facts_resolve: resolve bounded path-scoped decomp facts for one source path.",
      promptGuidelines: ["Use path_facts_resolve when a target source path needs scoped facts or directory-slice hints."],
      parameters: pathFactsParameters,
      executionMode: "parallel",
      async execute(_toolCallId, params) {
        const sourcePath = String(params.source_path ?? "").trim();
        if (!sourcePath) return jsonToolResult("path_facts_resolve", { status: "missing_source_path" });
        return jsonToolResult("path_facts_resolve", {
          status: "ok",
          source_path: sourcePath,
          result: resolvePathFactsContext(sourcePath, boundedLimit(params.limit, 5, 10)),
        });
      },
    };
  },
};

/** Tool for listing proposal-only path fact updates. */
export const pathFactsProposalsToolRegistration = proposalSourceApiTool({
  id: "path_facts_proposals",
  sourceId: "path_facts",
  label: "Path Facts Proposals",
  purpose: "List pending proposal records for path-scoped decomp facts.",
  description: "Return proposal-only records that could become path facts after validation.",
  guidance: "Use path_facts_proposals when curating or reviewing path-fact updates; workers should treat proposal rows as unaccepted hints.",
});

/** All knowledge-source Pi tool registrations, kept reusable across agent profiles. */
export const knowledgeToolRegistrations = [
  codeGraphFileCardToolRegistration,
  codeGraphSearchToolRegistration,
  powerpcDocsSearchToolRegistration,
  powerpcInstructionLookupToolRegistration,
  decompStandardsProposalsToolRegistration,
  decompStandardsContextToolRegistration,
  pathFactsResolveToolRegistration,
  pathFactsProposalsToolRegistration,
] as const;
