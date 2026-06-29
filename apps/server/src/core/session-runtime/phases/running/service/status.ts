import { projectToSummary } from "@server/core/project-registry";
import { openState, statusSnapshot } from "@server/core/session-runtime/run-state";
import type { GlobalArgs } from "@server/core/project-registry/runtime-options.js";

export async function status(globals: GlobalArgs): Promise<void> {
  const store = openState(globals.stateDir);
  try {
    const snapshot = statusSnapshot(store);
    const project = globals.project ? projectToSummary(globals.project) : undefined;
    console.log(JSON.stringify(project ? { project, projectWarnings: globals.project?.warnings ?? [], ...snapshot } : snapshot, null, 2));
  } finally {
    store.db.close();
  }
}
