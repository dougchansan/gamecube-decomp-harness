import { useEffect } from "react";
import {
  FunctionTokensPanel,
  FuzzyBandPanel,
  ModelBenchmarkPanel,
  PermuterFarmPanel,
  ProgressOverTimePanel,
  ProgressPanel,
} from "./components/progress-panel";
import {
  type ImprovedMode,
  type WorkMode,
  WorkTables,
} from "./components/work-tables";
import { RunLaneSwitcher } from "./components/RunLaneSwitcher";
import { asObject, type ActiveRunLane, type Dashboard, type FormState } from "@/lib/format";
import { useLaneDashboard } from "@/hooks/useLaneDashboard";
import type {
  DashboardAction,
  SessionView,
} from "@/pages/workspace/_lib/types";

// Poll cadence for the secondary (non-primary) lane dashboard fetch. Slower
// than the primary SSE stream (2.5s) since this only feeds observability
// panels, never session-lifecycle action bodies.
const LANE_DASHBOARD_POLL_MS = 5_000;

function pickDefaultLane(activeRuns: ActiveRunLane[]): string | undefined {
  return (activeRuns.find((run) => run.laneKind === "near-miss") ?? activeRuns[0])?.runId;
}

export function RunModePage(props: {
  activeRunId: string | undefined;
  busy: boolean;
  dashboard: Dashboard | null;
  form: FormState;
  improvedMode: ImprovedMode;
  improvedPage: number;
  onAction: (action: DashboardAction) => void;
  onEpochBreak: (runId: string) => void;
  onSelectRun: (runId: string | undefined) => void;
  setForm: (updates: Partial<FormState>) => void;
  setImprovedMode: (mode: ImprovedMode) => void;
  setImprovedPage: (page: number | ((page: number) => number)) => void;
  setWorkMode: (mode: WorkMode) => void;
  view: SessionView;
  workMode: WorkMode;
}) {
  const activeRuns = props.dashboard?.activeRuns ?? [];
  const primaryRunId = String(asObject(props.dashboard?.status?.run).id || "");
  const selectedRunId = props.activeRunId;

  // Default to the near-miss (non-from-scratch) lane if one is running, else
  // the most recently created lane. Only fires once: after this, selectedRunId
  // is set (and persisted in the URL), so this effect no longer applies.
  useEffect(() => {
    if (selectedRunId || activeRuns.length === 0) return;
    const defaultRunId = pickDefaultLane(activeRuns);
    if (defaultRunId) props.onSelectRun(defaultRunId);
  }, [activeRuns, selectedRunId]);

  const laneRunId = selectedRunId && selectedRunId !== primaryRunId ? selectedRunId : null;
  const { dashboard: laneDashboard } = useLaneDashboard({
    enabled: Boolean(laneRunId),
    form: props.form,
    intervalMs: LANE_DASHBOARD_POLL_MS,
    runId: laneRunId,
  });
  const effectiveDashboard = laneRunId ? (laneDashboard ?? props.dashboard) : props.dashboard;

  return (
    <div className="grid gap-4">
      <RunLaneSwitcher
        activeEpoch={effectiveDashboard?.activeEpoch}
        activeRuns={activeRuns}
        busy={props.busy}
        onEpochBreak={() => props.onEpochBreak(selectedRunId || primaryRunId)}
        onSelectRun={props.onSelectRun}
        selectedRunId={selectedRunId || primaryRunId || undefined}
      />
      <ProgressPanel dashboard={effectiveDashboard} />
      <ProgressOverTimePanel dashboard={effectiveDashboard} />
      <FuzzyBandPanel dashboard={effectiveDashboard} />
      <ModelBenchmarkPanel dashboard={effectiveDashboard} />
      <FunctionTokensPanel dashboard={effectiveDashboard} />
      <PermuterFarmPanel dashboard={effectiveDashboard} />
      <WorkTables
        dashboard={effectiveDashboard}
        improvedMode={props.improvedMode}
        improvedPage={props.improvedPage}
        setImprovedMode={props.setImprovedMode}
        setImprovedPage={props.setImprovedPage}
        setWorkMode={props.setWorkMode}
        workMode={props.workMode}
      />
    </div>
  );
}
