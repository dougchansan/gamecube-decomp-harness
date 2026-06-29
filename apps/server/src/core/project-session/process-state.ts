import { canonicalProcessName } from "./process-identity.js";
import type { ProjectSessionProcessState } from "./types.js";

export interface SessionProcessIdentityInput {
  command?: string[];
  endedAt?: string | null;
  graphDbPath?: string | null;
  name?: string | null;
  pid?: number | null;
  processFilePath?: string | null;
  projectId: string;
  repoRoot?: string | null;
  sessionUuid: string;
  startedAt?: string | null;
  state?: string | null;
  stateDir?: string | null;
  updatedAt?: string;
}

export function sessionProcessState(input: SessionProcessIdentityInput): ProjectSessionProcessState {
  const now = input.updatedAt ?? new Date().toISOString();
  const pid = typeof input.pid === "number" && Number.isFinite(input.pid) ? input.pid : null;
  const status = input.state === "running" || input.state === "draining" || input.state === "stopping" || input.state === "exited" || input.state === "idle" ? input.state : "unknown";
  return {
    process_name: canonicalProcessName(input.name),
    project_id: input.projectId,
    session_uuid: input.sessionUuid,
    status,
    pid,
    process_group: pid ? -pid : null,
    process_file_path: input.processFilePath ?? null,
    command: input.command ?? [],
    repo_root: input.repoRoot ?? null,
    state_dir: input.stateDir ?? null,
    graph_db_path: input.graphDbPath ?? null,
    started_at: input.startedAt ?? null,
    ended_at: input.endedAt ?? null,
    updated_at: now,
  };
}
