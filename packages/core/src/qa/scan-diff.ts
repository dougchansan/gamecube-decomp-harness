/**
 * Shared invoker for the review_lint diff-aware QA scanner.
 *
 * The scanner is the deterministic layer of the QA ship gate: it runs the
 * maintainer-rejection rules (extern-literal anchors, packed string blobs,
 * unrolled asserts, banned patterns, resubmission tombstones) against the
 * added lines of a diff. Both the worker-side L1 check and the
 * regression-check L2 ship gate go through this helper so they share one
 * contract.
 *
 * Exit-code contract for `scan_diff.py --gate`:
 *   0 = clean, 1 = hard-fail findings present, 2 = warnings only.
 * Stdout is always the JSON document; the human summary goes to stderr.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "../shell/run-command.js";

export type QaScanSeverity = "error" | "warning";

export interface QaScanFinding {
  rule_id: string;
  severity: QaScanSeverity;
  file: string;
  line: number;
  excerpt: string;
  message: string;
  standard_id: string | null;
  /** Extra rule-specific context (ownership verdicts, tombstone refs, ...). */
  detail?: Record<string, unknown>;
}

export interface QaScanResult {
  tool: "review_lint";
  operation: "review_lint:scan_diff";
  status: "passed" | "warned" | "failed";
  repo: string;
  base: string | null;
  findings: QaScanFinding[];
  counts: { errors: number; warnings: number };
}

export interface QaScanInvocation {
  /** Exit code from scan_diff.py (0 clean / 1 hard fail / 2 warnings; other = tool failure). */
  exitCode: number;
  /** Parsed stdout JSON, or null when stdout was not parseable. */
  result: QaScanResult | null;
  /** Raw stdout/stderr for artifact capture. */
  stdout: string;
  stderr: string;
  /** Set when the tool itself failed (script missing, crash, bad JSON). */
  toolError: string | null;
  command: string[];
}

export interface RunQaScanDiffOptions {
  /** Melee (target project) repo root the diff lives in. */
  repoRoot: string;
  /** Orchestrator root containing tools/source_editing/review_lint. */
  orchestratorRoot: string;
  /** Base ref to diff against (merge-base is computed by the tool). Mutually exclusive with diffFile/files. */
  baseRef?: string;
  /** Pre-computed unified diff file to scan instead of a ref diff. */
  diffFile?: string;
  /** Restrict the ref diff to these pathspecs (worker L1 scoping). */
  files?: string[];
}

export function qaScanDiffScriptPath(orchestratorRoot: string): string {
  return resolve(orchestratorRoot, "tools/source_editing/review_lint/api/scan_diff.py");
}

export function qaGatePassed(invocation: QaScanInvocation): boolean {
  return invocation.toolError === null && (invocation.exitCode === 0 || invocation.exitCode === 2);
}

export function parseQaScanResult(stdout: string): QaScanResult | null {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (parsed && parsed.tool === "review_lint" && Array.isArray(parsed.findings)) {
      return parsed as unknown as QaScanResult;
    }
    return null;
  } catch {
    return null;
  }
}

export async function runQaScanDiff(options: RunQaScanDiffOptions): Promise<QaScanInvocation> {
  const scriptPath = qaScanDiffScriptPath(options.orchestratorRoot);
  const command = ["python3", scriptPath, "--repo", options.repoRoot, "--gate", "--json"];
  if (options.baseRef) command.push("--base", options.baseRef);
  if (options.diffFile) command.push("--diff-file", options.diffFile);
  for (const file of options.files ?? []) command.push("--path", file);
  if (!existsSync(scriptPath)) {
    return {
      exitCode: -1,
      result: null,
      stdout: "",
      stderr: "",
      toolError: `scan_diff.py not found at ${scriptPath}`,
      command,
    };
  }
  const result = await runCommand(options.repoRoot, command);
  const parsed = parseQaScanResult(result.stdout);
  const toolError =
    parsed === null
      ? `scan_diff.py did not return parseable JSON (exit ${result.exitCode})`
      : ![0, 1, 2].includes(result.exitCode)
        ? `scan_diff.py failed with exit ${result.exitCode}`
        : null;
  return {
    exitCode: result.exitCode,
    result: parsed,
    stdout: result.stdout,
    stderr: result.stderr,
    toolError,
    command,
  };
}
