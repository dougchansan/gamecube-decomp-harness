import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { packageRoot } from "@server/core/knowledge";

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("init-run target manifest CLI", () => {
  test("snapshots only manifest targets before applying the candidate window", () => {
    const root = mkdtempSync(join(tmpdir(), "init-run-targets-"));
    try {
      const repo = resolve(root, "repo");
      const state = resolve(root, "state");
      const manifest = resolve(root, "targets.tsv");
      writeJson(resolve(repo, "build/GC6E01/report.json"), {
        measures: {},
        units: [
          {
            name: "unit/a",
            metadata: { source_path: "src/a.c" },
            functions: [
              { name: "high_priority", size: 2048, fuzzy_match_percent: 99.99 },
              { name: "allowed", size: 64 },
              { name: "allowed_two", size: 32 },
            ],
          },
        ],
      });
      writeJson(resolve(repo, "objdiff.json"), { units: [{ name: "unit/a", metadata: { source_path: "src/a.c" } }] });
      writeFileSync(manifest, "target_key\tsymbol\nunit/a::allowed\tallowed\nunit/a::allowed_two\tallowed_two\n");

      const proc = Bun.spawnSync(
        [
          "bun",
          "apps/server/src/job-runner.ts",
          "--repo-root",
          repo,
          "--state-dir",
          state,
          "init-run",
          "--desired-workers",
          "1",
          "--candidate-limit",
          "1",
          "--candidate-window",
          "1",
          "--fuzzy-max",
          "87.999",
          "--graph-db",
          resolve(root, "missing-graph.sqlite"),
          "--target-keys-file",
          manifest,
        ],
        { cwd: packageRoot(), stdout: "pipe", stderr: "pipe" },
      );
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);
      const result = JSON.parse(proc.stdout.toString()) as {
        candidateWindow: number;
        run: { id: string };
        requestedTargetCount: number;
        targetCount: number;
        targetKeysFile: string;
      };
      expect(result).toMatchObject({ candidateWindow: 2, requestedTargetCount: 2, targetCount: 2, targetKeysFile: manifest });

      const snapshot = JSON.parse(readFileSync(resolve(state, "runs", result.run.id, "snapshots/initial_board.json"), "utf8")) as {
        candidates: Array<{ unit: string; symbol: string }>;
      };
      expect(snapshot.candidates.map((candidate) => `${candidate.unit}::${candidate.symbol}`).sort()).toEqual(["unit/a::allowed", "unit/a::allowed_two"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
