import { handleProjectSessionCommand, type ProjectSessionCommand } from "@server/core/session-runtime";
import { openState } from "@server/core/orchestrator-state";

type JsonResponder = (data: unknown, init?: ResponseInit) => Response;

interface ProjectSessionRoutePaths {
  project?: unknown;
  stateDir: string;
}

export interface ProjectSessionApiRouteDeps {
  baseRefForProject: (project: unknown) => string;
  json: JsonResponder;
  projectIdForProject: (project: unknown) => string;
  requestPaths: (url: URL, options: { useDefaultProject?: boolean }) => ProjectSessionRoutePaths;
  submitSessionStartedTrace?: (
    paths: ProjectSessionRoutePaths,
    session: {
      baseRef: string | null;
      baseSha: string | null;
      projectId: string;
      sessionUuid: string;
    },
  ) => Promise<unknown> | unknown;
}

async function requestBody(req: Request): Promise<Record<string, unknown>> {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function routeCommand(method: string, pathname: string): ProjectSessionCommand | null {
  if (pathname === "/api/project-session" && method === "GET") return "read";
  if (pathname === "/api/project-session/new" && method === "POST") return "create";
  if (pathname === "/api/project-session/preparing/subphase" && method === "POST") return "update-preparing-subphase";
  if (pathname === "/api/project-session/preparing/complete" && method === "POST") return "mark-preparing-complete";
  if (pathname === "/api/project-session/start-running" && method === "POST") return "start-running";
  if (pathname === "/api/project-session/running/subphase" && method === "POST") return "update-running-subphase";
  if (pathname === "/api/project-session/running/stop" && method === "POST") return "stop-running";
  if ((pathname === "/api/project-session/enter-pr" || pathname === "/api/project-session/force-pr") && method === "POST") return "enter-pr";
  if (pathname === "/api/project-session/pr/final-build" && method === "POST") return "finish-pr-final-build";
  if (pathname === "/api/project-session/pr/subphase" && method === "POST") return "update-pr-subphase";
  if (pathname === "/api/project-session/pr/publish" && method === "POST") return "publish-pr";
  if (pathname === "/api/project-session/pr/complete" && method === "POST") return "mark-pr-complete";
  if (pathname === "/api/project-session/complete" && method === "POST") return "complete";
  return null;
}

export async function handleProjectSessionApiRoute(req: Request, url: URL, deps: ProjectSessionApiRouteDeps): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/project-session")) return null;

  const paths = deps.requestPaths(url, { useDefaultProject: true });
  const projectId = text(url.searchParams.get("projectId")) || deps.projectIdForProject(paths.project);
  if (!projectId) return deps.json({ error: "Project id is required for project-session state" }, { status: 400 });

  const command = routeCommand(req.method, url.pathname);
  if (!command) return deps.json({ error: "not found" }, { status: 404 });

  const body = await requestBody(req);
  const store = openState(paths.stateDir);
  let result: ReturnType<typeof handleProjectSessionCommand>;
  try {
    result = handleProjectSessionCommand(store.db, command, {
      projectId,
      body,
      baseRef: deps.baseRefForProject(paths.project),
      force: url.pathname.endsWith("/force-pr"),
    });
  } finally {
    store.db.close();
  }

  if (command === "create" && !result.status) {
    const session = asObject(asObject(result.payload).projectSession);
    const sessionUuid = text(session.sessionUuid);
    if (sessionUuid) {
      await deps.submitSessionStartedTrace?.(paths, {
        baseRef: text(session.baseRef) || null,
        baseSha: text(session.baseSha) || null,
        projectId,
        sessionUuid,
      });
    }
  }

  return deps.json(result.payload, result.status ? { status: result.status } : undefined);
}
