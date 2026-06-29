import type { OperationRecord } from "@server/application/dashboard/operation-state";
import type { ManagedProcessController } from "@server/infrastructure/process-control/managed-process-controller";
import type { ResolvedProject } from "@server/core/project-registry";

type JsonObject = Record<string, unknown>;

export interface ProcessStatusService {
  processStatus: (stateDir?: string, project?: ResolvedProject | null) => JsonObject;
}

export interface ProcessStatusServiceDeps {
  defaultStateDir: string;
  getOperationSnapshot: () => OperationRecord | null;
  preparingState: () => { freshRunActive: boolean; projectSyncActive: boolean };
  processController: ManagedProcessController;
}

export function createProcessStatusService(deps: ProcessStatusServiceDeps): ProcessStatusService {
  function processStatus(stateDir = deps.defaultStateDir, project: ResolvedProject | null = null): JsonObject {
    const preparingState = deps.preparingState();
    return deps.processController.status({
      freshRunActive: preparingState.freshRunActive,
      operation: deps.getOperationSnapshot() as unknown as JsonObject | null,
      project,
      projectSyncActive: preparingState.projectSyncActive,
      stateDir,
    });
  }

  return { processStatus };
}
