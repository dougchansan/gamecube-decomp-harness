import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLadder } from "./ladder.js";

async function ladderPath(maxAttempts: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ladder-budget-"));
  const path = join(dir, "ladder.json");
  await writeFile(
    path,
    JSON.stringify({
      id: "test-ladder",
      mode: "escalation",
      rungs: [
        {
          provider: "openai-codex",
          model: "gpt-5.3-codex-spark",
          thinking: "medium",
          budget: { agentTimeoutSeconds: 1200, ttlSeconds: 7200, maxAttempts },
        },
      ],
    }),
  );
  return path;
}

describe("loadLadder rung attempt budgets", () => {
  test("loads a positive integer maxAttempts", async () => {
    const ladder = loadLadder(await ladderPath(1));
    expect(ladder.rungs[0]?.budget.maxAttempts).toBe(1);
  });

  test("rejects a non-positive maxAttempts", async () => {
    const path = await ladderPath(0);
    expect(() => loadLadder(path)).toThrow("must define a positive integer budget.maxAttempts");
  });
});
