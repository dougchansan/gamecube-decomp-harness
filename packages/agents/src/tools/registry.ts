/**
 * Central catalog for reusable Pi custom tools.
 *
 * Agent profiles refer to tools by id so a capability can be shared by worker,
 * PR-review, curator, or future agents without duplicating prompt text or
 * command recipes.
 */
import type { RuntimeAgentRole } from "@decomp-orchestrator/core/types";
import { decompLookupToolRegistration } from "./decomp-lookup.js";
import { sourceSiloToolRegistrations } from "./source-silos.js";
import { specializedToolRegistrations } from "./specialized-tools.js";
import { workerContextToolRegistration } from "./worker-context.js";
import type { AgentToolRegistration, AgentToolRuntimeContext, PiToolDefinition } from "./types.js";

const toolRegistrations = [
  workerContextToolRegistration,
  decompLookupToolRegistration,
  ...sourceSiloToolRegistrations,
  ...specializedToolRegistrations,
] as const;

/** Complete reusable Pi tool catalog keyed by stable tool id. */
export const agentToolRegistry = Object.fromEntries(toolRegistrations.map((tool) => [tool.id, tool])) as Record<string, AgentToolRegistration>;

export type AgentToolId = keyof typeof agentToolRegistry;

/** Return true when the requested tool is allowed for the runtime role. */
export function toolAllowedForRole(tool: AgentToolRegistration, role: RuntimeAgentRole): boolean {
  return !tool.allowedRoles || tool.allowedRoles.includes(role);
}

/** Build concrete Pi tool definitions for a role after ids have been resolved. */
export function createAgentTools(toolIds: string[], context: AgentToolRuntimeContext): PiToolDefinition[] {
  const tools: PiToolDefinition[] = [];
  const seen = new Set<string>();
  for (const toolId of toolIds) {
    if (seen.has(toolId)) continue;
    seen.add(toolId);
    const registration = agentToolRegistry[toolId as AgentToolId];
    if (!registration || !toolAllowedForRole(registration, context.role)) continue;
    tools.push(registration.create(context));
  }
  return tools;
}

/** Summarize a resolved profile for prompt artifacts and dry-run transcripts. */
export function agentToolSummary(toolIds: string[], role: RuntimeAgentRole): Record<string, unknown>[] {
  return toolIds
    .map((toolId) => agentToolRegistry[toolId as AgentToolId])
    .filter((tool): tool is AgentToolRegistration => Boolean(tool) && toolAllowedForRole(tool, role))
    .map((tool) => ({
      id: tool.id,
      purpose: tool.purpose,
      capabilities: tool.capabilities,
    }));
}
