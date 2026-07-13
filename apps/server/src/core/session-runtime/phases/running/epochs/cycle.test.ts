import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { commitEpochSnapshot } from "./cycle.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, args: string[]): void {
  const proc = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (proc.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr}`);
}

function gitExit(repo: string, args: string[]): number {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).status ?? 1;
}

function head(repo: string): string {
  return readFileSync(resolve(repo, ".git/refs/heads/main"), "utf8").trim();
}

function setupRepo(): { repo: string; base: string } {
  const repo = mkdtempSync(resolve(tmpdir(), "epoch-payload-gate-"));
  tempDirs.push(repo);
  mkdirSync(resolve(repo, "src"), { recursive: true });
  mkdirSync(resolve(repo, "include"), { recursive: true });
  writeFileSync(resolve(repo, "src/unit.c"), "int value = 0;\n");
  writeFileSync(resolve(repo, "README.md"), "base metrics\n");
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "epoch-test@example.invalid"]);
  git(repo, ["config", "user.name", "Epoch Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "base"]);
  return { repo, base: head(repo) };
}

async function snapshot(repo: string, excludePaths: string[] = []) {
  return commitEpochSnapshot({
    repoRoot: repo,
    excludePaths,
    stateDirRelative: null,
    message: "epoch(test): snapshot",
  });
}

describe("epoch snapshot payload gate", () => {
  test("does not commit a clean tree", async () => {
    const { repo, base } = setupRepo();
    const result = await snapshot(repo);
    expect(result).toMatchObject({ committed: false, warning: null });
    expect(head(repo)).toBe(base);
  });

  test("does not commit README-only metadata", async () => {
    const { repo, base } = setupRepo();
    writeFileSync(resolve(repo, "README.md"), "refreshed metrics\n");
    const result = await snapshot(repo);
    expect(result).toMatchObject({ committed: false, warning: null });
    expect(head(repo)).toBe(base);
    expect(gitExit(repo, ["diff", "--cached", "--quiet", "--", "README.md"])).toBe(1);
  });

  test("commits a tracked source edit together with pending metadata", async () => {
    const { repo, base } = setupRepo();
    writeFileSync(resolve(repo, "README.md"), "refreshed metrics\n");
    writeFileSync(resolve(repo, "src/unit.c"), "int value = 1;\n");
    const result = await snapshot(repo);
    expect(result.committed).toBe(true);
    expect(head(repo)).not.toBe(base);
    expect(gitExit(repo, ["diff-tree", "--quiet", "HEAD^", "HEAD", "--", "README.md"])).toBe(1);
    expect(gitExit(repo, ["diff-tree", "--quiet", "HEAD^", "HEAD", "--", "src/unit.c"])).toBe(1);
  });

  test("commits tracked deletions and untracked headers", async () => {
    const deleted = setupRepo();
    rmSync(resolve(deleted.repo, "src/unit.c"));
    expect((await snapshot(deleted.repo)).committed).toBe(true);

    const added = setupRepo();
    writeFileSync(resolve(added.repo, "include/new.h"), "#define NEW_VALUE 1\n");
    expect((await snapshot(added.repo)).committed).toBe(true);
  });

  test("does not commit an actively excluded source path", async () => {
    const { repo, base } = setupRepo();
    writeFileSync(resolve(repo, "src/unit.c"), "int value = 2;\n");
    const result = await snapshot(repo, ["src/unit.c"]);
    expect(result).toMatchObject({ committed: false, warning: null });
    expect(head(repo)).toBe(base);
    expect(gitExit(repo, ["diff", "--quiet", "--", "src/unit.c"])).toBe(1);
  });
});
