import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sumTranscriptAssistantUsage, usageHasTokens } from "./pi-agent.js";

function writeTranscript(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  return path;
}

describe("sumTranscriptAssistantUsage", () => {
  test("sums per-message usage from a zai-shape transcript (usage nested under .message)", () => {
    // Mirrors a real zai/glm-5.2 worker transcript: {type:"message", message:{role, stopReason, usage}}
    const path = writeTranscript([
      { type: "session", id: "s", version: 1 },
      { type: "model_change", provider: "zai", modelId: "glm-5.2" },
      { type: "message", id: "u", message: { role: "user", content: [] } },
      { type: "message", id: "a1", message: { role: "assistant", stopReason: "toolUse", usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1, totalTokens: 126, cost: { total: 0 } } } },
      { type: "toolCall", id: "t1" },
      { type: "message", id: "a2", message: { role: "assistant", stopReason: "stop", usage: { input: 200, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 230, cost: { total: 0 } } } },
    ]);
    expect(sumTranscriptAssistantUsage(path)).toEqual({ inputTokens: 300, outputTokens: 50, cacheReadTokens: 5, cacheWriteTokens: 1, costUsd: 0 });
  });

  test("skips error/aborted assistant turns and ignores malformed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-transcript-bad-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ type: "message", id: "ok", message: { role: "assistant", stopReason: "stop", usage: { input: 42, output: 7 } } }),
        "{ this is not valid json",
        JSON.stringify({ type: "message", id: "err", message: { role: "assistant", stopReason: "error", usage: { input: 999, output: 999 } } }),
        "",
      ].join("\n"),
      "utf8",
    );
    expect(sumTranscriptAssistantUsage(path)).toEqual({ inputTokens: 42, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  test("returns undefined for a missing file or one with no assistant usage", () => {
    expect(sumTranscriptAssistantUsage("/no/such/transcript.jsonl")).toBeUndefined();
    expect(sumTranscriptAssistantUsage(undefined)).toBeUndefined();
    const noUsage = writeTranscript([{ type: "message", id: "u", message: { role: "user", content: [] } }, { type: "toolCall", id: "t" }]);
    expect(sumTranscriptAssistantUsage(noUsage)).toBeUndefined();
  });
});

describe("usageHasTokens", () => {
  test("true when any token field is non-zero", () => {
    expect(usageHasTokens({ inputTokens: 100, outputTokens: 0 })).toBe(true);
    expect(usageHasTokens({ inputTokens: 0, outputTokens: 5 })).toBe(true);
    expect(usageHasTokens({ cacheReadTokens: 3 })).toBe(true);
  });

  test("false for undefined or all-zero usage (codex-vs-zai gate)", () => {
    expect(usageHasTokens(undefined)).toBe(false);
    expect(usageHasTokens({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(false);
    expect(usageHasTokens({ costUsd: 0 })).toBe(false); // cost without tokens does not count
  });
});
