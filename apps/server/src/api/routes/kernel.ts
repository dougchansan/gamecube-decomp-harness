type JsonResponder = (data: unknown, init?: ResponseInit) => Response;

export interface KernelApiRouteDeps {
  json: JsonResponder;
  kernelReadApiResponse: (req: Request) => Promise<Response>;
  kernelRuntimeRequired: boolean;
  kernelStatus: () => Promise<{ configured?: boolean; error?: unknown } & Record<string, unknown>>;
}

export async function handleKernelApiRoute(url: URL, deps: KernelApiRouteDeps): Promise<Response | null> {
  if (url.pathname !== "/api/kernel/status") return null;
  const status = await deps.kernelStatus();
  const unavailable = status.configured === false || Boolean(status.error);
  return deps.json(status, { status: unavailable && deps.kernelRuntimeRequired ? 503 : 200 });
}

export async function handleKernelReadRoute(req: Request, url: URL, deps: Pick<KernelApiRouteDeps, "kernelReadApiResponse">): Promise<Response | null> {
  if (url.pathname !== "/kernel" && !url.pathname.startsWith("/kernel/")) return null;
  return deps.kernelReadApiResponse(req);
}
