import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { QA_LINT_REPAIR_INSTRUCTION, type WorkerChangeValidation, type WorkerQaLint } from "@server/core/agent-catalog/agents/running/worker/change-validation";
import type { QaScanFinding } from "@server/core/validation/qa";
import type { PiRunResult } from "@server/core/shared/types";
import type { LadderConfig } from "@server/core/session-runtime/escalation/ladder";
import {
  classifyWorkerError,
  configureCommandWithWorkerToolPaths,
  isReworkErrorKind,
  seedWorkerToolArtifacts,
  shouldReAdmitEscalatedWorker,
  shouldRequestWorkerRepairAfterAttempt,
  WORKER_ATTEMPT_TAIL_POLICY,
  workerContinuationDecision,
  workerCycleIncidentFlags,
  workerSessionFailed,
  workerAgentToolEnvironment,
  workerBuildNinjaNeedsToolReconfigure,
  workerAttemptRepairReasons,
  writeWorkerShellGuardBin,
  workerToolArtifactSourceRoots,
  workerWorktreeLockDir,
  workerWorktreePath,
} from "@server/core/session-runtime/phases/running/workers/worker-cycle.js";

function finding(overrides: Partial<QaScanFinding> = {}): QaScanFinding {
  return {
    rule_id: "packed_string_blob",
    severity: "error",
    file: "src/colosseum/mn/mncount.c",
    line: 782,
    excerpt: 'static char lbl_803EE888[0x18] = "a\\0b";',
    message: "hand-packed string blob",
    standard_id: "global_standard:literals-and-data-ownership",
    ...overrides,
  };
}

function violationsQaLint(findings: QaScanFinding[] = [finding()]): WorkerQaLint {
  return { status: "violations", exitCode: 1, findings, scanPath: "/tmp/attempt-0.qa_diff.patch", toolError: null };
}

function warningsQaLint(findings: QaScanFinding[] = [finding({ severity: "warning" })]): WorkerQaLint {
  return { status: "warnings", exitCode: 2, findings, scanPath: "/tmp/attempt-0.qa_diff.patch", toolError: null };
}

function piResult(): PiRunResult {
  return {
    sessionId: "session-1",
    outputPath: "/tmp/worker.out",
    systemPromptPath: "/tmp/worker.system.md",
    userPromptPath: "/tmp/worker.user.md",
    rawText: "{}",
    dryRun: false,
  };
}

function continuationCheckpoint(
  attemptIndex: number,
  overrides: Partial<{ exactMatch: boolean; hardGatesPassed: boolean; selectable: boolean; newScore: number | null }> = {},
) {
  return {
    attemptIndex,
    exactMatch: false,
    hardGatesPassed: false,
    selectable: false,
    newScore: null,
    ...overrides,
  };
}

function escalationLadder(): LadderConfig {
  return {
    id: "spark-to-sol",
    mode: "escalation",
    rungs: [
      {
        provider: "openai-codex",
        model: "gpt-5.3-codex-spark",
        thinking: "medium",
        budget: { agentTimeoutSeconds: 1200, ttlSeconds: 1800, maxAttempts: 1 },
      },
      {
        provider: "openai-codex",
        model: "gpt-5.6-codex",
        thinking: "xhigh",
        budget: { agentTimeoutSeconds: 2400, ttlSeconds: 3600, maxAttempts: 1 },
      },
    ],
  };
}

function rejectedValidation(qaLint: WorkerQaLint): WorkerChangeValidation {
  // What applyQaLintToValidation produces from a score-improving attempt with violations.
  return {
    status: "failed",
    reasons: [`qa lint found 1 QA finding(s) requiring repair (gate exit ${qaLint.exitCode ?? "unknown"})`],
    target: { unit: "colosseum/mn/mncount.c", symbol: "mnCount_803EE888", before: 80, after: 99.999999, improved: true, exact: true },
    qaLint,
  };
}

function passedValidation(qaLint: WorkerQaLint | null): WorkerChangeValidation {
  return {
    status: "passed",
    reasons: [],
    target: { unit: "colosseum/mn/mncount.c", symbol: "mnCount_803EE888", before: 80, after: 99.999999, improved: true, exact: true },
    qaLint,
  };
}

describe("workerWorktreePath", () => {
  test("places worker worktrees under the active session epoch", () => {
    expect(
      workerWorktreePath(
        {
          repoRoot: "/project/worktrees/sessions/session-uuid/current",
          stateDir: "/state",
          project: { projectDir: "/project" },
        } as never,
        "claim-1",
        { ordinal: 2 },
      ),
    ).toBe("/project/worktrees/sessions/session-uuid/epochs/0002/workers/claim-1/source");
  });

  test("keeps legacy placement for non-session runs", () => {
    expect(
      workerWorktreePath(
        {
          repoRoot: "/project/checkout",
          stateDir: "/state",
          project: { projectDir: "/project" },
        } as never,
        "claim-1",
        { ordinal: 2 },
      ),
    ).toBe("/project/worktrees/claim-1/source");
  });

  test("places dry-run worker worktrees under the state directory", () => {
    expect(
      workerWorktreePath(
        {
          dryRunAgents: true,
          repoRoot: "/project/checkout",
          stateDir: "/state",
          project: { projectDir: "/project" },
        } as never,
        "claim-1",
        { ordinal: 2 },
      ),
    ).toBe("/state/dry_run_worktrees/claim-1/source");
  });
});

describe("workerWorktreeLockDir", () => {
  test("serializes git worktree mutations through one epoch-level lock", () => {
    const first = workerWorktreeLockDir("/project/worktrees/sessions/session-uuid/epochs/0012/workers/claim-1/source");
    const second = workerWorktreeLockDir("/project/worktrees/sessions/session-uuid/epochs/0012/workers/claim-2/source");

    expect(first).toBe("/project/worktrees/sessions/session-uuid/epochs/0012/workers/.git-worktree-add.lock");
    expect(second).toBe(first);
  });
});

describe("workerToolArtifactSourceRoots", () => {
  test("uses the active repo then upstream-current as tool artifact sources", () => {
    expect(
      workerToolArtifactSourceRoots({
        repoRoot: "/project/worktrees/sessions/session-uuid/current",
        project: { projectDir: "/project" },
      } as never),
    ).toEqual(["/project/worktrees/sessions/session-uuid/current", "/project/worktrees/upstream-current"]);
  });

  test("copies mutable build tools and links large shared tool bundles into worker worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "worker-tool-artifacts-"));
    try {
      const source = resolve(root, "source");
      const worker = resolve(root, "worker");
      const outputDir = resolve(root, "out");
      mkdirSync(resolve(source, "build/tools"), { recursive: true });
      mkdirSync(resolve(source, "build/compilers"), { recursive: true });
      mkdirSync(resolve(source, "build/binutils"), { recursive: true });
      writeFileSync(resolve(source, "build/tools/sjiswrap.exe"), "tool-v2");
      writeFileSync(resolve(source, "build/compilers/mwcceppc.exe"), "compiler");
      writeFileSync(resolve(source, "build/binutils/powerpc-eabi-ld"), "ld");

      mkdirSync(resolve(worker, "build"), { recursive: true });
      symlinkSync(resolve(source, "build/tools"), resolve(worker, "build/tools"), "dir");
      mkdirSync(resolve(worker, "build/compilers"), { recursive: true });
      writeFileSync(resolve(worker, "build/compilers/old-local-copy"), "old");

      await seedWorkerToolArtifacts({
        workerRepoRoot: worker,
        outputDir,
        sources: [
          { relativePath: "build/tools", sourcePath: resolve(source, "build/tools") },
          { relativePath: "build/compilers", sourcePath: resolve(source, "build/compilers") },
          { relativePath: "build/binutils", sourcePath: resolve(source, "build/binutils") },
        ],
      });

      expect(lstatSync(resolve(worker, "build/tools")).isSymbolicLink()).toBe(false);
      expect(readFileSync(resolve(worker, "build/tools/sjiswrap.exe"), "utf8")).toBe("tool-v2");
      expect(lstatSync(resolve(worker, "build/compilers")).isSymbolicLink()).toBe(true);
      expect(readFileSync(resolve(worker, "build/compilers/mwcceppc.exe"), "utf8")).toBe("compiler");
      expect(lstatSync(resolve(worker, "build/binutils")).isSymbolicLink()).toBe(true);
      expect(readFileSync(resolve(worker, "build/binutils/powerpc-eabi-ld"), "utf8")).toBe("ld");
      expect(existsSync(resolve(outputDir, "worker_worktree_tool_artifacts.json"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refreshes existing mutable build tool directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "worker-tool-refresh-"));
    try {
      const source = resolve(root, "source");
      const worker = resolve(root, "worker");
      const outputDir = resolve(root, "out");
      mkdirSync(resolve(source, "build/tools"), { recursive: true });
      writeFileSync(resolve(source, "build/tools/wibo"), "wibo");
      writeFileSync(resolve(source, "build/tools/sjiswrap.exe"), "sjiswrap-v2");
      mkdirSync(resolve(worker, "build/tools"), { recursive: true });
      writeFileSync(resolve(worker, "build/tools/sjiswrap.exe"), "sjiswrap-v1");

      await seedWorkerToolArtifacts({
        workerRepoRoot: worker,
        outputDir,
        sources: [{ relativePath: "build/tools", sourcePath: resolve(source, "build/tools") }],
      });

      expect(readFileSync(resolve(worker, "build/tools/wibo"), "utf8")).toBe("wibo");
      expect(readFileSync(resolve(worker, "build/tools/sjiswrap.exe"), "utf8")).toBe("sjiswrap-v2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("passes worker-local seeded tools to configure.py", () => {
    expect(
      configureCommandWithWorkerToolPaths("python3 configure.py --require-protos", {
        binutils: "build/binutils",
        compilers: "build/compilers",
        dtk: "build/tools/dtk",
        objdiff: "build/tools/objdiff-cli",
        sjiswrap: "build/tools/sjiswrap.exe",
      }),
    ).toBe(
      "python3 configure.py --require-protos --binutils 'build/binutils' --compilers 'build/compilers' --dtk 'build/tools/dtk' --objdiff 'build/tools/objdiff-cli' --sjiswrap 'build/tools/sjiswrap.exe'",
    );
  });

  test("filters worker-local tools to flags supported by configure.py", () => {
    expect(
      configureCommandWithWorkerToolPaths(
        "python3 configure.py",
        {
          binutils: "build/binutils",
          compilers: "build/compilers",
          dtk: "build/tools/dtk",
          objdiff: "build/tools/objdiff-cli",
          sjiswrap: "build/tools/sjiswrap.exe",
          wrapper: "build/tools/wibo",
        },
        { supportedFlags: new Set(["--compilers", "--dtk", "--objdiff", "--wrapper"]) },
      ),
    ).toBe("python3 configure.py --wrapper 'build/tools/wibo' --compilers 'build/compilers' --dtk 'build/tools/dtk' --objdiff 'build/tools/objdiff-cli'");
  });

  test("does not override explicit configure.py tool paths", () => {
    expect(
      configureCommandWithWorkerToolPaths("python3 configure.py --require-protos --compilers /shared/compilers", {
        compilers: "build/compilers",
        objdiff: "build/tools/objdiff-cli",
      }),
    ).toBe("python3 configure.py --require-protos --compilers /shared/compilers --objdiff 'build/tools/objdiff-cli'");
  });

  test("prefers worker-local wibo over an absolute wrapper path with spaces", () => {
    expect(
      configureCommandWithWorkerToolPaths("python3 configure.py --require-protos --wrapper '/Users/Ford/Github Repos/project/state/tools/wibo'", {
        wrapper: "build/tools/wibo",
        objdiff: "build/tools/objdiff-cli",
      }),
    ).toBe("python3 configure.py --require-protos --wrapper 'build/tools/wibo' --objdiff 'build/tools/objdiff-cli'");
  });

  test("detects stale build.ninja tool download edges when local tools are seeded", () => {
    expect(
      workerBuildNinjaNeedsToolReconfigure("rule download_tool\n  command = $python tools/download_tool.py $tool $out --tag $tag\nbuild build/compilers: download_tool | tools/download_tool.py\n  tool = compilers", {
        compilers: "build/compilers",
      }),
    ).toBe(true);
    expect(
      workerBuildNinjaNeedsToolReconfigure("build build/compilers: phony\n", {
        compilers: "build/compilers",
      }),
    ).toBe(false);
    expect(
      workerBuildNinjaNeedsToolReconfigure("command = python3 tools/download_tool.py compilers build/compilers --tag 20251118", {}),
    ).toBe(false);
  });

  test("detects stale build.ninja wrapper paths when worker-local wibo is available", () => {
    expect(
      workerBuildNinjaNeedsToolReconfigure("configure_args = --require-protos --wrapper /Users/Ford/Github $\\n  Repos/project/state/tools/wibo\\n", {
        wrapper: "build/tools/wibo",
      }),
    ).toBe(true);
    expect(
      workerBuildNinjaNeedsToolReconfigure("configure_args = --require-protos --wrapper build/tools/wibo\\n", {
        wrapper: "build/tools/wibo",
      }),
    ).toBe(false);
  });
});

describe("worker shell tool environment", () => {
  test("puts the worker guard and canonical tool directories first on PATH", () => {
    const env = workerAgentToolEnvironment({ workerRepoRoot: "/project/workers/claim/source", shellBin: "/state/worker/bin" });
    const pathEntries = env.PATH.split(delimiter);

    expect(pathEntries.slice(0, 3)).toEqual([
      "/state/worker/bin",
      "/project/workers/claim/source/build/binutils",
      "/project/workers/claim/source/build/tools",
    ]);
    expect(env.ORCH_WORKER_TOOL_POWERPC_EABI_OBJDUMP).toBe("build/binutils/powerpc-eabi-objdump");
    expect(env.ORCH_WORKER_TOOL_DTK).toBe("build/tools/dtk");
    expect(env.ORCH_WORKER_CANONICAL_TOOL_PATHS).toContain("powerpc-eabi-objdump");
  });

  test("writes a find guard that blocks broad sweeps while allowing narrow worker-local roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "worker-find-guard-"));
    try {
      const worker = resolve(root, "worker");
      const outputDir = resolve(root, "out");
      mkdirSync(resolve(worker, "src"), { recursive: true });
      const shellBin = await writeWorkerShellGuardBin({ outputDir });
      const env = workerAgentToolEnvironment({ workerRepoRoot: worker, shellBin });
      const guardedFind = resolve(shellBin, "find");
      const script = readFileSync(guardedFind, "utf8");

      expect(env.PATH.split(delimiter)[0]).toBe(shellBin);
      expect(script).toContain('real_find="${ORCH_REAL_FIND:-/usr/bin/find}"');
      expect(script).toContain('""|".") ;;');
      expect(script).toContain('*/../*|*/..) blocked_find "$arg" ;;');
      expect(script).toContain('blocked broad worker find sweep');
      expect(script).toContain("build/binutils/powerpc-eabi-objdump");
      expect(script).toContain('exec "$real_find" "$@"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("workerAttemptRepairReasons", () => {
  test("violations append one verbatim qa_lint_finding reason per finding plus the instruction", () => {
    const validation = rejectedValidation(violationsQaLint());
    const reasons = workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: validation });
    expect(reasons).toContain(
      'qa_lint_finding: error packed_string_blob at src/colosseum/mn/mncount.c:782 — hand-packed string blob [standard: global_standard:literals-and-data-ownership] excerpt: static char lbl_803EE888[0x18] = "a\\0b";',
    );
    expect(reasons[reasons.length - 1]).toBe(QA_LINT_REPAIR_INSTRUCTION);
    // The runner-validation summary reason also rides along (status is failed).
    expect(reasons.some((reason) => reason.startsWith("runner validation: qa lint found"))).toBe(true);
  });

  test("warnings append repair reasons too", () => {
    const validation = rejectedValidation(warningsQaLint());
    const reasons = workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: validation });
    expect(reasons).toContain(
      'qa_lint_finding: warning packed_string_blob at src/colosseum/mn/mncount.c:782 — hand-packed string blob [standard: global_standard:literals-and-data-ownership] excerpt: static char lbl_803EE888[0x18] = "a\\0b";',
    );
    expect(reasons[reasons.length - 1]).toBe(QA_LINT_REPAIR_INSTRUCTION);
  });

  test("tool_unavailable contributes no rejection reasons: a passed attempt stays accepted", () => {
    const qaLint: WorkerQaLint = { status: "tool_unavailable", exitCode: -1, findings: [], scanPath: null, toolError: "scan_diff.py not found" };
    const reasons = workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: passedValidation(qaLint) });
    expect(reasons).toEqual([]);
  });

  test("clean qaLint on a passed attempt yields no repair reasons", () => {
    const qaLint: WorkerQaLint = { status: "clean", exitCode: 0, findings: [], scanPath: null, toolError: null };
    expect(workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: passedValidation(qaLint) })).toEqual([]);
  });
});

describe("shouldRequestWorkerRepairAfterAttempt", () => {
  test("an exact score with QA lint failure still gets a repair attempt", () => {
    const validation = rejectedValidation(violationsQaLint());
    const repairReasons = workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: validation });
    expect(validation.target?.exact).toBe(true);
    expect(shouldRequestWorkerRepairAfterAttempt({ repairReasons, dryRun: false, claimDeadlineMs: Date.now() + 60_000 })).toBe(true);
  });

  test("accepted attempts, expired claim deadlines, and dry-run attempts do not continue", () => {
    expect(shouldRequestWorkerRepairAfterAttempt({ repairReasons: [], dryRun: false, claimDeadlineMs: Date.now() + 60_000 })).toBe(false);
    expect(shouldRequestWorkerRepairAfterAttempt({ repairReasons: ["runner validation: failed"], dryRun: false, claimDeadlineMs: Date.now() - 1 })).toBe(false);
    expect(shouldRequestWorkerRepairAfterAttempt({ repairReasons: ["runner validation: failed"], dryRun: true, claimDeadlineMs: Date.now() + 60_000 })).toBe(false);
  });

  test("the basic repair gate stays open while the claim deadline is open", () => {
    expect(
      shouldRequestWorkerRepairAfterAttempt({
        repairReasons: ["runner validation: failed"],
        dryRun: false,
        claimDeadlineMs: Date.now() + 60_000,
      }),
    ).toBe(true);
  });
});

describe("workerContinuationDecision", () => {
  const futureDeadline = Date.now() + 60_000;

  test("a one-attempt rung stops after its first cold checkpoint", () => {
    const decision = workerContinuationDecision({
      attemptIndex: 0,
      checkpoints: [continuationCheckpoint(0)],
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      rungMaxAttempts: 1,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.exhausted).toBe(true);
    expect(decision.stopReason).toBe("rung_attempt_budget_exhausted");
    expect(decision.rungMaxAttempts).toBe(1);
  });

  test("a failed worker session never retries the same rung even when attempt budget and TTL remain", () => {
    const decision = workerContinuationDecision({
      attemptIndex: 0,
      checkpoints: [continuationCheckpoint(0)],
      repairReasons: ["write_set diff changed but runner validation was skipped"],
      dryRun: false,
      sessionFailed: true,
      rungMaxAttempts: 3,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.exhausted).toBe(true);
    expect(decision.stopReason).toBe("worker_session_failed");
  });

  test("the rung cap also bounds failed-gate exact repair", () => {
    const decision = workerContinuationDecision({
      attemptIndex: 0,
      checkpoints: [continuationCheckpoint(0, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 })],
      repairReasons: ["runner validation: qa lint failed"],
      dryRun: false,
      rungMaxAttempts: 1,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("rung_attempt_budget_exhausted");
  });

  test("a two-attempt rung allows exactly one repair", () => {
    const first = workerContinuationDecision({
      attemptIndex: 0,
      checkpoints: [continuationCheckpoint(0)],
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      rungMaxAttempts: 2,
      claimDeadlineMs: futureDeadline,
    });
    const second = workerContinuationDecision({
      attemptIndex: 1,
      checkpoints: [continuationCheckpoint(0), continuationCheckpoint(1)],
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      rungMaxAttempts: 2,
      claimDeadlineMs: futureDeadline,
    });

    expect(first.shouldContinue).toBe(true);
    expect(first.continueReason).toBe("cold_attempt_budget_available");
    expect(second.shouldContinue).toBe(false);
    expect(second.stopReason).toBe("rung_attempt_budget_exhausted");
  });

  test("stops cold workers after the configured human attempt budget when nothing improved", () => {
    const checkpoints = [0, 1, 2].map((attempt) => continuationCheckpoint(attempt));
    const decision = workerContinuationDecision({
      attemptIndex: 2,
      checkpoints,
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.exhausted).toBe(true);
    expect(decision.stopReason).toBe("cold_attempt_budget_exhausted");
    expect(decision.humanAttempt).toBe(WORKER_ATTEMPT_TAIL_POLICY.maxColdAttempts);
  });

  test("continues before the cold attempt budget is exhausted", () => {
    const checkpoints = [0, 1].map((attempt) => continuationCheckpoint(attempt));
    const decision = workerContinuationDecision({
      attemptIndex: 1,
      checkpoints,
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.continueReason).toBe("cold_attempt_budget_available");
  });

  test("allows a bounded follow-up checkpoint after an early selectable improvement", () => {
    const checkpoints = [
      continuationCheckpoint(0),
      continuationCheckpoint(1, { hardGatesPassed: true, selectable: true, newScore: 81 }),
      continuationCheckpoint(2, { hardGatesPassed: true, selectable: true, newScore: 80.5 }),
    ];
    const decision = workerContinuationDecision({
      attemptIndex: 2,
      checkpoints,
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.continueReason).toBe("post_improvement_followup");
    expect(decision.followUpsSinceBest).toBe(1);
  });

  test("stops after the configured follow-up budget without a new best", () => {
    const checkpoints = [
      continuationCheckpoint(0),
      continuationCheckpoint(1, { hardGatesPassed: true, selectable: true, newScore: 81 }),
      continuationCheckpoint(2, { hardGatesPassed: true, selectable: true, newScore: 80.5 }),
      continuationCheckpoint(3, { hardGatesPassed: true, selectable: true, newScore: 80.75 }),
    ];
    const decision = workerContinuationDecision({
      attemptIndex: 3,
      checkpoints,
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.exhausted).toBe(true);
    expect(decision.stopReason).toBe("improvement_followup_budget_exhausted");
    expect(decision.followUpsSinceBest).toBe(WORKER_ATTEMPT_TAIL_POLICY.followUpAttemptsAfterBest);
  });

  test("a new best resets the follow-up budget", () => {
    const checkpoints = [
      continuationCheckpoint(0),
      continuationCheckpoint(1, { hardGatesPassed: true, selectable: true, newScore: 81 }),
      continuationCheckpoint(2, { hardGatesPassed: true, selectable: true, newScore: 82 }),
      continuationCheckpoint(3, { hardGatesPassed: true, selectable: true, newScore: 81.5 }),
    ];
    const decision = workerContinuationDecision({
      attemptIndex: 3,
      checkpoints,
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.latestBestAttemptIndex).toBe(2);
    expect(decision.followUpsSinceBest).toBe(1);
  });

  test("accepted exact checkpoints stop immediately", () => {
    const decision = workerContinuationDecision({
      attemptIndex: 1,
      checkpoints: [continuationCheckpoint(1, { exactMatch: true, hardGatesPassed: true, selectable: true, newScore: 100 })],
      repairReasons: ["runner checkpoint was not exact"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("accepted_exact");
  });

  test("exact score with failed gates gets bounded gate repair after the cold budget", () => {
    const checkpoints = [
      continuationCheckpoint(0),
      continuationCheckpoint(1),
      continuationCheckpoint(2),
      continuationCheckpoint(3),
      continuationCheckpoint(4, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 }),
    ];
    const decision = workerContinuationDecision({
      attemptIndex: 4,
      checkpoints,
      repairReasons: ["runner validation: qa lint failed"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.continueReason).toBe("gate_failed_exact_repair");
  });

  test("A4: grants a second follow-up to recover a gate-failed exact before giving up", () => {
    // Budget raised 1 -> 2: after the exact-but-gate-failed checkpoint at attempt 4, a
    // follow-up at attempt 5 (followUps == 1 < 2) is still granted to recover the exact.
    const checkpoints = [
      continuationCheckpoint(4, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 }),
      continuationCheckpoint(5, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 }),
    ];
    const decision = workerContinuationDecision({
      attemptIndex: 5,
      checkpoints,
      repairReasons: ["runner validation: qa lint failed"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.continueReason).toBe("gate_failed_exact_repair");
  });

  test("A4: the extra gate-failed-exact follow-up is still bounded by the claim TTL", () => {
    const checkpoints = [continuationCheckpoint(4, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 })];
    const decision = workerContinuationDecision({
      attemptIndex: 5,
      checkpoints,
      repairReasons: ["runner validation: qa lint failed"],
      dryRun: false,
      claimDeadlineMs: Date.now() - 1, // claim deadline already passed
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe("claim_deadline");
  });

  test("failed-gate exact repair stops after the configured follow-up budget", () => {
    const checkpoints = [
      continuationCheckpoint(4, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 }),
      continuationCheckpoint(5, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 }),
      continuationCheckpoint(6, { exactMatch: true, hardGatesPassed: false, selectable: false, newScore: 100 }),
    ];
    const decision = workerContinuationDecision({
      attemptIndex: 6,
      checkpoints,
      repairReasons: ["runner validation: qa lint failed"],
      dryRun: false,
      claimDeadlineMs: futureDeadline,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.exhausted).toBe(true);
    expect(decision.stopReason).toBe("gate_failed_exact_followup_budget_exhausted");
    expect(decision.followUpsSinceFailedGateExact).toBe(WORKER_ATTEMPT_TAIL_POLICY.followUpAttemptsAfterGateFailedExact);
  });
});

describe("worker ladder failure escalation", () => {
  test("context-length return failure advances Spark to Sol when no checkpoint is validation-ready", () => {
    const result = { ...piResult(), providerError: "context_length_exceeded" };

    expect(workerSessionFailed(result)).toBe(true);
    const escalationReAdmitted = shouldReAdmitEscalatedWorker({
      escalationEnabled: true,
      ladder: escalationLadder(),
      escalationLevel: 0,
      lifecycleStatus: "error",
      summaryText: "LLM provider failed: context_length_exceeded",
      sessionFailed: workerSessionFailed(result),
      hasValidationReadyCheckpoint: false,
    });

    expect(escalationReAdmitted).toBe(true);
    expect(workerCycleIncidentFlags({ lifecycleStatus: "error", errorKind: "provider_error", escalationReAdmitted })).toEqual({
      failed: false,
      providerFailure: false,
    });
  });

  test("model-launch worker-session failure advances when a stronger rung exists", () => {
    const result = { ...piResult(), failed: true, error: "Pi model not found: openai-codex/gpt-missing" };

    expect(workerSessionFailed(result)).toBe(true);
    expect(
      shouldReAdmitEscalatedWorker({
        escalationEnabled: true,
        ladder: escalationLadder(),
        escalationLevel: 0,
        lifecycleStatus: "error",
        summaryText: result.error,
        sessionFailed: workerSessionFailed(result),
        hasValidationReadyCheckpoint: false,
      }),
    ).toBe(true);
  });

  test("the same failure is terminal on the final rung", () => {
    const result = { ...piResult(), providerError: "context_length_exceeded" };

    const escalationReAdmitted = shouldReAdmitEscalatedWorker({
      escalationEnabled: true,
      ladder: escalationLadder(),
      escalationLevel: 1,
      lifecycleStatus: "error",
      summaryText: result.providerError,
      sessionFailed: workerSessionFailed(result),
      hasValidationReadyCheckpoint: false,
    });

    expect(escalationReAdmitted).toBe(false);
    expect(workerCycleIncidentFlags({ lifecycleStatus: "error", errorKind: "provider_error", escalationReAdmitted })).toEqual({
      failed: false,
      providerFailure: true,
    });
  });

  test("a selectable validation checkpoint keeps a generic session failure terminal", () => {
    const result = { ...piResult(), failed: true, error: "worker session closed unexpectedly" };

    expect(
      shouldReAdmitEscalatedWorker({
        escalationEnabled: true,
        ladder: escalationLadder(),
        escalationLevel: 0,
        lifecycleStatus: "error",
        summaryText: result.error,
        sessionFailed: workerSessionFailed(result),
        hasValidationReadyCheckpoint: true,
      }),
    ).toBe(false);
  });
});

describe("classifyWorkerError with QA lint violations", () => {
  test("final-attempt violations classify as runner_validation_qa_lint_failed with the finding details", () => {
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "validation_ready" },
      runnerValidation: rejectedValidation(violationsQaLint()),
    });
    expect(classification).not.toBeNull();
    expect(classification?.kind).toBe("runner_validation_qa_lint_failed");
    expect(classification?.summary).toContain("QA lint rejected the attempt");
    expect(classification?.reasons.some((reason) => reason.startsWith("qa_lint_finding: error packed_string_blob"))).toBe(true);
  });

  test("warning findings also classify as runner_validation_qa_lint_failed", () => {
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "validation_ready" },
      runnerValidation: rejectedValidation(warningsQaLint()),
    });
    expect(classification?.kind).toBe("runner_validation_qa_lint_failed");
    expect(classification?.summary).toContain("1 QA finding(s) requiring repair");
    expect(classification?.reasons.some((reason) => reason.startsWith("qa_lint_finding: warning packed_string_blob"))).toBe(true);
  });

  test("the kind is a rework kind and routes to needs_rework, never the tool_error quarantine path", () => {
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "validation_ready" },
      runnerValidation: rejectedValidation(violationsQaLint()),
    });
    expect(classification?.kind).toBe("runner_validation_qa_lint_failed");
    expect(isReworkErrorKind("runner_validation_qa_lint_failed")).toBe(true);
  });

  test("tool_unavailable qaLint does not reject an otherwise passed attempt", () => {
    const qaLint: WorkerQaLint = { status: "tool_unavailable", exitCode: -1, findings: [], scanPath: null, toolError: "scan_diff.py not found" };
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "validation_ready" },
      runnerValidation: passedValidation(qaLint),
    });
    expect(classification).toBeNull();
  });

  test("agent-declared tool_error does not override runner-owned passed validation", () => {
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "tool_error", summary: "checkdiff failed locally" },
      runnerValidation: passedValidation(null),
    });
    expect(classification).toBeNull();
  });

  test("agent-declared tool_error is advisory only when runner validation is skipped", () => {
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "tool_error", summary: "checkdiff failed locally" },
      runnerValidation: { status: "skipped", reasons: ["runner checkpoint validation was not requested"], qaLint: null },
    });
    expect(classification?.kind).toBe("agent_noted_tool_error_advisory");
  });

  test("clean qaLint on a passed attempt produces no error classification", () => {
    const qaLint: WorkerQaLint = { status: "clean", exitCode: 0, findings: [], scanPath: "/tmp/attempt-0.qa_diff.patch", toolError: null };
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "validation_ready" },
      runnerValidation: passedValidation(qaLint),
    });
    expect(classification).toBeNull();
  });

  test("violations outrank the generic runner_validation_<status> kind", () => {
    const validation: WorkerChangeValidation = {
      status: "no_official_score_change",
      reasons: ["target did not improve", "qa lint found 1 QA finding(s) requiring repair (gate exit 1)"],
      qaLint: violationsQaLint(),
    };
    const classification = classifyWorkerError({
      result: piResult(),
      agentNote: { status: "validation_ready" },
      runnerValidation: validation,
    });
    expect(classification?.kind).toBe("runner_validation_qa_lint_failed");
    expect(classification?.reasons).toContain("target did not improve");
  });
});
