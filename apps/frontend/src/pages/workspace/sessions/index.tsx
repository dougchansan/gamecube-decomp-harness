import { Archive, RefreshCw, RotateCcw } from "@/icons";
import { asObject, num } from "@/lib/format";
import { Button, PageHeader, PanelSection, PanelTitle } from "@/components/primitives";
import type { DashboardAction, SessionView, WorkspaceNav } from "@/pages/workspace/_lib/types";
import { ActiveSessionPage } from "@/pages/workspace/sessions/active/page";
import { SessionHistoryTable } from "@/pages/workspace/sessions/components/SessionHistoryTable";
import { activeSessionFocus } from "@/pages/workspace/sessions/_lib/sessionRoute";
import type { SessionsPageProps } from "@/pages/workspace/sessions/_lib/types";

export function SessionsPage(props: SessionsPageProps) {
  if (props.route.session === "active" || (props.route.session && props.route.session !== "new")) {
    return <ActiveSessionPage {...props} />;
  }
  return <SessionsIndexPage busy={props.busy} nav={props.nav} onAction={props.onAction} view={props.view} />;
}

function SessionsIndexPage({ busy, nav, onAction, view }: { busy: boolean; nav: WorkspaceNav; onAction: (action: DashboardAction) => void; view: SessionView }) {
  const savePoint = asObject(asObject(view.prSummary.ship).savePoint);
  const sessionFocus = activeSessionFocus(view);
  return (
    <>
      <PageHeader kicker={view.project?.displayName ?? "No project selected"} title="Sessions" />
      <div className="@container grid min-h-0 flex-1 content-start grid-cols-[minmax(300px,1fr)_minmax(0,1.6fr)] gap-4 overflow-auto p-4 max-[1180px]:grid-cols-1">
        <PanelSection>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <PanelTitle className="mb-0">Active Session</PanelTitle>
            <span className={`text-[11px] ${view.mode === "pr" ? "text-warn" : view.mode === "run" ? "text-up" : "text-dim"}`}>{view.modeLabel}</span>
          </div>
          <div className="grid gap-3">
            <div className="min-w-0">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-fg">{view.activeSessionLabel}</div>
              <div className="mt-1 text-xs text-dim">
                Phase: {view.canonicalPhase ? view.canonicalPhase.replace(/_/g, " ") : view.modeLabel}
                {view.canonicalSubphase ? ` / ${view.canonicalSubphase.replace(/_/g, " ")}` : ""}
                {" / "} branch {view.branchLabel}
                {" / "} claims {num(view.activeClaims)}
              </div>
              {view.newSessionBlocked ? (
                <div className="mt-2 text-xs text-warn">
                  New session blocked - {view.newSessionReasons.slice(0, 3).join("; ")}
                  {view.newSessionReasons.length > 3 ? " ..." : ""}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={<Archive size={13} />} onClick={() => nav.goToSession(sessionFocus, view.recommendedSub)} tone="primary" type="button">
                Open Session
              </Button>
              {view.process.running ? (
                <Button disabled={busy} icon={view.process.draining ? <RefreshCw size={13} /> : <Archive size={13} />} onClick={() => onAction("stop")} tone="warning" type="button">
                  {view.process.draining ? "Draining" : "Drain Run"}
                </Button>
              ) : null}
              {view.canCompleteRun ? (
                <Button disabled={busy} icon={<Archive size={13} />} onClick={() => onAction("completeRun")} title="Mark this idle legacy run complete; confirmation can override stale ship or QA blockers." tone="warning" type="button">
                  Close Session
                </Button>
              ) : null}
              <Button icon={<RotateCcw size={13} />} disabled={busy || view.newSessionBlocked} onClick={() => onAction("fresh")} title={view.newSessionBlocked ? view.newSessionReasons.join("; ") : "Checkpoint, reset baseline, and start a new session."} tone="warning" type="button">
                New Session
              </Button>
            </div>
          </div>
        </PanelSection>
        <PanelSection>
          <PanelTitle>Past Sessions</PanelTitle>
          <SessionHistoryTable savePoint={savePoint} view={view} />
        </PanelSection>
      </div>
    </>
  );
}
