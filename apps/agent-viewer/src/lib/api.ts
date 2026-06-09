import type { JsonObject, PromptPreview, PromptPreviewAgentId, PromptPreviewSource, ProjectSummary, UiConfig } from "@decomp-orchestrator/ui-contract";

export interface AgentViewerForm {
  projectId: string;
  usePathOverrides: boolean;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
}

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = (await response.json()) as JsonObject;
  if (!response.ok) throw new Error(String(data.error || response.statusText));
  return data as T;
}

export function agentViewerParams(form: Pick<AgentViewerForm, "projectId" | "usePathOverrides" | "repoRoot" | "stateDir" | "graphDbPath">): URLSearchParams {
  const params = new URLSearchParams();
  if (form.projectId) params.set("projectId", form.projectId);
  if (form.usePathOverrides) {
    params.set("usePathOverrides", "true");
    params.set("repoRoot", form.repoRoot);
    params.set("stateDir", form.stateDir);
    params.set("graphDbPath", form.graphDbPath);
  }
  return params;
}

export function loadConfig(): Promise<UiConfig> {
  return fetchJson<UiConfig>("/api/config");
}

export function fetchPromptPreview(
  form: Pick<AgentViewerForm, "projectId" | "usePathOverrides" | "repoRoot" | "stateDir" | "graphDbPath">,
  agent: PromptPreviewAgentId,
  source: PromptPreviewSource,
): Promise<PromptPreview> {
  return fetchJson<PromptPreview>(`/api/agents/render?${new URLSearchParams({ ...Object.fromEntries(agentViewerParams(form)), agent, source })}`);
}

export function projectOptionLabel(project: ProjectSummary): string {
  return project.displayName || project.id;
}
