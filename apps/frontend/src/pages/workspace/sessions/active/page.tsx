import {
  SESSION_PHASES,
  sessionStageForSubPage,
  type SessionSubPage,
} from "@/routing";
import { PageHeader, PhaseStepperBar } from "@/components/primitives";
import { activeSessionFocus } from "@/pages/workspace/sessions/_lib/sessionRoute";
import type { SessionsPageProps } from "@/pages/workspace/sessions/_lib/types";
import { PrModePage } from "@/pages/workspace/sessions/active/subphases/pr";
import { RunModePage } from "@/pages/workspace/sessions/active/subphases/run";
import { SessionHistoryPage } from "@/pages/workspace/sessions/active/subphases/history";
import { ActiveSessionSummary } from "@/pages/workspace/sessions/active/components/ActiveSessionSummary";
import { PrepareSubPage } from "@/pages/workspace/sessions/active/components/PrepareSubPage";
import { ReviewSubPage } from "@/pages/workspace/sessions/active/components/ReviewSubPage";
import { SessionRouteBar } from "@/pages/workspace/sessions/active/components/SessionRouteLink";

export function ActiveSessionPage(props: SessionsPageProps) {
  const sub = props.route.sessionSub ?? props.view.recommendedSub;
  const currentStage = sessionStageForSubPage(sub);
  const workflowStage = sessionStageForSubPage(props.view.recommendedSub);
  const sessionFocus = activeSessionFocus(props.view);
  return (
    <>
      <PageHeader
        kicker={props.view.project?.displayName ?? "No project selected"}
        title="Active Session"
      />
      <div className="@container grid min-h-0 flex-1 content-start gap-4 overflow-auto p-4">
        <PhaseStepperBar
          current={currentStage}
          onSelect={(stage) =>
            props.nav.goToSession(sessionFocus, stage as SessionSubPage)
          }
          phases={SESSION_PHASES.map((stage) => ({
            ...stage,
            state: props.view.sessionStageStates[stage.id],
          }))}
          workflowCurrent={workflowStage}
        />
        <ActiveSessionSubPage {...props} sub={sub} />
      </div>
    </>
  );
}

function ActiveSessionSubPage(
  props: SessionsPageProps & { sub: SessionSubPage },
) {
  if (props.sub === "run") {
    return (
      <RunModePage
        busy={props.busy}
        dashboard={props.dashboard}
        form={props.form}
        improvedMode={props.improvedMode}
        improvedPage={props.improvedPage}
        onAction={props.onAction}
        setForm={props.setForm}
        setImprovedMode={props.setImprovedMode}
        setImprovedPage={props.setImprovedPage}
        setWorkMode={props.setWorkMode}
        view={props.view}
        workMode={props.workMode}
      />
    );
  }
  if (props.sub === "pr") {
    return (
      <PrModePage
        busy={props.busy}
        dashboard={props.dashboard}
        onAction={props.onAction}
        onOpenPr={props.onOpenPr}
        onPrepareLocalPr={props.onPrepareLocalPr}
        onSetReviewState={props.onSetReviewState}
        view={props.view}
      />
    );
  }
  if (props.sub === "prepare")
    return (
      <PrepareSubPage
        busy={props.busy}
        form={props.form}
        onAction={props.onAction}
        setForm={props.setForm}
        view={props.view}
      />
    );
  if (props.sub === "review")
    return (
      <ReviewSubPage
        busy={props.busy}
        onSetReviewState={props.onSetReviewState}
        view={props.view}
      />
    );
  if (props.sub === "artifacts")
    return <SessionHistoryPage dashboard={props.dashboard} view={props.view} />;
  if (props.sub === "done")
    return <ActiveSessionSummary nav={props.nav} view={props.view} />;
  return <ActiveSessionSummary nav={props.nav} view={props.view} />;
}
