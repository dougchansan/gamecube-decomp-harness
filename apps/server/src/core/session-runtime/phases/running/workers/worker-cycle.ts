import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { createMeleeKernelSpawnContext } from "@server/infrastructure/kernel/bridge/spawn-context";
import {
  appendWorkerActivityEvent,
  captureWorkerChangeBaseline,
  lintWorkerReviewDiff,
  parseWorkerCheckpointNote,
  targetPacketTarget,
  validateWorkerChange,
  workerPrompt,
  workerPacket,
  type WorkerChangeBaseline,
  type WorkerReviewLint,
  type WorkerRunnerValidation,
} from "@server/core/agent-catalog/agents/running/worker";
import { qaLintRepairReasons, type WorkerChangeValidation } from "@server/core/agent-catalog/agents/running/worker/change-validation";
import { runMeleeKernelPiAgent as runPiAgent } from "@server/infrastructure/agent-runtime/kernel-pi-runner";
import { defaultWorkerToolProfile } from "@server/core/tools";
import {
  fileGraphCard,
  graphDbExists,
  loadKnowledgeBoardSnapshot,
  openKnowledgeGraph,
  resolvePathFactsContext,
  resourceGraphDbPath,
} from "@server/core/knowledge";
import { runCommand } from "@server/infrastructure/shell";
import { addPiSession } from "@server/core/session-runtime/run-state";
import {
  activeSchedulerEpoch,
  addEvent,
  appendWorkerSessionId,
  bestCheckpointForWorkerState,
  claimNextEpochTarget,
  closeWorkerState,
  DEFAULT_WORKER_TTL_SECONDS,
  enqueueWorkerOutputIntegration,
  getLatestRun,
  getRun,
  openState,
  recordWorkerCheckpoint,
  setClaimWorktreePath,
  type StateStore,
} from "@server/core/session-runtime/run-state";
import {
  processWorkerOutputIntegrationQueue,
  type WorkerOutputIntegrationApplyResult,
} from "@server/core/session-runtime/phases/running/integration/worker-output-queue.js";
import type { PiRunResult } from "@server/core/shared/types";
import { numberArg, projectMetadata, stringArg, type GlobalArgs } from "@server/core/project-registry/runtime-options.js";
import { assertSchedulableRun } from "@server/core/session-runtime/phases/running/jobs/shared.js";

export interface WorkerCycleResult {
  runId: string;
  claimId: string;
  workerStateId: string;
  epochTargetId: string;
  target: string;
  writeSet: string[];
  workerOutput?: string;
  workerSystemPrompt?: string;
  workerUserPrompt?: string;
  workerStatePath: string;
  lifecycleStatus: string;
  bestCheckpointId: string | null;
  bestScore: number | null;
  exact: boolean;
  wakeEvent: string;
  dryRun: boolean;
  failed?: boolean;
  providerFailure?: boolean;
  errorKind?: string;
  error?: string;
  workerOutputIntegration?: {
    itemId: string;
    processed: WorkerOutputIntegrationApplyResult[];
  };
}

interface WorkerAttemptEvaluation {
  result: PiRunResult;
  agentNote: Record<string, unknown> | null;
  parsedError?: string;
  runnerValidation: WorkerChangeValidation;
  repairReasons: string[];
  writeSetDiffChanged: boolean;
  postAttemptDiffPath: string;
  repairFeedbackPath?: string;
}

interface WorkerErrorClassification {
  kind: string;
  summary: string;
  reasons: string[];
}

type PostReturnCheckValidation = WorkerRunnerValidation & { status: "passed" | "failed" | "skipped" };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function recordString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringValuesFromObject(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(stringValuesFromObject);
  const record = value as Record<string, unknown>;
  const values: string[] = [];
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") values.push(`${key}: ${item}`);
    else if (item && typeof item === "object") values.push(...stringValuesFromObject(item));
  }
  return values;
}

function textLooksLikeToolError(value: unknown): boolean {
  const text = typeof value === "string" ? value : stringValuesFromObject(value).join("\n");
  if (!text.trim()) return false;
  const toolTerm = /\b(tool|command|api|build tool|compiler runner|validation harness|post-return|checkdiff|objdiff|wibo|weebo|wine|mwcc|stderr|parse error|timeout|timed out|missing executable|harness)\b/i;
  const failureTerm = /\b(fail(?:ed|ing|ure)?|missing|blocked|unavailable|error|exited|cannot|can't|unable|not found)\b/i;
  return toolTerm.test(text) && failureTerm.test(text);
}

function blockerIsExplicitlyNonBlocking(record: Record<string, unknown>): boolean {
  const kind = recordString(record.kind || record.type || record.status || record.reason);
  const text = [kind, ...stringValuesFromObject(record)].join("\n");
  return /(?:non[_ -]?blocking|optional|did not block|does not block|not block normal|regular .* sufficient|usable .* evidence|rerunning .* succeeded)/i.test(text);
}

// fatal: the agent explicitly declared a tool failure (note status or a structured
// blocker kind) — trustworthy enough to drain the pool via --exit-on-worker-error.
// advisory: a regex hunch over free text. Worth classifying as tool_error for triage,
// but a hunch must never have pool-drain authority.
export function agentNoteSignalsToolError(agentNote: Record<string, unknown> | null): { fatal: string[]; advisory: string[] } {
  if (!agentNote) return { fatal: [], advisory: [] };
  const fatal: string[] = [];
  const advisory: string[] = [];
  const noteStatus = recordString(agentNote.status);
  if (noteStatus === "tool_error") fatal.push("agent note status is tool_error");
  const blockers = Array.isArray(agentNote.blockers) ? agentNote.blockers : [];
  for (const blocker of blockers) {
    const record = blocker && typeof blocker === "object" && !Array.isArray(blocker) ? (blocker as Record<string, unknown>) : {};
    if (blockerIsExplicitlyNonBlocking(record)) continue;
    const kind = recordString(record.kind || record.type || record.status || record.reason);
    if (/(?:tool|command|api|build|validation|compiler|runner|parse|timeout).*error|error.*(?:tool|command|api|build|validation|compiler|runner|parse|timeout)/i.test(kind)) {
      fatal.push(`agent blocker marks tool error: ${kind}`);
      continue;
    }
    if (textLooksLikeToolError(record)) advisory.push(`agent blocker looks like a tool error: ${stringValuesFromObject(record).join("; ").slice(0, 240)}`);
  }
  if (noteStatus === "validation_ready" && textLooksLikeToolError(agentNote.summary)) {
    advisory.push("agent validation note text looks like a tool/build/validation failure");
  }
  return { fatal, advisory };
}

function runnerValidationFailureReasons(validation: WorkerRunnerValidation): string[] {
  if (validation.status === "passed" || validation.status === "skipped") {
    if (validation.postReturnCheck?.status !== "failed") return [];
    return validation.postReturnCheck.reasons.length > 0
      ? validation.postReturnCheck.reasons.map((reason) => `post-return check: ${reason}`)
      : ["post-return check failed"];
  }
  const reasons = validation.reasons.length > 0 ? [...validation.reasons] : [`runner validation status: ${validation.status}`];
  if (validation.postReturnCheck?.status === "failed") {
    reasons.push(...validation.postReturnCheck.reasons.map((reason) => `post-return check: ${reason}`));
  }
  return reasons;
}

export function classifyWorkerError(params: {
  result: PiRunResult;
  parsedError?: string;
  agentNote: Record<string, unknown> | null;
  runnerValidation: WorkerChangeValidation;
}): WorkerErrorClassification | null {
  if (params.result.failed) {
    const message = params.result.error ?? "unknown Pi session error";
    return {
      kind: "worker_session_failed",
      summary: `Worker Pi session failed before producing a validation note: ${message}`,
      reasons: [message],
    };
  }
  if (params.parsedError && params.result.providerError) {
    return {
      kind: "provider_error",
      summary: `LLM provider failed before the worker produced a validation note: ${params.result.providerError}`,
      reasons: [params.result.providerError, params.parsedError],
    };
  }
  const agentToolErrors = agentNoteSignalsToolError(params.agentNote);
  if (agentToolErrors.fatal.length > 0) {
    return {
      kind: "agent_noted_tool_error",
      summary: `Worker note describes a tool/build/validation failure: ${agentToolErrors.fatal.join("; ")}`,
      reasons: agentToolErrors.fatal,
    };
  }
  if (agentToolErrors.advisory.length > 0) {
    return {
      kind: "agent_noted_tool_error_advisory",
      summary: `Worker note text resembles a tool/build/validation failure (heuristic): ${agentToolErrors.advisory.join("; ")}`,
      reasons: agentToolErrors.advisory,
    };
  }
  const validationReasons = runnerValidationFailureReasons(params.runnerValidation);
  // L1 QA lint rejection: the attempt re-added or left a QA finding.
  // The runner_validation_ prefix keeps this a rework kind for repair/continue
  // feedback and never turns the worker lifecycle into an infrastructure error.
  if (params.runnerValidation.qaLint?.status === "violations" || params.runnerValidation.qaLint?.status === "warnings") {
    const qaReasons = qaLintRepairReasons(params.runnerValidation.qaLint);
    return {
      kind: "runner_validation_qa_lint_failed",
      summary: `QA lint rejected the attempt: ${params.runnerValidation.qaLint.findings.length} QA finding(s) requiring repair`,
      reasons: [...validationReasons, ...qaReasons.filter((reason) => !validationReasons.includes(reason))],
    };
  }
  if (validationReasons.length > 0) {
    return {
      kind: `runner_validation_${params.runnerValidation.status}`,
      summary: `Runner validation failed: ${validationReasons.join("; ")}`,
      reasons: validationReasons,
    };
  }
  return null;
}

export function isReworkErrorKind(kind: string): boolean {
  return /^(?:runner_validation_|worker_integration_)/.test(kind);
}

// All repair feedback for one attempt: the shared return-gate reasons plus the
// L1 QA lint findings, formatted verbatim for the worker's next iteration.
export function workerAttemptRepairReasons(params: {
  writeSetDiffChanged: boolean;
  runnerValidation: WorkerChangeValidation;
  reviewLint?: WorkerReviewLint;
}): string[] {
  const reasons: string[] = [];
  if (params.runnerValidation.status !== "passed" && params.runnerValidation.status !== "skipped") {
    reasons.push(...params.runnerValidation.reasons.map((reason) => `runner validation: ${reason}`));
  }
  if (params.reviewLint?.status === "failed") {
    reasons.push(...params.reviewLint.reasons.map((reason) => `review lint: ${reason}`));
  }
  if (params.writeSetDiffChanged && params.runnerValidation.status === "skipped") {
    reasons.push("write_set diff changed but runner validation was skipped");
  }
  reasons.push(...qaLintRepairReasons(params.runnerValidation.qaLint));
  return reasons;
}

function renderPostReturnCheckCommand(
  template: string,
	  params: {
	    repoRoot: string;
	    stateDir: string;
	    workerLogDir: string;
	    claimId: string;
	    writeSet: string[];
	    target: Record<string, unknown>;
	  },
): string {
  const replacements: Record<string, string> = {
	    repo_root: shellQuote(params.repoRoot),
	    state_dir: shellQuote(params.stateDir),
	    worker_log_dir: shellQuote(params.workerLogDir),
	    claim_id: shellQuote(params.claimId),
    source_path: shellQuote(String(params.target.source_path ?? "")),
    unit: shellQuote(String(params.target.unit ?? "")),
    symbol: shellQuote(String(params.target.symbol ?? "")),
    write_set: params.writeSet.map(shellQuote).join(" "),
  };
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => replacements[key] ?? match);
}

async function captureWriteSetDiff(repoRoot: string, writeSet: string[], outputPath: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = writeSet.length > 0 ? await runCommand(repoRoot, ["git", "diff", "--", ...writeSet]) : { exitCode: 0, stdout: "", stderr: "" };
  await writeFile(outputPath, result.stdout);
  if (result.stderr) await writeFile(`${outputPath}.stderr.txt`, result.stderr);
  return result;
}

async function runPostReturnCheck(params: {
  commandTemplate: string;
  dryRun: boolean;
	  repoRoot: string;
	  stateDir: string;
	  workerLogDir: string;
	  claimId: string;
  writeSet: string[];
  target: Record<string, unknown>;
  outputDir: string;
  attemptIndex: number;
  shouldRun: boolean;
}): Promise<PostReturnCheckValidation> {
  if (!params.commandTemplate) {
    return { status: "skipped", reasons: ["no --post-return-check-command configured"] };
  }
  if (params.dryRun) {
    return { status: "skipped", reasons: ["dry-run agents do not execute post-return check commands"] };
  }
  if (!params.shouldRun) {
    return { status: "skipped", reasons: ["runner validation did not pass"] };
  }

  const command = renderPostReturnCheckCommand(params.commandTemplate, params);
  const validationDir = resolve(params.outputDir, "runner_validation");
  await mkdir(validationDir, { recursive: true });
  const stdoutPath = resolve(validationDir, `attempt-${params.attemptIndex}.post_return.stdout.txt`);
  const stderrPath = resolve(validationDir, `attempt-${params.attemptIndex}.post_return.stderr.txt`);
  const summaryPath = resolve(validationDir, `attempt-${params.attemptIndex}.post_return.summary.json`);
  const result = await runCommand(params.repoRoot, ["/bin/sh", "-lc", command]);
  await writeFile(stdoutPath, result.stdout);
  await writeFile(stderrPath, result.stderr);
  const validation: WorkerRunnerValidation = {
    status: result.exitCode === 0 ? "passed" : "failed",
    reasons: result.exitCode === 0 ? [] : [`post-return check command exited ${result.exitCode}`],
    command,
    exitCode: result.exitCode,
    summaryPath,
    stdoutPath,
    stderrPath,
  };
  await writeFile(summaryPath, JSON.stringify(validation, null, 2));
  return validation as PostReturnCheckValidation;
}

function compactPostReturnCheck(validation: PostReturnCheckValidation): NonNullable<WorkerRunnerValidation["postReturnCheck"]> {
  return {
    status: validation.status,
    reasons: validation.reasons,
    command: validation.command,
    exitCode: validation.exitCode,
    summaryPath: validation.summaryPath,
    stdoutPath: validation.stdoutPath,
    stderrPath: validation.stderrPath,
  };
}

function outputTail(text: string, maxChars = 2000): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const result = await runCommand(cwd, ["git", ...args]);
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

async function resolveBaseRev(repoRoot: string, requested: string): Promise<string> {
  if (requested && requested !== "unknown") return requested;
  const head = await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) throw new Error(`Unable to resolve worker base revision from ${repoRoot}: ${outputTail(head.stderr || head.stdout)}`);
  return head.stdout.trim();
}

function sessionRootFromRepoRoot(globals: GlobalArgs): string | null {
  const projectDir = globals.project?.projectDir ?? dirname(globals.repoRoot);
  const sessionsRoot = resolve(projectDir, "worktrees", "sessions");
  const sessionRelativePath = relative(sessionsRoot, globals.repoRoot);
  if (!sessionRelativePath || sessionRelativePath.startsWith("..") || isAbsolute(sessionRelativePath)) return null;
  const [sessionUuid, worktreeName] = sessionRelativePath.split(/[\\/]/);
  if (!sessionUuid || (worktreeName !== "current" && worktreeName !== "source")) return null;
  return resolve(sessionsRoot, sessionUuid);
}

function workerEpochDirectory(epoch: { ordinal?: number } | null): string {
  const ordinal = Number(epoch?.ordinal);
  return Number.isInteger(ordinal) && ordinal > 0 ? String(ordinal).padStart(4, "0") : "legacy";
}

export function workerWorktreePath(globals: GlobalArgs, claimId: string, epoch: { ordinal?: number } | null = null): string {
  if (globals.dryRunAgents) return resolve(globals.stateDir, "dry_run_worktrees", claimId, "source");
  const projectDir = globals.project?.projectDir ?? dirname(globals.repoRoot);
  const sessionRoot = sessionRootFromRepoRoot(globals);
  if (sessionRoot) {
    return resolve(sessionRoot, "epochs", workerEpochDirectory(epoch), "workers", claimId, "source");
  }
  return resolve(projectDir, "worktrees", claimId, "source");
}

function linkMissingTree(sourceDir: string, targetDir: string): number {
  let linked = 0;
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = resolve(sourceDir, entry);
    const targetPath = resolve(targetDir, entry);
    if (statSync(sourcePath).isDirectory()) {
      linked += linkMissingTree(sourcePath, targetPath);
    } else if (existsSync(targetPath)) {
      continue;
    } else {
      symlinkSync(sourcePath, targetPath);
      linked += 1;
    }
  }
  return linked;
}

interface WorkerReportArtifactSource {
  relativePath: string;
  sourcePath: string;
}

const WORKER_REPORT_ARTIFACT_RELATIVE_PATHS = [
  "build/GALE01/report.json",
  "build/GALE01/report_changes.json",
  "build/GALE01/baseline.json",
];

function latestArtifactSourcePath(store: StateStore, runId: string, artifactType: string, artifactKey: string): string | null {
  const row = store.db
    .query(
      `
        SELECT source_path
        FROM dashboard_artifacts
        WHERE run_id = ? AND artifact_type = ? AND artifact_key = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(runId, artifactType, artifactKey) as { source_path?: unknown } | undefined;
  return typeof row?.source_path === "string" && row.source_path ? row.source_path : null;
}

function reportArtifactSourcesForWorker(params: { store: StateStore; runId: string; globals: GlobalArgs }): WorkerReportArtifactSource[] {
  const projectDir = params.globals.project?.projectDir ?? dirname(params.globals.repoRoot);
  const fallbackRoots = [
    params.globals.repoRoot,
    resolve(projectDir, "worktrees", "upstream-current"),
  ];
  const dashboardSources: Record<string, Array<string | null>> = {
    "build/GALE01/report.json": [
      latestArtifactSourcePath(params.store, params.runId, "board_snapshot", "current"),
      latestArtifactSourcePath(params.store, params.runId, "board_snapshot", "initial"),
    ],
    "build/GALE01/report_changes.json": [
      latestArtifactSourcePath(params.store, params.runId, "trusted_report", "current"),
      latestArtifactSourcePath(params.store, params.runId, "trusted_report", "baseline"),
    ],
    "build/GALE01/baseline.json": [],
  };
  const sources: WorkerReportArtifactSource[] = [];
  for (const relativePath of WORKER_REPORT_ARTIFACT_RELATIVE_PATHS) {
    const candidates = [
      ...(dashboardSources[relativePath] ?? []),
      ...fallbackRoots.map((root) => resolve(root, relativePath)),
    ];
    const sourcePath = candidates.find((candidate) => typeof candidate === "string" && candidate && existsSync(candidate));
    if (sourcePath) sources.push({ relativePath, sourcePath });
  }
  return sources;
}

async function seedWorkerReportArtifacts(params: {
  workerRepoRoot: string;
  outputDir: string;
  sources: WorkerReportArtifactSource[];
}): Promise<void> {
  const seeded: Array<Record<string, string>> = [];
  const existing: string[] = [];
  const sourceByRelativePath = new Map(params.sources.map((source) => [source.relativePath, source.sourcePath]));
  for (const relativePath of WORKER_REPORT_ARTIFACT_RELATIVE_PATHS) {
    const targetPath = resolve(params.workerRepoRoot, relativePath);
    if (existsSync(targetPath)) {
      existing.push(relativePath);
      continue;
    }
    const sourcePath = sourceByRelativePath.get(relativePath);
    if (!sourcePath || !existsSync(sourcePath)) continue;
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    seeded.push({ relativePath, sourcePath, targetPath });
  }
  await writeFile(
    resolve(params.outputDir, "worker_worktree_report_artifacts.json"),
    JSON.stringify(
      {
        seeded,
        existing,
        missing: WORKER_REPORT_ARTIFACT_RELATIVE_PATHS.filter(
          (relativePath) => !existing.includes(relativePath) && !seeded.some((item) => item.relativePath === relativePath),
        ),
      },
      null,
      2,
    ),
  );
}

async function runLoggedWorkerSetupCommand(params: { workerRepoRoot: string; outputDir: string; logPrefix: string; command: string[]; label: string }): Promise<void> {
  const stdoutPath = resolve(params.outputDir, `${params.logPrefix}.stdout.txt`);
  const stderrPath = resolve(params.outputDir, `${params.logPrefix}.stderr.txt`);
  const result = await runCommand(params.workerRepoRoot, params.command);
  await writeFile(stdoutPath, result.stdout);
  await writeFile(stderrPath, result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(`${params.label} failed (${result.exitCode}): ${outputTail(result.stderr || result.stdout)}`);
  }
}

async function runWorkerConfigure(params: { workerRepoRoot: string; outputDir: string; command: string }): Promise<void> {
  const buildNinjaPath = resolve(params.workerRepoRoot, "build.ninja");
  const objdiffCliPath = resolve(params.workerRepoRoot, "build/tools/objdiff-cli");
  if (existsSync(buildNinjaPath) && existsSync(objdiffCliPath)) return;
  if (!existsSync(buildNinjaPath) && params.command.trim()) {
    await runLoggedWorkerSetupCommand({
      workerRepoRoot: params.workerRepoRoot,
      outputDir: params.outputDir,
      logPrefix: "worker_worktree_configure",
      command: ["/bin/sh", "-c", params.command],
      label: "worker worktree configure",
    });
  }
  if (!existsSync(objdiffCliPath)) {
    await runLoggedWorkerSetupCommand({
      workerRepoRoot: params.workerRepoRoot,
      outputDir: params.outputDir,
      logPrefix: "worker_worktree_tools",
      command: ["ninja", "build/tools/objdiff-cli"],
      label: "worker worktree objdiff-cli bootstrap",
    });
  }
  if (!existsSync(objdiffCliPath)) {
    throw new Error(`worker worktree tools bootstrap did not create ${objdiffCliPath}`);
  }
}

function linkWorkerLogs(workerRepoRoot: string, outputDir: string): void {
  const logsPath = resolve(dirname(workerRepoRoot), "logs");
  if (existsSync(logsPath)) return;
  try {
    symlinkSync(outputDir, logsPath);
  } catch {
    if (!existsSync(logsPath)) throw new Error(`Unable to link worker logs at ${logsPath}`);
  }
}

async function ensureWorkerWorktree(params: {
  sourceRepoRoot: string;
  workerRepoRoot: string;
  baseRev: string;
  outputDir: string;
  configureCommand: string;
  reportArtifactSources: WorkerReportArtifactSource[];
  dryRun: boolean;
}): Promise<void> {
  await mkdir(params.outputDir, { recursive: true });
  if (params.dryRun) {
    await mkdir(params.workerRepoRoot, { recursive: true });
    linkMissingTree(params.sourceRepoRoot, params.workerRepoRoot);
    linkWorkerLogs(params.workerRepoRoot, params.outputDir);
    await seedWorkerReportArtifacts({
      workerRepoRoot: params.workerRepoRoot,
      outputDir: params.outputDir,
      sources: params.reportArtifactSources,
    });
    return;
  }
  if (!existsSync(resolve(params.workerRepoRoot, ".git"))) {
    if (existsSync(params.workerRepoRoot)) {
      throw new Error(`Worker worktree path exists but is not a Git worktree: ${params.workerRepoRoot}`);
    }
    await mkdir(dirname(params.workerRepoRoot), { recursive: true });
    await runGit(params.sourceRepoRoot, ["worktree", "prune"]);
    const add = await runGit(params.sourceRepoRoot, ["worktree", "add", "--detach", params.workerRepoRoot, params.baseRev]);
    if (!add.ok) throw new Error(`git worktree add failed for worker checkout: ${outputTail(add.stderr || add.stdout)}`);
  }

  const origSource = resolve(params.sourceRepoRoot, "orig");
  const origTarget = resolve(params.workerRepoRoot, "orig");
  if (existsSync(origSource)) linkMissingTree(origSource, origTarget);
  await runWorkerConfigure({
    workerRepoRoot: params.workerRepoRoot,
    outputDir: params.outputDir,
    command: params.configureCommand,
  });
  await seedWorkerReportArtifacts({
    workerRepoRoot: params.workerRepoRoot,
    outputDir: params.outputDir,
    sources: params.reportArtifactSources,
  });
  linkWorkerLogs(params.workerRepoRoot, params.outputDir);
}

async function integrateWorkerDiff(params: {
  integrationRepoRoot: string;
  outputDir: string;
  patchPath: string;
  shouldApply: boolean;
}): Promise<{
  attempted: boolean;
  applied: boolean;
  patchPath: string | null;
  reasons: string[];
  checkStdoutPath?: string;
  checkStderrPath?: string;
  applyStdoutPath?: string;
  applyStderrPath?: string;
}> {
  if (!params.shouldApply) return { attempted: false, applied: false, patchPath: null, reasons: [] };
  const patchText = existsSync(params.patchPath) ? await readFile(params.patchPath, "utf8") : "";
  if (!patchText.trim()) {
    return { attempted: true, applied: true, patchPath: params.patchPath, reasons: ["worker diff was empty"] };
  }

  const checkStdoutPath = resolve(params.outputDir, "integration_git_apply_check.stdout.txt");
  const checkStderrPath = resolve(params.outputDir, "integration_git_apply_check.stderr.txt");
  const check = await runCommand(params.integrationRepoRoot, ["git", "apply", "--check", params.patchPath]);
  await writeFile(checkStdoutPath, check.stdout);
  await writeFile(checkStderrPath, check.stderr);
  if (check.exitCode !== 0) {
    return {
      attempted: true,
      applied: false,
      patchPath: params.patchPath,
      reasons: [`git apply --check exited ${check.exitCode}: ${outputTail(check.stderr || check.stdout, 1000)}`],
      checkStdoutPath,
      checkStderrPath,
    };
  }

  const applyStdoutPath = resolve(params.outputDir, "integration_git_apply.stdout.txt");
  const applyStderrPath = resolve(params.outputDir, "integration_git_apply.stderr.txt");
  const apply = await runCommand(params.integrationRepoRoot, ["git", "apply", params.patchPath]);
  await writeFile(applyStdoutPath, apply.stdout);
  await writeFile(applyStderrPath, apply.stderr);
  return {
    attempted: true,
    applied: apply.exitCode === 0,
    patchPath: params.patchPath,
    reasons: apply.exitCode === 0 ? [] : [`git apply exited ${apply.exitCode}: ${outputTail(apply.stderr || apply.stdout, 1000)}`],
    checkStdoutPath,
    checkStderrPath,
    applyStdoutPath,
    applyStderrPath,
  };
}

function mergeRunnerValidation(changeValidation: WorkerChangeValidation, postReturnCheck: PostReturnCheckValidation): WorkerChangeValidation {
  const postReturnCheckSummary = compactPostReturnCheck(postReturnCheck);
  if (changeValidation.status !== "passed") {
    return { ...changeValidation, postReturnCheck: postReturnCheckSummary };
  }
  if (postReturnCheck.status === "failed") {
    return {
      ...changeValidation,
      status: "failed",
      reasons: [...changeValidation.reasons, ...postReturnCheck.reasons],
      postReturnCheck: postReturnCheckSummary,
    };
  }
  return { ...changeValidation, postReturnCheck: postReturnCheckSummary };
}

function runnerValidationCompiled(validation: WorkerRunnerValidation): boolean {
  if (validation.status === "build_failed") return false;
  if (validation.status === "passed" || validation.status === "failed") return Boolean(validation.target) || validation.exitCode === 0;
  if (validation.status === "no_official_score_change" || validation.status === "target_regressed" || validation.status === "same_unit_regression") return true;
  // snapshot_unavailable after a successful object build still carries the unit
  // diff command; pre-build failures carry no command at all.
  return typeof validation.command === "string" && validation.command.includes("objdiff");
}

function clampSummary(text: string, maxChars = 400): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

export async function runWorkerCycle(globals: GlobalArgs, args: Map<string, string | true>): Promise<WorkerCycleResult> {
  const store = openState(globals.stateDir);
  try {
    const runId = stringArg(args, "--run-id", getLatestRun(store)?.id ?? "");
    if (!runId) throw new Error("No run found. Run init-run first.");
    const run = getRun(store, runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    assertSchedulableRun(run, "worker");

    const workerId = stringArg(args, "--worker-id", `worker-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`);
    const baseRev = await resolveBaseRev(globals.repoRoot, stringArg(args, "--base-rev", "unknown"));
    const ttlSeconds = numberArg(args, "--ttl-seconds", DEFAULT_WORKER_TTL_SECONDS);
    const repairAttempts = Math.max(0, Math.trunc(numberArg(args, "--repair-attempts", globals.dryRunAgents ? 0 : 2)));
    const postReturnCheckCommand = stringArg(args, "--post-return-check-command", "");
    const workerConfigureCommand = stringArg(args, "--worker-configure-command", "python3 configure.py --require-protos");
    const graphDbPath = stringArg(args, "--graph-db", globals.graphDbPath ?? resourceGraphDbPath());
    const schedulerEpoch = activeSchedulerEpoch(store, runId);
    if (!schedulerEpoch) throw new Error(`No active epoch with admitted targets for session ${runId}`);
    const claimed = claimNextEpochTarget({ store, sessionId: runId, workerId, baseRev, ttlSeconds });
    if (!claimed) throw new Error(`No admitted epoch targets available for session ${runId}`);
    const outputDir = resolve(globals.stateDir, "runs", runId, "worker_state", claimed.workerStateId);
    store.db.query("UPDATE worker_state SET artifact_dir = ? WHERE id = ?").run(outputDir, claimed.workerStateId);
    const workerRepoRoot = workerWorktreePath(globals, claimed.claimId, schedulerEpoch);
    setClaimWorktreePath(store, claimed.claimId, claimed.workerStateId, workerRepoRoot);
    await ensureWorkerWorktree({
      sourceRepoRoot: globals.repoRoot,
      workerRepoRoot,
      baseRev,
      outputDir,
      configureCommand: workerConfigureCommand,
      reportArtifactSources: reportArtifactSourcesForWorker({ store, runId, globals }),
      dryRun: globals.dryRunAgents,
    });
    const claimWithWorktree = { ...claimed, worktreePath: workerRepoRoot };
    const project = projectMetadata(globals, { graphDbPath, repoRoot: workerRepoRoot });
    const snapshot = loadKnowledgeBoardSnapshot(globals.repoRoot, 12, { graphDbPath });
    const target = targetPacketTarget(claimed.target);
    const knowledgeContext = buildWorkerKnowledgeContext(String(target.source_path ?? ""), graphDbPath);
    const packet = workerPacket({
      run,
      claim: claimWithWorktree,
      target,
      baselineMeasures: snapshot.measures,
      knowledgeContext,
    });
    const initialBoardPath = resolve(globals.stateDir, "runs", runId, "snapshots", "initial_board.json");
    const reportDir = resolve(outputDir, "state");
    await mkdir(reportDir, { recursive: true });
    const validationDir = resolve(outputDir, "runner_validation");
    await mkdir(validationDir, { recursive: true });
    const summaryPath = resolve(reportDir, "worker_state.json");
    const factsPath = resolve(reportDir, "facts.json");
    const preAttemptDiffPath = resolve(validationDir, "pre_worker_write_set.diff");
    const preAttemptDiff = await captureWriteSetDiff(workerRepoRoot, claimed.writeSet, preAttemptDiffPath);
    const workerChangeBaseline: WorkerChangeBaseline = await captureWorkerChangeBaseline({
      repoRoot: workerRepoRoot,
      outputDir: validationDir,
      target,
      dryRun: globals.dryRunAgents,
    });
    await writeFile(resolve(validationDir, "pre_worker_baseline.summary.json"), JSON.stringify(workerChangeBaseline, null, 2));
    const targetUnit = String(target.unit ?? "");
    const targetSymbol = String(target.symbol ?? "");
    appendWorkerActivityEvent(outputDir, {
      claim_id: claimed.claimId,
      phase: "setup",
      event_type: "claim_started",
      unit: targetUnit,
      symbol: targetSymbol,
      summary: `worker ${claimed.workerId} claimed ${targetSymbol} (${targetUnit}); baseline ${workerChangeBaseline.status}`,
      score:
        workerChangeBaseline.snapshot?.targetScore != null
          ? { before: workerChangeBaseline.snapshot.targetScore, after: null, exact: false }
          : undefined,
      artifact_path: workerChangeBaseline.snapshotPath,
    });
    let repairRequest: Record<string, unknown> | null = null;
    let finalEvaluation: WorkerAttemptEvaluation | null = null;
    for (let attemptIndex = 0; attemptIndex <= repairAttempts; attemptIndex += 1) {
      const attemptPacket = repairRequest
        ? {
            ...packet,
            repair_request: repairRequest,
          }
        : packet;
      appendWorkerActivityEvent(outputDir, {
        claim_id: claimed.claimId,
        attempt_index: attemptIndex,
        phase: repairRequest ? "repair" : "attempt",
        event_type: "attempt_started",
        unit: targetUnit,
        symbol: targetSymbol,
        summary: repairRequest
          ? clampSummary(`repair attempt ${attemptIndex} in flight: ${(repairRequest.reasons as string[]).join("; ")}`)
          : `worker attempt ${attemptIndex} started`,
      });
      let result: PiRunResult;
      try {
        result = await runPiAgent({
          role: "worker",
          cwd: workerRepoRoot,
          prompt: workerPrompt({
            packet: attemptPacket,
            repoRoot: workerRepoRoot,
            stateDir: globals.stateDir,
            project,
            initialBoardPath,
            workerLogDir: outputDir,
          }),
          outputDir,
          dryRun: globals.dryRunAgents,
          provider: globals.provider,
          model: globals.model,
          thinkingLevel: globals.thinkingLevel,
          timeoutMs: globals.agentTimeoutSeconds ? globals.agentTimeoutSeconds * 1000 : undefined,
          // Whole-file writes conflict with the preserve-dirty-work rule and were
          // used in 0% of confirmed exacts (-51pt lift); edit/bash cover the need.
          excludeBuiltinTools: ["write"],
          toolContext: {
            repoRoot: workerRepoRoot,
            stateDir: globals.stateDir,
            project,
            worktreeId: claimed.claimId,
            packet: attemptPacket,
            initialBoardPath,
            workerLogDir: outputDir,
            claimId: claimed.claimId,
            attemptIndex,
          },
          kernelContext: createMeleeKernelSpawnContext({
            kind: "worker",
            projectId: project?.projectId ?? globals.projectId,
            sessionId: runId,
            runId,
            epochId: schedulerEpoch?.id ?? "active",
            claimId: claimed.claimId,
            targetId: claimed.targetId,
            phase: "worker",
            workingDir: workerRepoRoot,
            metadata: {
              workerId,
              attemptIndex,
              attemptPhase: repairRequest ? "repair" : "attempt",
              targetUnit,
              targetSymbol,
              sourcePath: String(target.source_path ?? ""),
              integrationRepoRoot: globals.repoRoot,
              workerRepoRoot,
            },
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          sessionId: `worker-launch-failed-${randomUUID()}`,
          outputPath: resolve(outputDir, `worker_launch_failed_${attemptIndex}.txt`),
          systemPromptPath: resolve(outputDir, `worker_launch_failed_${attemptIndex}.system.md`),
          userPromptPath: resolve(outputDir, `worker_launch_failed_${attemptIndex}.user.md`),
          rawText: `[worker launch failed]\n${message}\n`,
          dryRun: globals.dryRunAgents,
          failed: true,
          error: message,
        };
        await writeFile(result.outputPath, result.rawText);
        await writeFile(result.systemPromptPath, "");
        await writeFile(result.userPromptPath, "");
      }

      addPiSession({
        store,
        runId,
        claimId: claimed.claimId,
        role: "worker",
        sessionId: result.sessionId,
        sessionFile: result.sessionFile,
        provider: globals.provider,
        model: globals.model,
        thinkingLevel: globals.thinkingLevel,
        status: result.failed || result.providerError ? "failed" : result.dryRun ? "dry_run" : "succeeded",
        outputPath: result.outputPath,
      });
      appendWorkerSessionId(store, claimed.workerStateId, result.sessionId);
      appendWorkerActivityEvent(outputDir, {
        claim_id: claimed.claimId,
        session_id: result.sessionId,
        attempt_index: attemptIndex,
        phase: repairRequest ? "repair" : "attempt",
        event_type: "pi_session_finished",
        unit: targetUnit,
        symbol: targetSymbol,
        summary: result.failed ? clampSummary(`Pi session failed: ${result.error ?? "unknown error"}`) : "Pi session returned; evaluating worker note",
        artifact_path: result.outputPath,
      });

      const parsedAgentNote =
        result.dryRun || result.failed ? { note: null as Record<string, unknown> | null, error: result.error } : parseWorkerCheckpointNote(result.rawText);
      const agentNote = parsedAgentNote.note;
      const agentToolErrors = agentNoteSignalsToolError(agentNote);
      const postAttemptDiffPath = resolve(validationDir, `attempt-${attemptIndex}.write_set.diff`);
      const postAttemptDiff = await captureWriteSetDiff(workerRepoRoot, claimed.writeSet, postAttemptDiffPath);
      const writeSetDiffChanged = postAttemptDiff.stdout !== preAttemptDiff.stdout;
      const reviewLint = lintWorkerReviewDiff(postAttemptDiff.stdout);
      const shouldRunRunnerValidation = !result.failed && !result.providerError && agentToolErrors.fatal.length === 0;
      const changeValidation = await validateWorkerChange({
        repoRoot: workerRepoRoot,
        outputDir: validationDir,
        attemptIndex,
        baseline: workerChangeBaseline,
        target,
        dryRun: globals.dryRunAgents,
        shouldRun: shouldRunRunnerValidation,
        claimedExact: true,
      });
      const postReturnCheck = await runPostReturnCheck({
        commandTemplate: postReturnCheckCommand,
        dryRun: globals.dryRunAgents,
        repoRoot: workerRepoRoot,
        stateDir: globals.stateDir,
        workerLogDir: outputDir,
        claimId: claimed.claimId,
        writeSet: claimed.writeSet,
        target,
        outputDir,
        attemptIndex,
        shouldRun: shouldRunRunnerValidation && changeValidation.status === "passed",
      });
      const runnerValidation = mergeRunnerValidation(changeValidation, postReturnCheck);
      if (runnerValidation.summaryPath) await writeFile(runnerValidation.summaryPath, JSON.stringify(runnerValidation, null, 2));
      recordWorkerCheckpoint(store, {
        workerStateId: claimed.workerStateId,
        sessionId: runId,
        epochId: claimed.epochId,
        epochTargetId: claimed.epochTargetId,
        targetClaimId: claimed.claimId,
        attemptIndex,
        oldScore: runnerValidation.target?.before ?? null,
        newScore: runnerValidation.target?.after ?? null,
        exactMatch: Boolean(runnerValidation.target?.exact),
        hardGatesPassed: runnerValidation.status === "passed",
        buildStatus: runnerValidationCompiled(runnerValidation) ? "compiled" : "not_compiled",
        qaStatus: runnerValidation.qaLint?.status ?? null,
        objdiffStatus: runnerValidation.target ? "available" : null,
        validationStatus: runnerValidation.status,
        artifactPath: runnerValidation.summaryPath ?? null,
        patchPath: postAttemptDiffPath,
        diffPath: postAttemptDiffPath,
        failureReasons: runnerValidation.reasons,
        metadata: {
          agent_output_path: result.outputPath,
          agent_note: agentNote,
          agent_note_parse_error: parsedAgentNote.error ?? null,
          review_lint: reviewLint,
          post_return_check: runnerValidation.postReturnCheck ?? null,
          write_set_diff_changed: writeSetDiffChanged,
        },
      });
      appendWorkerActivityEvent(outputDir, {
        claim_id: claimed.claimId,
        session_id: result.sessionId,
        attempt_index: attemptIndex,
        phase: repairRequest ? "repair_validation" : "validation",
        event_type: "worker_note",
        unit: targetUnit,
        symbol: targetSymbol,
        summary: parsedAgentNote.error
          ? clampSummary(`worker note parse issue: ${parsedAgentNote.error}`)
          : `worker note status: ${recordString(agentNote?.status) || "missing"}`,
      });
      appendWorkerActivityEvent(outputDir, {
        claim_id: claimed.claimId,
        session_id: result.sessionId,
        attempt_index: attemptIndex,
        phase: repairRequest ? "repair_validation" : "validation",
        event_type: runnerValidation.status === "passed" ? "runner_validation_passed" : runnerValidation.status === "skipped" ? "runner_validation_skipped" : "runner_validation_rejected",
        unit: targetUnit,
        symbol: targetSymbol,
        summary: clampSummary(`runner validation ${runnerValidation.status}${runnerValidation.reasons.length > 0 ? `: ${runnerValidation.reasons.join("; ")}` : ""}`),
        score: runnerValidation.target
          ? { before: runnerValidation.target.before, after: runnerValidation.target.after, exact: runnerValidation.target.exact }
          : undefined,
        artifact_path: runnerValidation.summaryPath,
      });
      const repairReasons = workerAttemptRepairReasons({ writeSetDiffChanged, runnerValidation, reviewLint });
      if (!result.failed && !result.providerError && runnerValidation.status === "passed" && !runnerValidation.target?.exact) {
        const before = runnerValidation.target?.before;
        const after = runnerValidation.target?.after;
        repairReasons.push(
          `runner checkpoint was not exact${typeof before === "number" && typeof after === "number" ? ` (${before.toFixed(5)} -> ${after.toFixed(5)})` : ""}; continue the same target toward exact match`,
        );
      }
      const attemptGatePath = resolve(validationDir, `attempt-${attemptIndex}.return_gate.json`);
      const evaluation: WorkerAttemptEvaluation = {
        result,
        agentNote,
        parsedError: parsedAgentNote.error,
        runnerValidation,
        repairReasons,
        writeSetDiffChanged,
        postAttemptDiffPath,
      };
      await writeFile(
        attemptGatePath,
        JSON.stringify(
          {
            attempt_index: attemptIndex,
            max_repair_attempts: repairAttempts,
            agent_output_path: result.outputPath,
            agent_note_parse_error: parsedAgentNote.error ?? null,
            agent_note_status: recordString(agentNote?.status) || null,
            runner_validation: runnerValidation,
            review_lint: reviewLint,
            write_set_diff: {
              baseline_path: preAttemptDiffPath,
              post_attempt_path: postAttemptDiffPath,
              changed_from_pre_worker: writeSetDiffChanged,
            },
            repair_reasons: repairReasons,
          },
          null,
          2,
        ),
      );

      finalEvaluation = evaluation;
      // A dead provider can't repair anything — retrying just burns ~20 minutes of
      // timeout-retries per attempt while the endpoint is down.
      if (result.providerError && !agentNote) break;
      if (runnerValidation.target?.exact || repairReasons.length === 0 || attemptIndex >= repairAttempts || result.dryRun) break;

      const repairFeedbackPath = resolve(validationDir, `attempt-${attemptIndex}.repair_request.json`);
      repairRequest = {
        attempt: attemptIndex + 1,
        previous_agent_output_path: result.outputPath,
        previous_return_gate_path: attemptGatePath,
        previous_post_attempt_diff_path: postAttemptDiffPath,
        reasons: repairReasons,
        instruction:
          "The runner validated the current worktree but has not accepted an exact match. Keep the retained useful edits, fix any runner-listed validation issues, preserve pre-existing dirty work, and continue this same target toward exact. Return a compact validation-ready JSON note when you want the runner to checkpoint again. Do not use whole-file destructive reset/restore/checkout/clean commands.",
      };
      evaluation.repairFeedbackPath = repairFeedbackPath;
      await writeFile(repairFeedbackPath, JSON.stringify(repairRequest, null, 2));
      appendWorkerActivityEvent(outputDir, {
        claim_id: claimed.claimId,
        session_id: result.sessionId,
        attempt_index: attemptIndex,
        phase: "repair_request",
        event_type: "repair_requested",
        unit: targetUnit,
        symbol: targetSymbol,
        summary: clampSummary(`runner rejected the return; repair attempt ${attemptIndex + 1} requested: ${repairReasons.join("; ")}`),
        artifact_path: repairFeedbackPath,
      });
    }

    if (!finalEvaluation) throw new Error("Worker loop ended without an attempt evaluation");

    const result = finalEvaluation.result;
    const agentNote = finalEvaluation.agentNote;
    const agentFacts = Array.isArray(agentNote?.facts) ? agentNote.facts : [];
    const agentBlockers = Array.isArray(agentNote?.blockers) ? agentNote.blockers : [];
    const bestCheckpoint = bestCheckpointForWorkerState(store, claimed.workerStateId);
    const infraError =
      result.providerError
        ? {
            kind: "provider_error",
            summary: `LLM provider failed before the runner could continue the worker: ${result.providerError}`,
            reasons: [result.providerError],
          }
        : result.failed
          ? {
              kind: "worker_session_failed",
              summary: `Worker Pi session failed before producing a validation-ready state: ${result.error ?? "unknown error"}`,
              reasons: [result.error ?? "unknown worker session failure"],
            }
          : null;
    const agentToolErrors = agentNoteSignalsToolError(agentNote);
    const errorClassification =
      infraError ??
      (agentToolErrors.fatal.length > 0
        ? {
            kind: "agent_noted_tool_error",
            summary: `Worker note describes a tool/build/validation failure: ${agentToolErrors.fatal.join("; ")}`,
            reasons: agentToolErrors.fatal,
          }
        : null);
    const lifecycleStatus = errorClassification ? "error" : bestCheckpoint?.exactMatch ? "exact" : "timeout";
    const summaryText =
      errorClassification?.summary ??
      (bestCheckpoint?.exactMatch
        ? `Runner selected exact checkpoint ${bestCheckpoint.id}.`
        : bestCheckpoint
          ? `Runner timeout selected best prior checkpoint ${bestCheckpoint.id} (${bestCheckpoint.newScore ?? "unknown"}).`
          : "Runner timeout selected baseline because no checkpoint passed hard gates and improved over baseline.");
    const workerStateSummary = {
      session_id: runId,
      epoch_id: claimed.epochId,
      epoch_target_id: claimed.epochTargetId,
      target_claim_id: claimed.claimId,
      worker_state_id: claimed.workerStateId,
      worker_id: claimed.workerId,
      target,
      write_set: claimed.writeSet,
      worker_worktree_path: workerRepoRoot,
      lifecycle_status: lifecycleStatus,
      selected_checkpoint_id: bestCheckpoint?.id ?? null,
      selected_score: bestCheckpoint?.newScore ?? null,
      exact: Boolean(bestCheckpoint?.exactMatch),
      agent_output_path: result.outputPath,
      agent_note: agentNote,
      agent_note_parse_error: finalEvaluation.parsedError ?? null,
      facts: agentFacts,
      blockers: agentBlockers,
      error: errorClassification,
      latest_runner_validation: finalEvaluation.runnerValidation,
      continuation_attempts: {
        configured: repairAttempts,
        exhausted: finalEvaluation.repairReasons.length > 0,
        latest_reasons: finalEvaluation.repairReasons,
        latest_write_set_diff_path: finalEvaluation.postAttemptDiffPath,
        repair_feedback_path: finalEvaluation.repairFeedbackPath ?? null,
      },
      created_at: new Date().toISOString(),
    };
    await writeFile(summaryPath, JSON.stringify(workerStateSummary, null, 2));
    await writeFile(factsPath, JSON.stringify(agentFacts, null, 2));
    if (errorClassification || agentBlockers.length > 0 || finalEvaluation.repairReasons.length > 0) {
      await writeFile(
        resolve(reportDir, "blocker.json"),
        JSON.stringify(
          {
            reason: errorClassification?.kind ?? lifecycleStatus,
            note: summaryText,
            runner_validation: finalEvaluation.runnerValidation,
            continuation_attempts: workerStateSummary.continuation_attempts,
            error: errorClassification,
            blockers: agentBlockers,
          },
          null,
          2,
        ),
      );
    }

    closeWorkerState(store, {
      workerStateId: claimed.workerStateId,
      lifecycleStatus,
      timeoutSummary: lifecycleStatus === "timeout" ? summaryText : null,
      errorSummary: lifecycleStatus === "error" ? summaryText : null,
      summary: workerStateSummary,
    });
    const wakeEvent = addEvent(store, runId, lifecycleStatus === "error" ? "worker_error" : "worker_finished", "worker", {
      worker_state_id: claimed.workerStateId,
      target_claim_id: claimed.claimId,
      epoch_target_id: claimed.epochTargetId,
      worker_id: claimed.workerId,
      lifecycle_status: lifecycleStatus,
      selected_checkpoint_id: bestCheckpoint?.id ?? null,
      exact: Boolean(bestCheckpoint?.exactMatch),
      summary_path: summaryPath,
    });
    let workerOutputIntegration: WorkerCycleResult["workerOutputIntegration"] | undefined;
    if (bestCheckpoint) {
      const item = enqueueWorkerOutputIntegration(store, {
        sessionId: runId,
        epochId: claimed.epochId,
        epochTargetId: claimed.epochTargetId,
        targetClaimId: claimed.claimId,
        workerStateId: claimed.workerStateId,
        workerCheckpointId: bestCheckpoint.id,
        targetKey: `${targetUnit}::${targetSymbol}`,
        patchPath: bestCheckpoint.patchPath,
        diffPath: bestCheckpoint.diffPath,
        writeSet: claimed.writeSet,
        metadata: {
          lifecycle_status: lifecycleStatus,
          exact: Boolean(bestCheckpoint.exactMatch),
          worker_state_summary_path: summaryPath,
          worker_worktree_path: workerRepoRoot,
          target,
        },
      });
      const queue = await processWorkerOutputIntegrationQueue({
        dryRun: globals.dryRunAgents,
        repoRoot: globals.repoRoot,
        sessionId: runId,
        stateDir: globals.stateDir,
        store,
      });
      workerOutputIntegration = { itemId: item.id, processed: queue.processed };
    }
    appendWorkerActivityEvent(outputDir, {
      claim_id: claimed.claimId,
      session_id: result.sessionId,
      phase: "worker_state",
      event_type: "worker_state_closed",
      unit: targetUnit,
      symbol: targetSymbol,
      summary: clampSummary(summaryText),
      score: finalEvaluation.runnerValidation.target
        ? {
            before: finalEvaluation.runnerValidation.target.before,
            after: finalEvaluation.runnerValidation.target.after,
            exact: finalEvaluation.runnerValidation.target.exact,
          }
        : undefined,
      artifact_path: summaryPath,
    });
    return {
      runId,
      claimId: claimed.claimId,
      workerStateId: claimed.workerStateId,
      epochTargetId: claimed.epochTargetId,
      target: claimed.targetId,
      writeSet: claimed.writeSet,
      workerOutput: result.outputPath,
      workerSystemPrompt: result.systemPromptPath,
      workerUserPrompt: result.userPromptPath,
      workerStatePath: summaryPath,
      lifecycleStatus,
      bestCheckpointId: bestCheckpoint?.id ?? null,
      bestScore: bestCheckpoint?.newScore ?? null,
      exact: Boolean(bestCheckpoint?.exactMatch),
      wakeEvent,
      dryRun: result.dryRun,
      failed: lifecycleStatus === "error" && errorClassification?.kind !== "provider_error",
      providerFailure: errorClassification?.kind === "provider_error",
      errorKind: errorClassification?.kind,
      error: errorClassification?.summary,
      workerOutputIntegration,
    };
  } finally {
    store.db.close();
  }
}

export function buildWorkerKnowledgeContext(sourcePath: string, graphDb = resourceGraphDbPath()): Record<string, unknown> {
  const pathFacts = sourcePath ? resolvePathFactsContext(sourcePath, 5) : null;
  const lookupTools = [...defaultWorkerToolProfile];
  if (!sourcePath) {
    return {
      status: "missing_source_path",
      graph_db: graphDb,
      path_facts: { source: "path_facts", status: "missing_source_path" },
      lookup_tools: lookupTools,
    };
  }
  if (!graphDbExists(graphDb)) {
    return {
      status: "graph_missing",
      graph_db: graphDb,
      path_facts: pathFacts,
      lookup_tools: lookupTools,
    };
  }
  const store = openKnowledgeGraph(graphDb);
  try {
    return {
      status: "ready",
      graph_db: graphDb,
      generated_at: new Date().toISOString(),
      file_card: fileGraphCard(store, sourcePath),
      path_facts: pathFacts,
      lookup_tools: lookupTools,
    };
  } catch (error) {
    return {
      status: "failed",
      graph_db: graphDb,
      reason: error instanceof Error ? error.message : String(error),
      path_facts: pathFacts,
      lookup_tools: lookupTools,
    };
  } finally {
    store.db.close();
  }
}

export async function worker(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  console.log(JSON.stringify(await runWorkerCycle(globals, args), null, 2));
}
