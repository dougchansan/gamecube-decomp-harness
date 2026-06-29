import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadBoardSnapshot } from "./snapshot.js";

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("loadBoardSnapshot", () => {
  test("loads the upstream-current baseline for session worktrees without local reports", () => {
    const root = mkdtempSync(join(tmpdir(), "board-session-baseline-"));
    try {
      const projectRoot = resolve(root, "projects/melee");
      const upstreamRoot = resolve(projectRoot, "worktrees/upstream-current");
      const sessionCurrentRoot = resolve(projectRoot, "worktrees/sessions/session-uuid/current");
      mkdirSync(sessionCurrentRoot, { recursive: true });

      writeJson(resolve(upstreamRoot, "build/GALE01/report.json"), {
        measures: {
          matched_code_percent: 76.066864,
          complete_code_percent: 76.066864,
          matched_functions_percent: 70.5,
        },
        units: [
          {
            name: "melee/mp/mplib.c",
            metadata: { source_path: "src/melee/mp/mplib.c" },
            functions: [{ name: "mpCheckFloor", size: 128, fuzzy_match_percent: 99.677 }],
          },
        ],
      });
      writeJson(resolve(upstreamRoot, "objdiff.json"), {
        units: [
          {
            name: "melee/mp/mplib.c",
            metadata: { source_path: "src/melee/mp/mplib.c" },
          },
        ],
      });

      const snapshot = loadBoardSnapshot(sessionCurrentRoot, 12);

      expect(snapshot.reportPath).toBe(resolve(upstreamRoot, "build/GALE01/report.json"));
      expect(snapshot.measures.matched_code_percent).toBe(76.066864);
      expect(snapshot.candidates[0]?.symbol).toBe("mpCheckFloor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
