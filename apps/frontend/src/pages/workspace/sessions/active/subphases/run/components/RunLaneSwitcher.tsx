import { Save } from "@/icons";
import { pct, shortId } from "@/lib/format";
import type { ActiveEpochSummary, ActiveRunLane } from "@/lib/api-types";
import { Button, PanelHeader } from "@/components/primitives";

const LANE_LABELS: Record<ActiveRunLane["laneKind"], string> = {
  "from-scratch": "from-scratch",
  "near-miss": "near-miss",
  unknown: "lane",
};

function laneTitle(run: ActiveRunLane): string {
  const matched = run.matchedPercent === null ? "n/a" : pct(run.matchedPercent);
  return `${LANE_LABELS[run.laneKind]} · run ${shortId(run.runId)}\n${run.activeWorkers} active workers · matched ${matched}${run.epochOrdinal ? ` · epoch ${run.epochOrdinal}` : ""}`;
}

/**
 * Compact tab row for switching between concurrently-running babysit lanes
 * (e.g. a near-miss repair run and a from-scratch recovery run share the same
 * orchestrator sqlite). Selecting a pill re-scopes the run view's dashboard to
 * that run's workers/ladder/trace without touching which run session-lifecycle
 * actions (start/stop/checkpoint) target.
 */
export function RunLaneSwitcher(props: {
  activeEpoch: ActiveEpochSummary | null | undefined;
  activeRuns: ActiveRunLane[];
  busy: boolean;
  onEpochBreak: () => void;
  onSelectRun: (runId: string) => void;
  selectedRunId: string | undefined;
}) {
  const { activeEpoch, activeRuns, busy, onEpochBreak, onSelectRun, selectedRunId } = props;
  const epochBreakDisabled = busy || !activeEpoch;
  const epochBreakLabel = activeEpoch?.breakRequested ? "Break pending…" : "Epoch break";
  const epochBreakTitle = !activeEpoch
    ? "No open epoch for this run."
    : activeEpoch.breakRequested
      ? `Already requested at ${activeEpoch.breakRequestedAt ?? "?"}; the running babysit loop will close it at its next cycle.`
      : `Force-close epoch ${activeEpoch.ordinal} now (${activeEpoch.remaining} targets remaining, ${activeEpoch.claimed} claimed) and commit accumulated matched work.`;

  return (
    <PanelHeader
      right={
        <Button disabled={epochBreakDisabled} icon={<Save size={13} />} onClick={onEpochBreak} title={epochBreakTitle} tone={activeEpoch?.breakRequested ? "warning" : "default"} type="button">
          {epochBreakLabel}
        </Button>
      }
      title={
        activeRuns.length === 0 ? (
          "Run"
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {activeRuns.map((run) => {
              const selected = run.runId === selectedRunId;
              return (
                <button
                  className={`inline-flex items-center gap-1.5 rounded-none border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${
                    selected ? "border-up/50 bg-up/10 text-up" : "border-line2 bg-raised text-soft hover:border-faint hover:text-fg"
                  }`}
                  key={run.runId}
                  onClick={() => onSelectRun(run.runId)}
                  title={laneTitle(run)}
                  type="button"
                >
                  <span>{LANE_LABELS[run.laneKind]}</span>
                  <span className="text-dim">{shortId(run.runId)}</span>
                  <span className="text-dim">·</span>
                  <span>{run.activeWorkers}w</span>
                  {run.matchedPercent !== null ? <span className="text-dim">{pct(run.matchedPercent)}</span> : null}
                </button>
              );
            })}
          </div>
        )
      }
    />
  );
}
