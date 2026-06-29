import { describe, expect, test } from "bun:test";
import { QA_LINT_REPAIR_INSTRUCTION, type WorkerChangeValidation, type WorkerQaLint } from "@server/core/agent-catalog/agents/running/worker/change-validation";
import type { QaScanFinding } from "@server/core/validation/qa";
import type { PiRunResult } from "@server/core/shared/types";
import {
  classifyWorkerError,
  isReworkErrorKind,
  workerAttemptRepairReasons,
  workerWorktreePath,
} from "@server/core/session-runtime/phases/running/workers/worker-cycle.js";

function finding(overrides: Partial<QaScanFinding> = {}): QaScanFinding {
  return {
    rule_id: "packed_string_blob",
    severity: "error",
    file: "src/melee/mn/mncount.c",
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

function rejectedValidation(qaLint: WorkerQaLint): WorkerChangeValidation {
  // What applyQaLintToValidation produces from a score-improving attempt with violations.
  return {
    status: "failed",
    reasons: [`qa lint found 1 QA finding(s) requiring repair (gate exit ${qaLint.exitCode ?? "unknown"})`],
    target: { unit: "melee/mn/mncount.c", symbol: "mnCount_803EE888", before: 80, after: 99.999999, improved: true, exact: true },
    qaLint,
  };
}

function passedValidation(qaLint: WorkerQaLint | null): WorkerChangeValidation {
  return {
    status: "passed",
    reasons: [],
    target: { unit: "melee/mn/mncount.c", symbol: "mnCount_803EE888", before: 80, after: 99.999999, improved: true, exact: true },
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

describe("workerAttemptRepairReasons", () => {
  test("violations append one verbatim qa_lint_finding reason per finding plus the instruction", () => {
    const validation = rejectedValidation(violationsQaLint());
    const reasons = workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: validation });
    expect(reasons).toContain(
      'qa_lint_finding: error packed_string_blob at src/melee/mn/mncount.c:782 — hand-packed string blob [standard: global_standard:literals-and-data-ownership] excerpt: static char lbl_803EE888[0x18] = "a\\0b";',
    );
    expect(reasons[reasons.length - 1]).toBe(QA_LINT_REPAIR_INSTRUCTION);
    // The runner-validation summary reason also rides along (status is failed).
    expect(reasons.some((reason) => reason.startsWith("runner validation: qa lint found"))).toBe(true);
  });

  test("warnings append repair reasons too", () => {
    const validation = rejectedValidation(warningsQaLint());
    const reasons = workerAttemptRepairReasons({ writeSetDiffChanged: true, runnerValidation: validation });
    expect(reasons).toContain(
      'qa_lint_finding: warning packed_string_blob at src/melee/mn/mncount.c:782 — hand-packed string blob [standard: global_standard:literals-and-data-ownership] excerpt: static char lbl_803EE888[0x18] = "a\\0b";',
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
