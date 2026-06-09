/**
 * Pi tool for loading agent context guides on demand.
 *
 * Worker prompts should not paste the full operating, lookup, and matching
 * guides into every turn. This tool lets an agent list the context selected for
 * its role/capabilities and read only the guide it needs.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { packageRoot } from "@decomp-orchestrator/knowledge";
import { agentContextReferences, readAgentContextManifest } from "../context.js";
import type { AgentToolRegistration, AgentToolRuntimeContext, PiToolDefinition } from "./types.js";
import { jsonToolResult } from "./util.js";

const workerContextParameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "read"],
      description: "Use list to see available guides; use read to load one guide or the selected guide set.",
    },
    context_id: {
      type: "string",
      description: "Guide id to read, such as worker_operating_guide, worker_lookup_guide, worker_matching_guide, or selected.",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

/** Return enabled capability ids from a packet without importing worker-only code. */
function packetCapabilities(packet: Record<string, unknown> | undefined): string[] {
  const raw = packet?.enabled_capabilities;
  return Array.isArray(raw) ? raw.map((value) => String(value)) : [];
}

/** Resolve the context ids selected for the current runtime role and packet. */
function selectedContextIds(context: AgentToolRuntimeContext): string[] {
  if (context.role !== "worker" && context.role !== "director") return [];
  return agentContextReferences(context.role, packetCapabilities(context.packet)).map((reference) => reference.id);
}

/** Read one manifest context by id and include path/provenance metadata. */
function readContextById(contextId: string): Record<string, unknown> {
  const manifest = readAgentContextManifest();
  const reference = manifest.references[contextId];
  if (!reference) {
    return {
      id: contextId,
      status: "missing_context_id",
      available_context_ids: Object.keys(manifest.references).sort(),
    };
  }
  const path = resolve(packageRoot(), reference.path);
  if (!existsSync(path)) {
    return {
      id: contextId,
      status: "missing_file",
      path,
      purpose: reference.purpose,
    };
  }
  return {
    id: contextId,
    status: "ok",
    path,
    role: reference.role,
    purpose: reference.purpose,
    content: readFileSync(path, "utf8"),
  };
}

/** Create the LLM-callable context loading tool for the supplied agent context. */
export function createWorkerContextTool(context: AgentToolRuntimeContext): PiToolDefinition {
  return {
    name: "worker_context_get",
    label: "Worker Context",
    description: "List or read orchestrator-owned worker operating, lookup, matching, and optional sweep guides.",
    promptSnippet: "worker_context_get: list or read the selected worker guide files on demand.",
    promptGuidelines: [
      "Use worker_context_get before relying on detailed worker operating, lookup, matching, or sweep policy that is not in the current prompt.",
      "Use worker_context_get with context_id=selected when you need the active guide bundle for this worker packet.",
    ],
    parameters: workerContextParameters,
    executionMode: "parallel",
    async execute(_toolCallId, params) {
      const action = String(params.action ?? "");
      const manifest = readAgentContextManifest();
      const selected = selectedContextIds(context);
      if (action === "list") {
        return jsonToolResult("worker_context_get", {
          status: "ok",
          role: context.role,
          selected_context_ids: selected,
          available_contexts: Object.entries(manifest.references)
            .map(([id, reference]) => ({
              id,
              role: reference.role,
              purpose: reference.purpose,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        });
      }
      if (action !== "read") {
        return jsonToolResult("worker_context_get", {
          status: "invalid_action",
          allowed_actions: ["list", "read"],
        });
      }
      const requestedId = String(params.context_id ?? "selected").trim() || "selected";
      const contextIds = requestedId === "selected" ? selected : [requestedId];
      return jsonToolResult("worker_context_get", {
        status: "ok",
        role: context.role,
        requested_context_id: requestedId,
        contexts: contextIds.map(readContextById),
      });
    },
  };
}

export const workerContextToolRegistration: AgentToolRegistration = {
  id: "worker_context_get",
  purpose: "Load selected worker context guide files on demand instead of embedding them in every prompt.",
  allowedRoles: ["worker"],
  capabilities: ["context_guides", "worker_operating_policy"],
  create: createWorkerContextTool,
};
