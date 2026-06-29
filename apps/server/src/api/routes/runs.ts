type JsonObject = Record<string, unknown>;
type JsonResponder = (data: unknown, init?: ResponseInit) => Response;

export interface RunsApiRouteDeps {
  completeRun: (body: JsonObject) => Promise<unknown>;
  freshRun: (body: JsonObject) => Promise<unknown>;
  initRun: (body: JsonObject) => Promise<unknown>;
  json: JsonResponder;
}

async function requestBody(req: Request): Promise<JsonObject> {
  return (await req.json().catch(() => ({}))) as JsonObject;
}

export async function handleRunsApiRoute(req: Request, url: URL, deps: RunsApiRouteDeps): Promise<Response | null> {
  if (req.method !== "POST") return null;
  if (url.pathname === "/api/run/complete") return deps.json(await deps.completeRun(await requestBody(req)));
  if (url.pathname === "/api/run/init") return deps.json(await deps.initRun(await requestBody(req)));
  if (url.pathname === "/api/run/fresh") return deps.json(await deps.freshRun(await requestBody(req)));
  return null;
}
