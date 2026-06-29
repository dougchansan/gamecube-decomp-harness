import { parseJsonObject } from "@server/infrastructure/agent-runtime/runtime";

export function parseWorkerCheckpointNote(rawText: string): { note: Record<string, unknown> | null; error?: string } {
  const parsed = parseJsonObject(rawText);
  return { note: parsed.object, error: parsed.error };
}
