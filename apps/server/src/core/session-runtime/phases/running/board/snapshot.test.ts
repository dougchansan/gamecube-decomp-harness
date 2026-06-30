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
      const projectRoot = resolve(root, "projects/pkmn-colosseum");
      const upstreamRoot = resolve(projectRoot, "worktrees/upstream-current");
      const sessionCurrentRoot = resolve(projectRoot, "worktrees/sessions/session-uuid/current");
      mkdirSync(sessionCurrentRoot, { recursive: true });

      writeJson(resolve(upstreamRoot, "build/GC6E01/report.json"), {
        measures: {
          matched_code_percent: 76.066864,
          complete_code_percent: 76.066864,
          matched_functions_percent: 70.5,
        },
        units: [
          {
            name: "colosseum/mp/mplib.c",
            metadata: { source_path: "src/colosseum/mp/mplib.c" },
            functions: [{ name: "mpCheckFloor", size: 128, fuzzy_match_percent: 99.677 }],
          },
        ],
      });
      writeJson(resolve(upstreamRoot, "objdiff.json"), {
        units: [
          {
            name: "colosseum/mp/mplib.c",
            metadata: { source_path: "src/colosseum/mp/mplib.c" },
          },
        ],
      });

      const snapshot = loadBoardSnapshot(sessionCurrentRoot, 12);

      expect(snapshot.reportPath).toBe(resolve(upstreamRoot, "build/GC6E01/report.json"));
      expect(snapshot.measures.matched_code_percent).toBe(76.066864);
      expect(snapshot.candidates[0]?.symbol).toBe("mpCheckFloor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds source-conversion candidates from func_tu_map and active source class", () => {
    const root = mkdtempSync(join(tmpdir(), "board-source-progress-"));
    try {
      writeJson(resolve(root, "build/GC6E01/report.json"), {
        measures: {},
        units: [
          {
            name: "main/auto_01_800055E0_text",
            metadata: {},
            functions: [
              { name: "fn_80001000", size: 64, fuzzy_match_percent: 100 },
              { name: "fn_80002000", size: 32, fuzzy_match_percent: 100 },
              { name: "fn_80003000", size: 48, fuzzy_match_percent: 100 },
            ],
          },
        ],
      });
      writeJson(resolve(root, "objdiff.json"), { units: [{ name: "main/auto_01_800055E0_text", metadata: {} }] });
      writeJson(resolve(root, "config/GC6E01/func_tu_map.json"), {
        fn_80001000: { src: "src/game/foo.c", status: "KNOWN", size: "0x40", addr: "0x80001000" },
        fn_80002000: { src: "src/game/foo.c", status: "KNOWN", size: "0x20", addr: "0x80002000" },
        fn_80003000: { src: "src/game/foo.c", status: "KNOWN", size: "0x30", addr: "0x80003000" },
      });
      mkdirSync(resolve(root, "src/game"), { recursive: true });
      writeFileSync(
        resolve(root, "src/game/foo.c"),
        [
          "asm void fn_80001000(void) {",
          "#include \"fn_80001000.inc\"",
          "}",
          "void fn_80002000(void) {",
          "}",
          "void fn_80003000(void) {",
          "  int x = 1;",
          "  (void)x;",
          "}",
          "",
        ].join("\n"),
      );

      const snapshot = loadBoardSnapshot(root, 10);
      expect(snapshot.candidates.map((candidate) => candidate.symbol).sort()).toEqual(["fn_80001000", "fn_80002000"]);
      expect(snapshot.candidates.every((candidate) => candidate.sourcePath === "src/game/foo.c")).toBe(true);
      expect(snapshot.candidates.every((candidate) => candidate.fuzzy === 0)).toBe(true);

      const excluded = loadBoardSnapshot(root, 10, { excludeSourcePaths: ["src/game/foo.c"] });
      expect(excluded.candidates).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
