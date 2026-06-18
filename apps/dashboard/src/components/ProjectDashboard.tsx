import { ChevronRight, Plus, RefreshCw } from "lucide-react";
import { num, type Dashboard, type FormState, type ProjectSummary, type UiConfig } from "@decomp-orchestrator/ui-contract";
import { type AppRoute } from "../routing";
import { Button, PageHeader, PanelSection } from "./primitives";
import { deriveSessionView, type SessionView } from "./SessionWorkspace";

export interface ProjectDashboardProps {
  busy: boolean;
  config: UiConfig | null;
  dashboard: Dashboard | null;
  errorMessage: string;
  form: FormState;
  onAction: (action: "refresh") => void;
  onDismissError: () => void;
  onNavigate: (route: AppRoute) => void;
}

interface ProjectCardSummary {
  project: ProjectSummary;
  view?: SessionView;
}

function gateSummary(view: SessionView | undefined): string {
  if (!view) return "session state unavailable";
  const slices = view.prRecords.filter((record) => !["merged", "closed"].includes(record.status)).length;
  const local = view.prRecords.filter((record) => ["ready", "blocked", "dirty"].includes(record.localStatus) && !["merged", "closed"].includes(record.status)).length;
  if (view.mode === "pr") return `PR Mode · ${num(slices)} PR slice(s) unresolved, ${num(local)} workspace(s) unresolved`;
  if (view.mode === "run") return `Run Mode · ${num(view.activeLeases)} active lease(s)`;
  return "No active session";
}

export function ProjectDashboard(props: ProjectDashboardProps) {
  const available = props.config?.availableProjects ?? [];
  const selectedId = props.form.projectId || props.config?.defaultProjectId || available[0]?.id || "";
  // The dashboard payload is single-project today; only the selected project
  // gets a live active-session summary. Other registered projects render as
  // openable cards (the shape that will hold multiple projects later).
  const cards: ProjectCardSummary[] = available.map((project) => ({
    project,
    view: project.id === selectedId ? deriveSessionView(props.dashboard, props.config, props.form) : undefined,
  }));
  // Fall back to the payload project if no projects are registered.
  const fallback = props.dashboard?.project;
  if (cards.length === 0 && fallback) {
    cards.push({ project: fallback, view: deriveSessionView(props.dashboard, props.config, props.form) });
  }

  return (
    <section className="flex min-w-0 flex-col overflow-hidden bg-panel">
      {props.errorMessage ? (
        <div className="flex w-full shrink-0 items-start gap-2.5 border-b border-down/40 bg-down/10 px-3 py-1.5 text-xs text-down">
          <span className="min-w-0 flex-1 whitespace-normal break-words">{props.errorMessage}</span>
          <button className="shrink-0 text-down/80 hover:text-down" onClick={props.onDismissError} type="button">dismiss</button>
        </div>
      ) : null}
      <PageHeader kicker="Decomp Orchestrator" title="Projects" />
      <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 min-h-0 flex-1 overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-soft">
            Open a project to reach its workspace: overview, knowledge base, sessions, and settings. Today the orchestrator runs one project; the dashboard is ready for more.
          </p>
          <Button icon={<RefreshCw size={14} />} disabled={props.busy} onClick={() => props.onAction("refresh")} type="button">Refresh</Button>
        </div>
        <div className="grid gap-4">
          {cards.map((card) => (
            <ProjectCard
              key={card.project.id}
              summary={card}
              onOpen={() => props.onNavigate({ kind: "workspace", section: "overview", projectId: card.project.id })}
            />
          ))}
          <AddProjectCard />
        </div>
      </div>
    </section>
  );
}

function ProjectCard({ onOpen, summary }: { onOpen: () => void; summary: ProjectCardSummary }) {
  const { project, view } = summary;
  return (
    <PanelSection>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-dim">{project.kind || "project"}</div>
          <h3 className="m-0 mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-bold text-fg">{project.displayName}</h3>
        </div>
        {view ? (
          <span className={`shrink-0 text-[11px] uppercase tracking-[0.08em] ${view.mode === "pr" ? "text-warn" : view.mode === "run" ? "text-up" : "text-dim"}`}>
            {view.modeLabel}
          </span>
        ) : null}
      </div>
      <dl className="m-0 mt-3 grid gap-1.5">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-dim">Session</dt>
          <dd className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-soft">{view ? view.activeSessionLabel : "not loaded"}</dd>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-dim">Branch</dt>
          <dd className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-soft" title={view?.branchLabel}>{view?.branchLabel ?? project.baseRef}</dd>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-dim">Gate</dt>
          <dd className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-soft">{gateSummary(view)}</dd>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-dim">Process</dt>
          <dd className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-dim">{project.processName}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <Button className="w-full" icon={<ChevronRight size={13} />} onClick={onOpen} tone="primary" type="button">Open Project</Button>
      </div>
    </PanelSection>
  );
}

function AddProjectCard() {
  return (
    <button
      className="flex min-h-[180px] flex-col items-center justify-center gap-3 border border-dashed border-line2 bg-card p-4 text-center text-dim hover:border-faint hover:text-soft"
      title="Multiple-project descriptors are not editable from the UI yet."
      type="button"
    >
      <Plus size={20} />
      <span className="text-xs font-bold uppercase tracking-[0.12em]">Add Project</span>
      <span className="max-w-[16rem] text-[11px] leading-snug text-faint">
        Register a project descriptor under <code>projects/</code> to add it here. The dashboard lists every configured project automatically.
      </span>
    </button>
  );
}
