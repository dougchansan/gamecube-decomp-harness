import { Link2 } from "@/icons";
import type { SessionSubPage } from "@/routing";
import type { SessionView, WorkspaceNav } from "@/pages/workspace/_lib/types";
import { activeSessionFocus } from "@/pages/workspace/sessions/_lib/sessionRoute";

export function SessionRouteLink({
  nav,
  sub,
  view,
}: {
  nav: WorkspaceNav;
  sub?: SessionSubPage;
  view: SessionView;
}) {
  const focus = activeSessionFocus(view);
  return (
    <button
      className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-accent underline-offset-2 hover:underline"
      onClick={() => nav.goToSession(focus, sub)}
      title={`Open /sessions/${encodeURIComponent(focus)}${sub ? `/${sub}` : ""}`}
      type="button"
    >
      <Link2 size={12} />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{focus}</span>
    </button>
  );
}

export function SessionRouteBar({
  nav,
  sub,
  view,
}: {
  nav: WorkspaceNav;
  sub: SessionSubPage;
  view: SessionView;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border border-line bg-card px-3 py-2 text-xs text-dim">
      <span className="font-bold uppercase tracking-[0.1em]">Session</span>
      <SessionRouteLink nav={nav} sub={sub} view={view} />
      <span className="text-faint">/</span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft">{view.activeSessionLabel}</span>
      {view.canonicalPhase ? (
        <>
          <span className="text-faint">/</span>
          <span className="text-dim">{view.canonicalPhase.replace(/_/g, " ")}</span>
        </>
      ) : null}
    </div>
  );
}
