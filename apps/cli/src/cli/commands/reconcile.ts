import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reconcilePrompt, type ReconcileMode } from "@decomp-orchestrator/agents/reconcile";
import { artifactTimestamp, parseJsonObject, runPiAgent } from "@decomp-orchestrator/agents/runtime";
import { addPiSession, openState } from "@decomp-orchestrator/core/state";
import { booleanArg, numberArg, stringArg, type GlobalArgs } from "../args.js";

const RECONCILE_MODES: ReconcileMode[] = ["ship-validate", "sync-merge"];
const GIT_OUTPUT_CHAR_LIMIT = 12_000;

function parseMode(value: string): ReconcileMode {
  if ((RECONCILE_MODES as string[]).includes(value)) return value as ReconcileMode;
  throw new Error(`--mode must be one of: ${RECONCILE_MODES.join(", ")}`);
}

async function gitOutput(repoRoot: string, gitArgs: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repoRoot, ...gitArgs], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) return `(git ${gitArgs.join(" ")} failed: ${stderr.trim() || exitCode})`;
  const text = stdout.trimEnd();
  return text.length > GIT_OUTPUT_CHAR_LIMIT ? `${text.slice(0, GIT_OUTPUT_CHAR_LIMIT)}\n[truncated]` : text;
}

function latestRegressionSummary(stateDir: string, runId: string): Record<string, unknown> | null {
  const checksRoot = resolve(stateDir, "regression_checks");
  if (!existsSync(checksRoot)) return null;
  const runDirs = runId ? [runId] : readdirSync(checksRoot).sort().reverse();
  for (const runDir of runDirs) {
    const runRoot = resolve(checksRoot, runDir);
    if (!existsSync(runRoot)) continue;
    const timestamps = readdirSync(runRoot).sort().reverse();
    for (const timestamp of timestamps) {
      const summaryPath = resolve(runRoot, timestamp, "summary.json");
      if (!existsSync(summaryPath)) continue;
      try {
        return { summary_path: summaryPath, ...JSON.parse(readFileSync(summaryPath, "utf8")) };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function inlineContextFile(path: string | null): unknown {
  if (!path) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

async function reconcileContext(globals: GlobalArgs, args: Map<string, string | true>, mode: ReconcileMode): Promise<Record<string, unknown>> {
  const baseRef = stringArg(args, "--base-ref", globals.project?.baseRef ?? "origin/master");
  const runId = stringArg(args, "--run-id", "");
  const attemptBudget = Math.max(1, Math.floor(numberArg(args, "--attempt-budget", 3)));
  const [headSha, baseSha, gitStatus, conflicts] = await Promise.all([
    gitOutput(globals.repoRoot, ["rev-parse", "HEAD"]),
    gitOutput(globals.repoRoot, ["rev-parse", baseRef]),
    gitOutput(globals.repoRoot, ["status", "--short", "--ignore-submodules=all"]),
    gitOutput(globals.repoRoot, ["diff", "--name-only", "--diff-filter=U"]),
  ]);
  return {
    mode,
    run_id: runId || null,
    repo_root: globals.repoRoot,
    base_ref: baseRef,
    head_sha: headSha,
    base_sha: baseSha,
    attempt_budget: attemptBudget,
    git_status_short: gitStatus,
    merge_conflicts: conflicts ? conflicts.split("\n").filter(Boolean) : [],
    regression_check: mode === "ship-validate" ? latestRegressionSummary(globals.stateDir, runId) : null,
    validation: {
      configure_command: "python configure.py --require-protos",
      build_command: "ninja",
      regression_command: `regression-check --target ${globals.project?.validation.qaTarget ?? "changes_all"}`,
    },
    operator_context: inlineContextFile(stringArg(args, "--context-file", "") || null),
  };
}

function recordReconcileSession(globals: GlobalArgs, args: Map<string, string | true>, result: Awaited<ReturnType<typeof runPiAgent>>): void {
  const runId = stringArg(args, "--run-id", "");
  if (!runId) return;
  const store = openState(globals.stateDir);
  try {
    addPiSession({
      store,
      runId,
      role: "reconcile",
      sessionId: result.sessionId,
      sessionFile: result.sessionFile,
      provider: globals.provider,
      model: globals.model,
      thinkingLevel: globals.thinkingLevel,
      status: result.failed ? "failed" : result.dryRun ? "dry_run" : "succeeded",
      outputPath: result.outputPath,
    });
  } finally {
    store.db.close();
  }
}

export async function reconcile(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const mode = parseMode(stringArg(args, "--mode", "ship-validate"));
  const context = await reconcileContext(globals, args, mode);
  if (mode === "ship-validate" && !context.regression_check && !booleanArg(args, "--allow-missing-regression-check")) {
    throw new Error("No regression-check summary found under state_dir/regression_checks. Run regression-check first, or pass --allow-missing-regression-check.");
  }
  const outputDir = resolve(globals.stateDir, "reconcile", artifactTimestamp());
  await mkdir(outputDir, { recursive: true });

  const result = await runPiAgent({
    role: "reconcile",
    cwd: globals.repoRoot,
    prompt: reconcilePrompt({
      mode,
      reconcileContext: context,
      repoRoot: globals.repoRoot,
      stateDir: globals.stateDir,
      project: globals.project,
    }),
    outputDir,
    dryRun: globals.dryRunAgents,
    provider: globals.provider,
    model: globals.model,
    thinkingLevel: globals.thinkingLevel,
    timeoutMs: globals.agentTimeoutSeconds ? globals.agentTimeoutSeconds * 1000 : undefined,
    toolContext: {
      repoRoot: globals.repoRoot,
      stateDir: globals.stateDir,
      project: globals.project,
    },
  });
  recordReconcileSession(globals, args, result);
  const parsed = result.dryRun || result.failed ? { object: null, error: result.error ?? (result.dryRun ? "dry-run" : "agent failed") } : parseJsonObject(result.rawText);

  const summary = {
    mode,
    dry_run: result.dryRun ?? false,
    failed: result.failed ?? false,
    output_dir: outputDir,
    output_path: result.outputPath,
    system_prompt_path: result.systemPromptPath,
    user_prompt_path: result.userPromptPath,
    parse_error: parsed.error ?? null,
    report: parsed.object,
    context: {
      base_ref: context.base_ref,
      head_sha: context.head_sha,
      attempt_budget: context.attempt_budget,
      merge_conflicts: context.merge_conflicts,
      regression_summary_path: (context.regression_check as Record<string, unknown> | null)?.summary_path ?? null,
    },
  };
  await writeFile(resolve(outputDir, "reconcile_summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}
