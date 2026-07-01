export type PiSessionStatus = "dry_run" | "running" | "succeeded" | "failed";

export interface PiRunResult {
  sessionId: string;
  sessionFile?: string;
  sessionDir?: string;
  outputPath: string;
  systemPromptPath: string;
  userPromptPath: string;
  rawText: string;
  dryRun: boolean;
  failed?: boolean;
  error?: string;
  // Set when the session's final assistant turn ended with a provider error
  // (stopReason "error"), e.g. every retry timed out against the LLM endpoint.
  // The session "completed" from the SDK's perspective but produced no usable turn.
  providerError?: string;
  // Telemetry (Track B): token/cost usage surfaced from the agent runtime.
  // Fields are optional/best-effort — shapes differ between the Pi SDK and the
  // claude-code CLI, so a parse miss leaves them undefined rather than throwing.
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: number;
  };
  // ISO timestamp captured when runPiAgent returns.
  endedAt?: string;
}
