type JsonObject = Record<string, unknown>;
type JsonResponder = (data: unknown, init?: ResponseInit) => Response;

export interface ValidationApiRouteDeps {
  json: JsonResponder;
  runReportNow: (body: JsonObject) => Promise<unknown>;
}

export async function handleValidationApiRoute(req: Request, url: URL, deps: ValidationApiRouteDeps): Promise<Response | null> {
  if (url.pathname !== "/api/report/run" || req.method !== "POST") return null;
  const body = (await req.json().catch(() => ({}))) as JsonObject;
  return deps.json(await deps.runReportNow(body));
}
