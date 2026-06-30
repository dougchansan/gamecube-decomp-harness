import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  appendPostmortemContextArgs,
  outputTail,
  prPostmortemMode,
  runFreshStep,
  serverJobPrefix,
  type FreshRunStep,
  type JsonObject,
  type PreparingRuntimeDeps,
  type PreparingRuntimeProjectContext,
} from "../runtime-shared.js";

export type PrepareIntakeItemStatus = "pending" | "running" | "complete" | "failed";
export type PrepareIntakeStepStatus = "pending" | "running" | "complete" | "skipped" | "failed";

export interface PrepareIntakeItemState extends JsonObject {
  pr: number;
  status: PrepareIntakeItemStatus;
  retryable: boolean;
  postmortemStatus: PrepareIntakeStepStatus;
  knowledgeStatus: PrepareIntakeStepStatus;
  postmortemPath?: string;
  knowledgeOutputPath?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface PrepareIntakeCounts extends JsonObject {
  pending: number;
  running: number;
  complete: number;
  failed: number;
  retryable: number;
  total: number;
}

export interface RunPrIndexForPrepareOptions {
  intakePrs?: number[];
  concurrency?: number;
  onItemsChange?: (items: PrepareIntakeItemState[], counts: PrepareIntakeCounts) => Promise<void> | void;
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

function numberFromPrDir(entry: string): number {
  const match = /^pr-(\d+)$/.exec(entry);
  return match ? Number(match[1]) : NaN;
}

function existingPath(paths: string[]): string {
  return paths.find((path) => existsSync(path)) ?? "";
}

function hasCompleteRawSlice(dataRoot: string, number: number): boolean {
  const prRoot = resolve(dataRoot, "prs", `pr-${number}`);
  const rawRoot = resolve(prRoot, "raw");
  const rawFilesPresent = ["pr.json", "issue_comments.json", "review_comments.json", "reviews.json"].every((file) =>
    Boolean(existingPath([resolve(rawRoot, file), resolve(prRoot, file), resolve(dataRoot, "raw", `${number}_${file}`)])),
  );
  const diffPresent = Boolean(existingPath([resolve(rawRoot, "diff.diff"), resolve(prRoot, "diff.diff"), resolve(dataRoot, "diffs", `${number}.diff`)]));
  return rawFilesPresent && diffPresent;
}

function prIsMerged(dataRoot: string, number: number, fallback = false): boolean {
  const prRoot = resolve(dataRoot, "prs", `pr-${number}`);
  const pr = readJsonObject(existingPath([resolve(prRoot, "raw", "pr.json"), resolve(prRoot, "pr.json"), resolve(dataRoot, "raw", `${number}_pr.json`)]));
  if (!Object.keys(pr).length) return fallback;
  const state = String(pr.state ?? "").toUpperCase();
  return Boolean(pr.merged_at ?? pr.mergedAt) || state === "MERGED";
}

function postmortemPath(dataRoot: string, number: number): string {
  const prRoot = resolve(dataRoot, "prs", `pr-${number}`);
  return existingPath([resolve(prRoot, "postmortem", "postmortem.json"), resolve(prRoot, "postmortem.json")]);
}

function canonicalPostmortemPath(dataRoot: string, number: number): string {
  return resolve(dataRoot, "prs", `pr-${number}`, "postmortem", "postmortem.json");
}

function hasValidationIssues(postmortem: JsonObject): boolean {
  return Array.isArray(postmortem.validation_issues) && postmortem.validation_issues.length > 0;
}

export function scanPrIndexDebtForPrepare(
  deps: Pick<PreparingRuntimeDeps, "sourceRoot">,
  paths: PreparingRuntimeProjectContext,
  gitDiscoveredMergedPrs: number[] = [],
): JsonObject {
  const checkedAt = new Date().toISOString();
  const dataRoot = resolve(deps.sourceRoot("past_prs"), "data");
  const prsRoot = resolve(dataRoot, "prs");
  const gitDiscovered = [...new Set(gitDiscoveredMergedPrs.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => b - a);

  try {
    if (!existsSync(prsRoot)) {
      return {
        status: "unavailable",
        checkedAt,
        dataRoot,
        projectId: paths.project?.projectId ?? "",
        reason: "past PR data root is missing",
      };
    }

    const localNumbers = readdirSync(prsRoot)
      .map(numberFromPrDir)
      .filter((value) => Number.isInteger(value) && value > 0);
    const localNumberSet = new Set(localNumbers);
    const numbers = new Set([...localNumbers, ...gitDiscovered]);
    const gitDiscoveredSet = new Set(gitDiscovered);

    let rawSlicePrs = 0;
    let knownMergedPrs = 0;
    let agentIndexedPrs = 0;
    let agentIndexedMergedPrs = 0;
    let pendingAgentPrs = 0;
    let pendingMergedAgentPrs = 0;
    let missingRawPrs = 0;
    let missingPostmortemPrs = 0;
    let stalePostmortemPrs = 0;
    let validationIssuePrs = 0;
    const pendingSamplePrs: number[] = [];
    const pendingMergedSamplePrs: number[] = [];
    const pendingPrs: number[] = [];
    const pendingMergedPrs: number[] = [];
    const missingRawPrList: number[] = [];
    const missingPostmortemPrList: number[] = [];
    const stalePostmortemPrList: number[] = [];
    const validationIssuePrList: number[] = [];

    for (const number of [...numbers].sort((a, b) => b - a)) {
      const merged = prIsMerged(dataRoot, number, gitDiscoveredSet.has(number));
      if (merged) knownMergedPrs += 1;
      if (hasCompleteRawSlice(dataRoot, number)) {
        rawSlicePrs += 1;
      } else {
        missingRawPrs += 1;
        missingRawPrList.push(number);
      }

      const currentPostmortemPath = postmortemPath(dataRoot, number);
      const postmortem = currentPostmortemPath ? readJsonObject(currentPostmortemPath) : {};
      const hasPostmortem = Boolean(currentPostmortemPath && Object.keys(postmortem).length);
      const validationIssues = hasPostmortem && hasValidationIssues(postmortem);
      const agentCompleted = hasPostmortem && postmortem.agent_status === "agent_completed" && !validationIssues;

      if (agentCompleted) {
        agentIndexedPrs += 1;
        if (merged) agentIndexedMergedPrs += 1;
        continue;
      }

      pendingAgentPrs += 1;
      if (merged) pendingMergedAgentPrs += 1;
      pendingPrs.push(number);
      if (merged) pendingMergedPrs.push(number);
      if (!hasPostmortem) {
        missingPostmortemPrs += 1;
        missingPostmortemPrList.push(number);
      } else if (validationIssues) {
        validationIssuePrs += 1;
        validationIssuePrList.push(number);
      } else {
        stalePostmortemPrs += 1;
        stalePostmortemPrList.push(number);
      }
      if (pendingSamplePrs.length < 12) pendingSamplePrs.push(number);
      if (merged && pendingMergedSamplePrs.length < 12) pendingMergedSamplePrs.push(number);
    }

    return {
      status: "available",
      checkedAt,
      dataRoot,
      projectId: paths.project?.projectId ?? "",
      knownPrs: numbers.size,
      localPrs: localNumberSet.size,
      knownMergedPrs,
      rawSlicePrs,
      agentIndexedPrs,
      agentIndexedMergedPrs,
      pendingAgentPrs,
      pendingMergedAgentPrs,
      missingRawPrs,
      missingPostmortemPrs,
      stalePostmortemPrs,
      validationIssuePrs,
      gitDiscoveredPrs: gitDiscovered,
      pendingPrs,
      pendingMergedPrs,
      missingRawPrsList: missingRawPrList,
      missingPostmortemPrsList: missingPostmortemPrList,
      stalePostmortemPrsList: stalePostmortemPrList,
      validationIssuePrsList: validationIssuePrList,
      pendingSamplePrs,
      pendingMergedSamplePrs,
    };
  } catch (error) {
    return {
      status: "error",
      checkedAt,
      dataRoot,
      projectId: paths.project?.projectId ?? "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : [];
}

export function pendingPrsFromDebt(prIndexDebt: JsonObject, fallbackPrs: number[] = []): number[] {
  const pendingPrs = numberArray(prIndexDebt.pendingPrs);
  const fallback = pendingPrs.length > 0 ? pendingPrs : numberArray(prIndexDebt.pendingSamplePrs);
  return [...new Set([...fallback, ...fallbackPrs])].sort((a, b) => b - a);
}

export function prepareIntakeCounts(items: PrepareIntakeItemState[]): PrepareIntakeCounts {
  return {
    pending: items.filter((item) => item.status === "pending").length,
    running: items.filter((item) => item.status === "running").length,
    complete: items.filter((item) => item.status === "complete").length,
    failed: items.filter((item) => item.status === "failed").length,
    retryable: items.filter((item) => item.status === "failed" && item.retryable).length,
    total: items.length,
  };
}

function postmortemResult(dataRoot: string, number: number): { complete: boolean; path: string; error?: string } {
  const path = postmortemPath(dataRoot, number) || canonicalPostmortemPath(dataRoot, number);
  if (!existsSync(path)) return { complete: false, path, error: "postmortem was not written" };
  const postmortem = readJsonObject(path);
  const issues = Array.isArray(postmortem.validation_issues) ? postmortem.validation_issues : [];
  if (postmortem.agent_status !== "agent_completed") {
    return { complete: false, path, error: `postmortem agent_status is ${String(postmortem.agent_status ?? "missing")}` };
  }
  if (issues.length > 0) return { complete: false, path, error: `${issues.length} postmortem validation issue(s)` };
  return { complete: true, path };
}

function stepFromResult(name: string, command: string[], cwd: string, result: { exitCode: number | null; stdout: string; stderr: string }): FreshRunStep {
  return {
    name,
    command,
    cwd,
    exitCode: result.exitCode,
    stdout: outputTail(result.stdout, 4000),
    stderr: outputTail(result.stderr, 4000),
  };
}

async function runPrPostmortemForPrepare(
  deps: PreparingRuntimeDeps,
  paths: PreparingRuntimeProjectContext,
  number: number,
  dryRunAgents: boolean,
  runId: string,
): Promise<FreshRunStep> {
  const postmortemMode = await prPostmortemMode(deps, dryRunAgents);
  const dataRoot = resolve(deps.sourceRoot("past_prs"), "data");
  const command = [
    "python3",
    resolve(deps.sourceRoot("past_prs"), "commands/build_pr_postmortems.py"),
    "--dump-root",
    dataRoot,
    "--pending-only",
    "--complete-only",
    "--jobs",
    "1",
    "--pr",
    String(number),
  ];
  if (postmortemMode === "pi") {
    command.push("--run-agent", "--orchestrator-prepare-intake");
  }
  appendPostmortemContextArgs(command, paths, runId, postmortemMode === "pi" ? deps.kernelDatabaseUrl?.() : null);
  deps.appendLog("ui", `PR #${number} postmortem intake started`);
  const result = await deps.runCli(command, deps.packageRoot);
  deps.appendLog("ui", `PR #${number} postmortem intake exit=${result.exitCode}`);
  return stepFromResult(`pr-${number}-postmortem-agent`, command, deps.packageRoot, result);
}

async function runPrKnowledgeIntakeForPrepare(
  deps: PreparingRuntimeDeps,
  paths: PreparingRuntimeProjectContext,
  number: number,
  postmortemJsonPath: string,
  dryRunAgents: boolean,
  runId: string,
): Promise<FreshRunStep> {
  const command = [
    ...serverJobPrefix(paths, deps.serverJobPath),
    ...(dryRunAgents ? ["--dry-run-agents"] : []),
    "kg-knowledge-intake-agent",
    "--postmortem",
    postmortemJsonPath,
    "--pr",
    String(number),
    "--run-id",
    runId,
    "--item-id",
    `pr-${number}`,
  ];
  if (paths.project) command.push("--kernel-project-id", paths.project.projectId);
  const kernelDatabaseUrl = dryRunAgents ? null : deps.kernelDatabaseUrl?.();
  if (kernelDatabaseUrl) command.push("--orchestrator-kernel-database-url", kernelDatabaseUrl);
  deps.appendLog("ui", `PR #${number} knowledge intake started`);
  const result = await deps.runCli(command, deps.packageRoot);
  deps.appendLog("ui", `PR #${number} knowledge intake exit=${result.exitCode}`);
  return stepFromResult(`pr-${number}-knowledge-intake-agent`, command, deps.packageRoot, result);
}

export async function runMergedPrIntakeForPrepare(
  deps: PreparingRuntimeDeps,
  paths: PreparingRuntimeProjectContext,
  mergedPrs: number[],
  dryRunAgents: boolean,
  runId = "",
): Promise<FreshRunStep[]> {
  const postmortemMode = await prPostmortemMode(deps, dryRunAgents);
  const command = [
    "python3",
    resolve(deps.sourceRoot("past_prs"), "commands/fetch_recent_pr_dump.py"),
    "--repo",
    "dougchansan/pkmn-colosseum",
    "--postmortem-mode",
    postmortemMode,
    "--postmortem-scope",
    "fetched",
    "--postmortem-jobs",
    "16",
    "--fetch-jobs",
    String(Math.min(16, Math.max(1, mergedPrs.length))),
  ];
  appendPostmortemContextArgs(command, paths, runId, postmortemMode === "pi" ? deps.kernelDatabaseUrl?.() : null);
  for (const number of mergedPrs) command.push("--pr", String(number));

  deps.appendLog("ui", `merged PR intake started for ${mergedPrs.length} PR(s)`);
  deps.operationStep("PR intake agents", mergedPrs.map((number) => `#${number}`).join(", "));
  const intakeResult = await deps.runCli(command, deps.packageRoot);
  deps.appendLog("ui", `merged PR intake ${intakeResult.exitCode === 0 ? "complete" : "failed"}`);
  if (intakeResult.exitCode !== 0) {
    throw new Error(`Merged PR intake failed (${intakeResult.exitCode ?? "signal"}): ${outputTail(intakeResult.stderr || intakeResult.stdout, 4000)}`);
  }

  return [
    {
      name: "fetch_merged_prs_and_run_intake_agents",
      command,
      cwd: deps.packageRoot,
      exitCode: intakeResult.exitCode,
      stdout: outputTail(intakeResult.stdout, 4000),
      stderr: outputTail(intakeResult.stderr, 4000),
    },
  ];
}

export async function syncMissingPrRecordsForPrepare(
  deps: PreparingRuntimeDeps,
  steps: FreshRunStep[],
  paths: PreparingRuntimeProjectContext,
  dryRunAgents: boolean,
  runId = "",
): Promise<JsonObject> {
  deps.operationStep("sync missing PRs");
  void dryRunAgents;
  const command = [
    "python3",
    resolve(deps.sourceRoot("past_prs"), "commands/sync_repo_and_pr_library.py"),
    "--skip-git",
    "--postmortem-mode",
    "off",
    "--postmortem-scope",
    "fetched",
    "--postmortem-jobs",
    "16",
  ];
  appendPostmortemContextArgs(command, paths, runId, null);
  await runFreshStep(deps, steps, "sync missing PRs", command, deps.packageRoot);
  const step = steps.at(-1);
  return step ? { ...step } : {};
}

export async function runPrIndexForPrepare(
  deps: PreparingRuntimeDeps,
  paths: PreparingRuntimeProjectContext,
  mergedPrs: number[],
  dryRunAgents: boolean,
  runId = "",
  options: RunPrIndexForPrepareOptions = {},
): Promise<{ metadata: JsonObject; steps: FreshRunStep[]; items: PrepareIntakeItemState[]; counts: PrepareIntakeCounts; failed: boolean }> {
  const steps: FreshRunStep[] = [];
  const dataRoot = resolve(deps.sourceRoot("past_prs"), "data");
  const intakePrs = [...new Set((options.intakePrs ?? mergedPrs).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => b - a);
  const requestedConcurrency = Number.isInteger(options.concurrency) ? Number(options.concurrency) : 8;
  const concurrency = Math.max(1, Math.min(Math.max(1, requestedConcurrency), Math.max(1, intakePrs.length)));
  const items: PrepareIntakeItemState[] = intakePrs.map((number) => ({
    pr: number,
    status: "pending",
    retryable: false,
    postmortemStatus: "pending",
    knowledgeStatus: "pending",
  }));
  let notifyChain: Promise<void> = Promise.resolve();
  const notify = async (): Promise<void> => {
    const snapshot = items.map((item) => ({ ...item }));
    const counts = prepareIntakeCounts(items);
    notifyChain = notifyChain
      .catch(() => undefined)
      .then(async () => {
        await options.onItemsChange?.(snapshot, counts);
      });
    await notifyChain;
  };
  await notify();

  await deps.submitWorkflowEvent(paths, {
    kind: "intake",
    operation: "prepare.intake",
    status: "started",
    sessionId: runId || null,
    detail: `${intakePrs.length} PR intake item(s) selected`,
    metadata: {
      mergedPrs,
      intakePrs,
      concurrency,
    },
  });

  if (intakePrs.length === 0) {
    deps.operationStep("PR intake agents", "skipped - no pending PR intake debt");
    await deps.submitWorkflowEvent(paths, {
      kind: "intake",
      operation: "prepare.intake",
      status: "skipped",
      sessionId: runId || null,
      detail: "no pending PR intake debt",
      metadata: { mergedPrs, intakePrs },
    });
  }

  const processItem = async (item: PrepareIntakeItemState): Promise<void> => {
    const prId = String(item.pr);
    item.status = "running";
    item.retryable = false;
    item.startedAt = item.startedAt ?? new Date().toISOString();
    await notify();
    await deps.submitWorkflowEvent(paths, {
      kind: "intake-item",
      operation: "prepare.intake.item",
      status: "started",
      sessionId: runId || null,
      prId,
      detail: `PR #${item.pr}`,
      metadata: { pr: item.pr },
    });

    try {
      item.postmortemStatus = "running";
      await notify();
      await deps.submitWorkflowEvent(paths, {
        kind: "intake-postmortem",
        operation: "prepare.intake.postmortem",
        status: "started",
        sessionId: runId || null,
        prId,
        detail: `run PR #${item.pr} postmortem agent`,
      });
      const postmortemStep = await runPrPostmortemForPrepare(deps, paths, item.pr, dryRunAgents, runId);
      steps.push(postmortemStep);
      if (postmortemStep.exitCode !== 0) {
        throw new Error(`postmortem command failed (${postmortemStep.exitCode ?? "signal"}): ${outputTail(postmortemStep.stderr || postmortemStep.stdout || "no output")}`);
      }
      const postmortem = postmortemResult(dataRoot, item.pr);
      item.postmortemPath = postmortem.path;
      if (!postmortem.complete) {
        throw new Error(postmortem.error ?? "postmortem did not complete");
      }
      item.postmortemStatus = "complete";
      await notify();
      await deps.submitWorkflowEvent(paths, {
        kind: "intake-postmortem",
        operation: "prepare.intake.postmortem",
        status: "completed",
        sessionId: runId || null,
        prId,
        detail: `PR #${item.pr} postmortem complete`,
        metadata: { postmortemPath: postmortem.path, step: postmortemStep },
      });

      item.knowledgeStatus = "running";
      await notify();
      await deps.submitWorkflowEvent(paths, {
        kind: "intake-knowledge",
        operation: "prepare.intake.knowledge",
        status: "started",
        sessionId: runId || null,
        prId,
        detail: `run PR #${item.pr} knowledge intake agent`,
        metadata: { postmortemPath: postmortem.path },
      });
      const knowledgeStep = await runPrKnowledgeIntakeForPrepare(deps, paths, item.pr, postmortem.path, dryRunAgents, runId);
      steps.push(knowledgeStep);
      if (knowledgeStep.exitCode !== 0) {
        throw new Error(`knowledge intake command failed (${knowledgeStep.exitCode ?? "signal"}): ${outputTail(knowledgeStep.stderr || knowledgeStep.stdout || "no output")}`);
      }
      item.knowledgeStatus = "complete";
      item.knowledgeOutputPath = String(parseKnowledgeIntakeOutputPath(knowledgeStep.stdout) ?? "");
      item.status = "complete";
      item.retryable = false;
      item.completedAt = new Date().toISOString();
      await notify();
      await deps.submitWorkflowEvent(paths, {
        kind: "intake-knowledge",
        operation: "prepare.intake.knowledge",
        status: "completed",
        sessionId: runId || null,
        prId,
        detail: `PR #${item.pr} knowledge intake complete`,
        metadata: { step: knowledgeStep, outputPath: item.knowledgeOutputPath || null },
      });
      await deps.submitWorkflowEvent(paths, {
        kind: "intake-item",
        operation: "prepare.intake.item",
        status: "completed",
        sessionId: runId || null,
        prId,
        detail: `PR #${item.pr} intake complete`,
        metadata: { item: { ...item } },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      item.status = "failed";
      item.retryable = true;
      item.failedAt = new Date().toISOString();
      item.error = message;
      if (item.postmortemStatus === "running") item.postmortemStatus = "failed";
      if (item.knowledgeStatus === "running") item.knowledgeStatus = "failed";
      await notify();
      await deps.submitWorkflowEvent(paths, {
        kind: item.postmortemStatus === "failed" ? "intake-postmortem" : "intake-knowledge",
        operation: item.postmortemStatus === "failed" ? "prepare.intake.postmortem" : "prepare.intake.knowledge",
        status: "failed",
        sessionId: runId || null,
        prId,
        detail: message,
        metadata: { item: { ...item }, error: message },
      }).catch(() => null);
      await deps.submitWorkflowEvent(paths, {
        kind: "intake-item",
        operation: "prepare.intake.item",
        status: "failed",
        sessionId: runId || null,
        prId,
        detail: message,
        metadata: { item: { ...item }, error: message },
      }).catch(() => null);
    }
  };

  deps.operationStep("PR intake agents", `${intakePrs.length} PR(s), up to ${concurrency} at a time`);
  let nextItemIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextItemIndex < items.length) {
      const item = items[nextItemIndex];
      nextItemIndex += 1;
      if (item) await processItem(item);
    }
  };
  if (items.length > 0) {
    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  }

  const missingPrRecords = await syncMissingPrRecordsForPrepare(deps, steps, paths, dryRunAgents, runId);
  const counts = prepareIntakeCounts(items);
  const failed = counts.failed > 0;
  await deps.submitWorkflowEvent(paths, {
    kind: "intake",
    operation: "prepare.intake",
    status: failed ? "failed" : "completed",
    sessionId: runId || null,
    detail: failed
      ? `${counts.failed} PR intake item(s) failed and can be retried`
      : `${counts.complete} PR intake item(s) complete`,
    metadata: {
      mergedPrs,
      intakePrs,
      concurrency,
      counts,
      items,
      missingPrRecords,
    },
  }).catch(() => null);
  return {
    steps,
    items,
    counts,
    failed,
    metadata: {
      mergedPrs,
      intakePrs,
      concurrency,
      intakeItemCounts: counts,
      items,
      missingPrRecords,
    },
  };
}

function parseKnowledgeIntakeOutputPath(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as JsonObject;
    return typeof parsed.outputPath === "string" ? parsed.outputPath : null;
  } catch {
    return null;
  }
}
