import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleProjectSessionApiRoute } from "./routes.js";

let tempDirs: string[] = [];

function tempStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "project-session-api-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs = [];
});

function deps(
  stateDir: string,
  overrides: Partial<Parameters<typeof handleProjectSessionApiRoute>[2]> = {},
) {
  return {
    baseRefForProject: () => "origin/master",
    json: (data: unknown, init?: ResponseInit) => Response.json(data, init),
    projectIdForProject: () => "melee",
    requestPaths: () => ({ project: { projectId: "melee", baseRef: "origin/master" }, stateDir }),
    ...overrides,
  };
}

async function routeJson(
  stateDir: string,
  path: string,
  init: RequestInit = {},
  overrides: Partial<Parameters<typeof handleProjectSessionApiRoute>[2]> = {},
): Promise<{ data: Record<string, unknown>; response: Response }> {
  const request = new Request(`http://localhost${path}`, init);
  const response = await handleProjectSessionApiRoute(request, new URL(request.url), deps(stateDir, overrides));
  if (!response) throw new Error(`No response for ${path}`);
  return { data: (await response.json()) as Record<string, unknown>, response };
}

describe("project session API routes", () => {
  test("creates and projects canonical session state", async () => {
    const stateDir = tempStateDir();
    const empty = await routeJson(stateDir, "/api/project-session?projectId=melee");
    expect(empty.response.status).toBe(200);
    expect(empty.data.projectSession).toBeNull();

    const created = await routeJson(stateDir, "/api/project-session/new?projectId=melee", { method: "POST" });
    const projectSession = created.data.projectSession as Record<string, unknown>;
    expect(created.response.status).toBe(200);
    expect(projectSession.phase).toBe("preparing");
    expect(projectSession.activeSubphase).toBe("config");

    const prepared = await routeJson(stateDir, "/api/project-session/preparing/complete?projectId=melee", {
      method: "POST",
      body: JSON.stringify({ activeRunId: "run-1" }),
    });
    expect((prepared.data.projectSession as Record<string, unknown>).activeRunId).toBe("run-1");
    expect(((prepared.data.projectSession as Record<string, unknown>).gates as Record<string, unknown>).can_start_workers).toBe(true);

    const running = await routeJson(stateDir, "/api/project-session/start-running?projectId=melee", { method: "POST" });
    expect((running.data.projectSession as Record<string, unknown>).phase).toBe("running");
  });

  test("accepts bare UUID sessionId selectors from dashboard actions", async () => {
    const stateDir = tempStateDir();
    const created = await routeJson(stateDir, "/api/project-session/new?projectId=melee", { method: "POST" });
    const sessionUuid = String((created.data.projectSession as Record<string, unknown>).sessionUuid);

    const prepared = await routeJson(stateDir, "/api/project-session/preparing/complete?projectId=melee", {
      method: "POST",
      body: JSON.stringify({ sessionId: sessionUuid, activeRunId: "run-from-session-id" }),
    });

    const projectSession = prepared.data.projectSession as Record<string, unknown>;
    expect(projectSession.sessionUuid).toBe(sessionUuid);
    expect(projectSession.activeRunId).toBe("run-from-session-id");
    expect(projectSession.activeSubphase).toBe("ready");
  });

  test("emits session started trace hook after creation", async () => {
    const stateDir = tempStateDir();
    const calls: unknown[] = [];

    const created = await routeJson(
      stateDir,
      "/api/project-session/new?projectId=melee",
      { method: "POST" },
      {
        submitSessionStartedTrace: (_paths, session) => calls.push(session),
      },
    );

    const projectSession = created.data.projectSession as Record<string, unknown>;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      baseRef: "origin/master",
      projectId: "melee",
      sessionUuid: projectSession.sessionUuid,
    });
  });

  test("rejects duplicate active session creation without emitting a new trace hook", async () => {
    const stateDir = tempStateDir();
    const calls: unknown[] = [];
    const overrides = {
      submitSessionStartedTrace: (_paths: unknown, session: unknown) => calls.push(session),
    };

    const created = await routeJson(
      stateDir,
      "/api/project-session/new?projectId=melee",
      { method: "POST" },
      overrides,
    );
    const firstSession = created.data.projectSession as Record<string, unknown>;

    const duplicate = await routeJson(
      stateDir,
      "/api/project-session/new?projectId=melee",
      { method: "POST" },
      overrides,
    );
    const duplicateSession = duplicate.data.projectSession as Record<string, unknown>;

    expect(duplicate.response.status).toBe(409);
    expect(duplicate.data.error).toBe("An active project session already exists");
    expect(duplicateSession.sessionUuid).toBe(firstSession.sessionUuid);
    expect(calls).toHaveLength(1);
  });
});
