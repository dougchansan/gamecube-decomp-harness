import { forceReportRun, recordReportRunDashboardArtifacts } from "@server/core/validation/report";
import { getLatestRun, openState } from "@server/core/session-runtime/run-state";
import { booleanArg, type GlobalArgs } from "@server/core/project-registry/runtime-options.js";

export async function reportRun(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const resetBaseline = booleanArg(args, "--reset-baseline");
  const result = await forceReportRun(globals.repoRoot, {
    changesTarget: globals.project?.validation.qaTarget,
    reportChangesPath: globals.project?.validation.reportChangesPath,
    reportPath: globals.project?.validation.reportPath,
    resetBaseline,
  });
  const store = openState(globals.stateDir);
  try {
    const run = getLatestRun(store);
    await recordReportRunDashboardArtifacts(store, {
      result,
      runId: run?.id ?? null,
      projectId: globals.project?.projectId ?? globals.projectId ?? null,
      boardKey: resetBaseline ? "baseline" : "current",
      trustedReportKey: "current",
    });
  } finally {
    store.db.close();
  }
  console.log(
    JSON.stringify(
      {
        ...result,
        steps: result.steps.map((step) => ({
          name: step.name,
          command: step.command,
          exitCode: step.exitCode,
        })),
      },
      null,
      2,
    ),
  );
}
