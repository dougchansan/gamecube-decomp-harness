import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PreparingRuntimeDeps, PreparingRuntimeProjectContext } from "../runtime-shared.js";
import { syncProjectGitAndFindMergedPrs } from "./git-intake.js";

let tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prepare-git-intake-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs = [];
});

describe("prepare git intake", () => {
  test("fetches upstream and prepares worktrees without rebasing the control checkout", async () => {
    const root = tempDir();
    const repoRoot = resolve(root, "checkout");
    const projectDir = root;
    const calls: string[][] = [];
    let revParseCount = 0;
    const deps = {
      appendLog: () => undefined,
      runGit: async (_repoRoot: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "rev-parse" && args.at(-1) === "origin/master") {
          revParseCount += 1;
          return { exitCode: 0, stdout: `${revParseCount === 1 ? "aaaaaaaaaa" : "bbbbbbbbbb"}\n`, stderr: "" };
        }
        if (args[0] === "worktree" && args[1] === "list") return { exitCode: 0, stdout: "", stderr: "" };
        if (args[0] === "show-ref") return { exitCode: 1, stdout: "", stderr: "" };
        if (args[0] === "branch") return { exitCode: 0, stdout: "pr-2731\n", stderr: "" };
        if (args[0] === "log") return { exitCode: 0, stdout: "Merge pull request #2731 from doldecomp/example\n", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    } as unknown as PreparingRuntimeDeps;
    const paths = {
      project: { baseRef: "origin/master", projectDir },
      repoRoot,
      stateDir: resolve(root, "state"),
      graphDbPath: resolve(root, "graph.sqlite"),
    } as unknown as PreparingRuntimeProjectContext;

    const result = await syncProjectGitAndFindMergedPrs(deps, paths, "session-uuid");

    expect(calls.map((args) => args[0])).toContain("fetch");
    expect(calls.some((args) => args[0] === "pull")).toBe(false);
    expect(calls.some((args) => args[0] === "rebase")).toBe(false);
    expect(calls.some((args) => args.join(" ") === `worktree add --detach ${resolve(projectDir, "worktrees/upstream-current")} bbbbbbbbbb`)).toBe(true);
    expect(calls.some((args) => args.join(" ") === `worktree add -b orchestrator/session/session-uuid ${resolve(projectDir, "worktrees/sessions/session-uuid/current")} bbbbbbbbbb`)).toBe(true);
    expect(result.upstreamWorktreePath).toBe(resolve(projectDir, "worktrees/upstream-current"));
    expect(result.mainWorktreePath).toBe(resolve(projectDir, "worktrees/upstream-current"));
    expect(result.sessionCurrentWorktreePath).toBe(resolve(projectDir, "worktrees/sessions/session-uuid/current"));
    expect(result.sessionWorktreePath).toBe(resolve(projectDir, "worktrees/sessions/session-uuid/current"));
    expect(result.mergedPrs).toEqual([2731]);
  });
});
