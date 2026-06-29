import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { forceReportRun } from "./run.js";

let tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "report-run-"));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs = [];
});

describe("forceReportRun", () => {
  test("configures an unconfigured checkout before invoking ninja", async () => {
    const root = tempDir();
    const repoRoot = resolve(root, "repo");
    const binDir = resolve(root, "bin");
    const logPath = resolve(root, "commands.log");
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(resolve(repoRoot, "configure.py"), "# fixture\n");
    writeExecutable(
      resolve(binDir, "python3"),
      `#!/bin/sh
echo "python3 $*" >> "$REPORT_RUN_TEST_LOG"
touch build.ninja
`,
    );
    writeExecutable(
      resolve(binDir, "ninja"),
      `#!/bin/sh
echo "ninja $*" >> "$REPORT_RUN_TEST_LOG"
mkdir -p build/GALE01
if [ "$1" = "build/GALE01/report.json" ]; then
  printf '%s\\n' '{"measures":{"fuzzy_match_percent":98.5,"matched_code_percent":76.25,"matched_data_percent":81.5,"matched_functions_percent":95,"total_functions":200,"matched_functions":190,"total_units":20,"complete_units":17,"total_code":"1000","matched_code":"762","total_data":"400","matched_data":"326"}}' > build/GALE01/report.json
  exit 0
fi
if [ "$1" = "changes_all" ]; then
  printf '{"ok":true}\\n' > build/GALE01/report_changes.json
  exit 0
fi
exit 1
`,
    );

    const originalPath = Bun.env.PATH;
    const originalLog = Bun.env.REPORT_RUN_TEST_LOG;
    Bun.env.PATH = `${binDir}:${originalPath ?? ""}`;
    Bun.env.REPORT_RUN_TEST_LOG = logPath;
    try {
      const result = await forceReportRun(repoRoot, { resetBaseline: true });

      expect(result.steps.map((step) => step.name)).toEqual(["configure", "generate report", "generate report changes"]);
      expect(existsSync(resolve(repoRoot, "build.ninja"))).toBe(true);
      expect(existsSync(result.baselinePath)).toBe(true);
      expect(result.summary).toMatchObject({
        fuzzyMatchPercent: 98.5,
        matchedCodePercent: 76.25,
        matchedDataPercent: 81.5,
        matchedFunctionsPercent: 95,
        unmatchedTargets: 10,
        incompleteUnits: 3,
      });
      expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
        "python3 configure.py",
        "ninja build/GALE01/report.json",
        "ninja changes_all",
      ]);
    } finally {
      if (originalPath === undefined) delete Bun.env.PATH;
      else Bun.env.PATH = originalPath;
      if (originalLog === undefined) delete Bun.env.REPORT_RUN_TEST_LOG;
      else Bun.env.REPORT_RUN_TEST_LOG = originalLog;
    }
  });
});
