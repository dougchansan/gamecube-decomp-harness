/**
 * Shared types for composing Pi custom tools from reusable agent capabilities.
 *
 * The orchestrator keeps this interface intentionally small instead of tying
 * every caller to Pi SDK internals. The objects still match the SDK's custom
 * tool shape at runtime, while agent code can resolve tools by id, role, and
 * project context.
 */
import type { RunProjectMetadata, RuntimeAgentRole } from "@decomp-orchestrator/core/types";

export interface AgentToolRuntimeContext {
  role: RuntimeAgentRole;
  cwd: string;
  repoRoot: string;
  stateDir?: string;
  project?: RunProjectMetadata;
  packet?: Record<string, unknown>;
  initialBoardPath?: string;
  workerLogDir?: string;
}

export interface PiToolTextContent {
  type: "text";
  text: string;
}

export interface PiToolResult {
  content: PiToolTextContent[];
  details?: unknown;
}

export interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  executionMode?: "parallel" | "sequential";
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ): Promise<PiToolResult>;
}

export interface AgentToolRegistration {
  id: string;
  purpose: string;
  allowedRoles?: RuntimeAgentRole[];
  capabilities: string[];
  create(context: AgentToolRuntimeContext): PiToolDefinition;
}

export interface AgentToolProfileInput {
  replace?: string[];
  enable?: string[];
  disable?: string[];
}
