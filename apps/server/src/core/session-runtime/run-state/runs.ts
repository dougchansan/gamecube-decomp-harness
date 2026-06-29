import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { RunProjectMetadata, RunRecord, RunStatus } from "@server/core/shared/types/index.js";
import { events, immediateTransaction, now, runs, type RunRow, type StateStore } from "@server/core/orchestrator-state";
import { insertEvent } from "./events.js";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function projectFromRow(row: RunRow): RunProjectMetadata | undefined {
  const project: RunProjectMetadata = {
    projectId: optionalString(row.projectId),
    projectKind: optionalString(row.projectKind),
    repoRoot: optionalString(row.projectRepoRoot),
    stateDir: optionalString(row.projectStateDir),
    graphDbPath: optionalString(row.projectGraphDb),
    descriptorPath: optionalString(row.projectDescriptorPath),
    localOverridePath: optionalString(row.projectLocalOverridePath),
  };
  return Object.values(project).some(Boolean) ? project : undefined;
}

function runFromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    goalKind: row.goalKind,
    goalValue: row.goalValue,
    desiredWorkers: row.desiredWorkers,
    status: row.status,
    createdAt: row.createdAt,
    project: projectFromRow(row),
  };
}

export function createRun(
  store: StateStore,
  goalKind: string,
  goalValue: number,
  desiredWorkers: number,
  project?: RunProjectMetadata,
): RunRecord {
  const run: RunRecord = {
    id: randomUUID(),
    goalKind,
    goalValue,
    desiredWorkers,
    status: "active",
    createdAt: now(),
    project: Object.values(project ?? {}).some(Boolean) ? project : undefined,
  };
  immediateTransaction(store.db, () => {
    store.orm
      .insert(runs)
      .values({
        id: run.id,
        goalKind: run.goalKind,
        goalValue: run.goalValue,
        desiredWorkers: run.desiredWorkers,
        status: run.status,
        createdAt: run.createdAt,
        projectId: run.project?.projectId ?? null,
        projectKind: run.project?.projectKind ?? null,
        projectRepoRoot: run.project?.repoRoot ?? null,
        projectStateDir: run.project?.stateDir ?? null,
        projectGraphDb: run.project?.graphDbPath ?? null,
        projectDescriptorPath: run.project?.descriptorPath ?? null,
        projectLocalOverridePath: run.project?.localOverridePath ?? null,
      })
      .run();
    insertEvent(store, run.id, "run_started", "runner", {
      desired_workers: desiredWorkers,
      goal_kind: goalKind,
      goal_value: goalValue,
      project: run.project ?? null,
    });
  });
  return run;
}

export function getLatestRun(store: StateStore): RunRecord | null {
  const row = store.orm.select().from(runs).orderBy(desc(runs.createdAt)).limit(1).get();
  if (!row) return null;
  return runFromRow(row);
}

export function getRun(store: StateStore, runId: string): RunRecord | null {
  const row = store.orm.select().from(runs).where(eq(runs.id, runId)).get();
  return row ? runFromRow(row) : null;
}

export function setRunDesiredWorkers(store: StateStore, runId: string, desiredWorkers: number, producer = "operator"): RunRecord {
  const run = getRun(store, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const next = Math.max(1, Math.trunc(desiredWorkers));
  if (run.desiredWorkers === next) return run;
  immediateTransaction(store.db, () => {
    const changedAt = now();
    store.orm.update(runs).set({ desiredWorkers: next }).where(eq(runs.id, runId)).run();
    store.orm
      .insert(events)
      .values({
        id: randomUUID(),
        runId,
        eventType: "run_desired_workers_changed",
        producer,
        payloadJson: {
          previous_desired_workers: run.desiredWorkers,
          desired_workers: next,
        },
        handledAt: changedAt,
        createdAt: changedAt,
      })
      .run();
  });
  return { ...run, desiredWorkers: next };
}

export function updateRunStatus(store: StateStore, runId: string, status: RunStatus, producer = "operator"): RunRecord {
  const run = getRun(store, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status === status) return run;
  immediateTransaction(store.db, () => {
    const changedAt = now();
    store.orm.update(runs).set({ status }).where(eq(runs.id, runId)).run();
    store.orm
      .insert(events)
      .values({
        id: randomUUID(),
        runId,
        eventType: "run_status_changed",
        producer,
        payloadJson: {
          previous_status: run.status,
          status,
        },
        handledAt: changedAt,
        createdAt: changedAt,
      })
      .run();
  });
  return { ...run, status };
}
