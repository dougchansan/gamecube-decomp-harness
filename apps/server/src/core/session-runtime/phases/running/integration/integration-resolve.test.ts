import { describe, expect, test } from "bun:test";
import { resolveResolverModel } from "./integration-resolve.js";
import type { GlobalArgs } from "@server/core/project-registry/runtime-options.js";

function baseGlobals(): GlobalArgs {
  return { repoRoot: "/repo", stateDir: "/state", dryRunAgents: false, provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "medium" };
}

describe("resolveResolverModel", () => {
  test("uses the --resolver-* overrides when set (glm instead of the campaign model)", () => {
    const args = new Map<string, string | true>([
      ["--resolver-provider", "zai"],
      ["--resolver-model", "glm-5.2"],
      ["--resolver-thinking-level", "low"],
    ]);
    expect(resolveResolverModel(args, baseGlobals())).toEqual({ provider: "zai", model: "glm-5.2", thinkingLevel: "low" });
  });

  test("falls back to globals.* per field when the override is unset", () => {
    expect(resolveResolverModel(new Map(), baseGlobals())).toEqual({ provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "medium" });
  });

  test("mixes overrides with fallbacks independently", () => {
    const args = new Map<string, string | true>([["--resolver-provider", "zai"]]);
    expect(resolveResolverModel(args, baseGlobals())).toEqual({ provider: "zai", model: "gpt-5.5", thinkingLevel: "medium" });
  });
});
