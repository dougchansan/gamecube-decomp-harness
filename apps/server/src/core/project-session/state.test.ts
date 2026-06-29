import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { openState } from "@server/core/orchestrator-state";
import { projectSessions } from "@server/core/orchestrator-state/storage/schema";
import { projectSessionView } from "@server/core/project-session";
import { sessionProcessState } from "@server/core/project-session/process-state";
import {
  assertNoTopLevelSubphase,
  createProjectSession,
  getActiveProjectSession,
  getProjectSessionBySelector,
  updateProjectSession,
} from "@server/core/project-session/store";
import { ensureSchema } from "@server/core/orchestrator-state/storage/ddl";

let tempDirs: string[] = [];

function openTestDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "project-session-state-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "state.sqlite"));
  ensureSchema(db);
  return { db, dir };
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs = [];
});

describe("project session durable state", () => {
  test("openState exposes typed Drizzle ORM over the legacy SQLite handle", () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestrator-state-"));
    tempDirs.push(dir);
    const store = openState(dir);
    try {
      const record = createProjectSession(store.db, {
        projectId: "melee",
        sessionUuid: "typed-session",
        id: "project-session:typed-session",
      });
      const row = store.orm
        .select()
        .from(projectSessions)
        .where(eq(projectSessions.id, record.id))
        .get();

      expect(row?.sessionUuid).toBe("typed-session");
      expect(row?.projectId).toBe("melee");
    } finally {
      store.db.close();
    }
  });

  test("creates a canonical row with phase-local subphase storage and derived activeSubphase", () => {
    const { db } = openTestDb();
    const record = createProjectSession(db, {
      projectId: "melee",
      baseRef: "origin/master",
      baseSha: "abc123",
      now: "2026-06-25T12:00:00.000Z",
      sessionUuid: "session-uuid",
      id: "project-session:session-uuid",
    });

    expect(record.project_id).toBe("melee");
    expect(record.phase).toBe("preparing");
    expect(record.preparing_state_json.subphase).toBe("config");
    expect(record.running_state_json.subphase).toBe("candidate_list");
    expect(record.pr_state_json.subphase).toBe("final_build");
    expect(record.kernel_trace_json?.app_session_id).toBe("project-session:session-uuid");
    expect(projectSessionView(record).activeSubphase).toBe("config");
    expect(() => assertNoTopLevelSubphase(record)).not.toThrow();
    db.close();
  });

  test("enforces one active project session per project", () => {
    const { db } = openTestDb();
    createProjectSession(db, { projectId: "melee", sessionUuid: "one", id: "project-session:one" });

    expect(() => createProjectSession(db, { projectId: "melee", sessionUuid: "two", id: "project-session:two" })).toThrow();
    expect(() => createProjectSession(db, { projectId: "other", sessionUuid: "three", id: "project-session:three" })).not.toThrow();
    db.close();
  });

  test("falls back from row id selector to session UUID selector", () => {
    const { db } = openTestDb();
    const record = createProjectSession(db, {
      projectId: "melee",
      sessionUuid: "session-uuid",
      id: "project-session:session-uuid",
    });

    const selected = getProjectSessionBySelector(db, {
      id: "session-uuid",
      sessionUuid: "session-uuid",
      projectId: "melee",
    });

    expect(selected?.id).toBe(record.id);
    db.close();
  });

  test("persists process recovery identity for melee-live", () => {
    const { db } = openTestDb();
    const record = createProjectSession(db, {
      projectId: "melee",
      sessionUuid: "session-uuid",
      id: "project-session:session-uuid",
    });
    const processState = sessionProcessState({
      command: ["bun", "apps/server/src/job-runner.ts", "babysit"],
      graphDbPath: "/tmp/graph.sqlite",
      name: "melee-live",
      pid: 1234,
      processFilePath: "/tmp/melee-live.json",
      projectId: "melee",
      repoRoot: "/repo",
      sessionUuid: record.session_uuid,
      startedAt: "2026-06-25T12:00:00.000Z",
      state: "running",
      stateDir: "/state",
      updatedAt: "2026-06-25T12:00:10.000Z",
    });

    const saved = updateProjectSession(db, record.id, { process_state_json: processState });
    const active = getActiveProjectSession(db, "melee");
    expect(active?.process_state_json?.process_name).toBe("melee-live");
    expect(active?.process_state_json?.project_id).toBe("melee");
    expect(active?.process_state_json?.session_uuid).toBe("session-uuid");
    expect(active?.process_state_json?.process_group).toBe(-1234);
    expect(projectSessionView(saved).process?.process_file_path).toBe("/tmp/melee-live.json");
    db.close();
  });
});
