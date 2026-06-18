// Project workspace routing. The orchestrator UI is project-centered: a top
// Project Dashboard holds project cards, each card opens a Project Workspace
// (Overview / Knowledge / Sessions / Settings), and the active session is a
// nested surface inside Sessions with its own phase sub-navigation.
//
// The route is encoded in the URL search params so deep links and reloads keep
// the operator where they were:
//   ?view=dashboard                                  -> project dashboard
//   ?view=workspace&section=overview
//   ?view=workspace&section=standards&std=edit
//   ?view=workspace&section=knowledge
//   ?view=workspace&section=sessions&session=active&sub=run
//   ?view=workspace&section=settings
//
// Legacy ?page=<old> values map onto the new structure so existing bookmarks
// and deep links keep working during the redesign rollout.

export type WorkspaceSection = "overview" | "standards" | "knowledge" | "sessions" | "settings";
export type StandardsView = "edit" | "rendered";
export type SessionSubPage = "summary" | "prepare" | "run" | "pr" | "review" | "artifacts";
// "active" points at the single active session; a run id opens a past session.
export type SessionFocus = "active" | "new" | string;

export type AppRoute =
  | { kind: "dashboard" }
  | { kind: "workspace"; section: WorkspaceSection; projectId?: string; standardsView?: StandardsView; session?: SessionFocus; sessionSub?: SessionSubPage };

export const WORKSPACE_SECTIONS: ReadonlyArray<{ id: WorkspaceSection; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Active session, PR gate, readiness, and next action." },
  { id: "standards", label: "Standards", description: "Inspect decomp standards, QA coverage, examples, and rendered prompt XML." },
  { id: "knowledge", label: "Knowledge", description: "Knowledge graph sources and graph health." },
  { id: "sessions", label: "Sessions", description: "Active session, run/PR phases, and history." },
  { id: "settings", label: "Settings", description: "Project paths, overrides, and validation defaults." },
];

export const STANDARDS_VIEWS: ReadonlyArray<{ id: StandardsView; label: string }> = [
  { id: "edit", label: "Editor" },
  { id: "rendered", label: "Rendered" },
];

export const SESSION_SUBPAGES: ReadonlyArray<{ id: SessionSubPage; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "prepare", label: "Prepare" },
  { id: "run", label: "Run" },
  { id: "pr", label: "PR Queue" },
  { id: "review", label: "Review" },
  { id: "artifacts", label: "Artifacts" },
];

// The active-session phase stepper. It reflects status and workflow
// orientation, not the top-level app navigation.
export const SESSION_PHASES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "prepare", label: "Prepare" },
  { id: "run", label: "Run" },
  { id: "pr", label: "PR" },
  { id: "review", label: "Review" },
  { id: "close", label: "Close" },
];

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return WORKSPACE_SECTIONS.some((section) => section.id === value);
}

export function isStandardsView(value: string | null): value is StandardsView {
  return STANDARDS_VIEWS.some((view) => view.id === value);
}

export function isSessionSubPage(value: string | null): value is SessionSubPage {
  return SESSION_SUBPAGES.some((sub) => sub.id === value);
}

// Map the pre-redesign peer tabs onto the new nested structure.
function routeFromLegacyPage(page: string | null): AppRoute | null {
  switch (page ?? "") {
    case "project":
      return { kind: "workspace", section: "overview" };
    case "access":
      return { kind: "workspace", section: "settings" };
    case "session":
      return { kind: "workspace", section: "sessions", session: "active", sessionSub: "summary" };
    case "run":
      return { kind: "workspace", section: "sessions", session: "active", sessionSub: "run" };
    case "pr":
      return { kind: "workspace", section: "sessions", session: "active", sessionSub: "pr" };
    case "history":
      return { kind: "workspace", section: "sessions", session: "active", sessionSub: "artifacts" };
    default:
      return null;
  }
}

export function routeFromUrl(): AppRoute {
  try {
    const params = new URLSearchParams(window.location.search);
    const legacy = routeFromLegacyPage(params.get("page"));
    if (legacy) return legacy;
    const view = params.get("view");
    if (view !== "workspace") return { kind: "dashboard" };
    const rawSection: WorkspaceSection = isWorkspaceSection(params.get("section")) ? (params.get("section") as WorkspaceSection) : "overview";
    // Legacy: the old Knowledge section had kb=standards|graph sub-tabs. Map
    // kb=standards onto the new split Standards section so existing bookmarks
    // and deep links keep working during the redesign rollout.
    const section: WorkspaceSection = rawSection === "knowledge" && params.get("kb") === "standards" ? "standards" : rawSection;
    return {
      kind: "workspace",
      section,
      projectId: params.get("projectId") || undefined,
      standardsView: section === "standards" && isStandardsView(params.get("std")) ? (params.get("std") as StandardsView) : "edit",
      session: params.get("session") || "active",
      sessionSub: isSessionSubPage(params.get("sub")) ? (params.get("sub") as SessionSubPage) : undefined,
    };
  } catch {
    return { kind: "dashboard" };
  }
}

export function routeToUrl(route: AppRoute): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (route.kind === "dashboard") {
    url.searchParams.set("view", "dashboard");
  } else {
    url.searchParams.set("view", "workspace");
    url.searchParams.set("section", route.section);
    if (route.projectId) url.searchParams.set("projectId", route.projectId);
    if (route.section === "standards" && route.standardsView) url.searchParams.set("std", route.standardsView);
    if (route.section === "sessions") {
      if (route.session) url.searchParams.set("session", route.session);
      if (route.sessionSub) url.searchParams.set("sub", route.sessionSub);
    }
  }
  return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

export function saveRoute(route: AppRoute): void {
  try {
    window.history.replaceState(null, "", routeToUrl(route));
  } catch {
    // Navigation still works if history is unavailable.
  }
}
