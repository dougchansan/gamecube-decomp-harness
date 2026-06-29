import {
  runFreshStep,
  serverJobPrefix,
  type FreshRunStep,
  type JsonObject,
  type PreparingRuntimeDeps,
  type PreparingRuntimeProjectContext,
} from "../runtime-shared.js";

export function knowledgeGraphRefreshCommand(deps: PreparingRuntimeDeps, paths: PreparingRuntimeProjectContext): string[] {
  return [
    ...serverJobPrefix(paths, deps.serverJobPath),
    "kg-maintain",
    "--graph-db",
    paths.graphDbPath,
    "--no-pr-index",
    "--no-tool-runners",
    "--no-tool-index",
  ];
}

export async function refreshKnowledgeForPrepare(
  deps: PreparingRuntimeDeps,
  steps: FreshRunStep[],
  paths: PreparingRuntimeProjectContext,
): Promise<JsonObject> {
  deps.operationStep("refresh knowledge");
  await runFreshStep(
    deps,
    steps,
    "refresh knowledge",
    knowledgeGraphRefreshCommand(deps, paths),
    deps.packageRoot,
  );
  const step = steps.at(-1);
  return step ? { ...step } : {};
}
