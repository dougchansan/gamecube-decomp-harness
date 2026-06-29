type JsonObject = Record<string, unknown>;
type JsonResponder = (data: unknown, init?: ResponseInit) => Response;

export interface KnowledgeApiRouteDeps {
  applyStandardEdit: (edit: unknown, project: unknown) => unknown;
  json: JsonResponder;
  loadStandardsPayload: (project: unknown) => unknown;
  requestPaths: (url: URL, options: { useDefaultProject?: boolean }) => { project?: unknown };
}

export async function handleKnowledgeApiRoute(req: Request, url: URL, deps: KnowledgeApiRouteDeps): Promise<Response | null> {
  if (url.pathname !== "/api/standards") return null;
  const paths = deps.requestPaths(url, { useDefaultProject: true });
  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as JsonObject;
    return deps.json(deps.applyStandardEdit((body.edit ?? {}) as unknown, paths.project ?? null));
  }
  return deps.json(deps.loadStandardsPayload(paths.project ?? null));
}
