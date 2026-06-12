import { asObject, text, type Dashboard } from "@decomp-orchestrator/ui-contract";

export type PhaseKey = "sync" | "init" | "run" | "validate" | "ship" | "resync";

export interface PhaseStep {
  key: PhaseKey;
  label: string;
  state: "done" | "current" | "todo";
  tag: string;
  locked: boolean;
}

export interface PhaseModel {
  current: PhaseKey;
  steps: PhaseStep[];
  hint: string;
  syncLockReason: string | null;
}

const PHASE_ORDER: Array<{ key: PhaseKey; label: string }> = [
  { key: "sync", label: "Sync & Intake" },
  { key: "init", label: "Baseline & Init" },
  { key: "run", label: "Run" },
  { key: "validate", label: "Checkpoint & Validate" },
  { key: "ship", label: "Ship PRs" },
  { key: "resync", label: "Resync" },
];

/**
 * Derive the operating phase from durable dashboard state. No new state is
 * stored: run status, lease count, process liveness, and handoff artifacts
 * fully determine the position in the session cycle.
 */
export function derivePhaseModel(dashboard: Dashboard | null, processRunning: boolean): PhaseModel {
  const status = asObject(dashboard?.status);
  const run = asObject(status.run);
  const runStatus = text(run.status);
  const hasRun = Boolean(run.id);
  const activeLeases = Number(status.activeLeases || 0);
  const proc = asObject(dashboard?.process);
  const syncActive = proc.projectSyncActive === true;
  const handoff = asObject(dashboard?.handoff);
  const checkpoint = asObject(handoff.checkpoint);
  const qa = asObject(handoff.qa);
  const qaStatus = text(asObject(qa.prPromotion).status, text(qa.status));
  const splitPlan = asObject(handoff.splitPlan);
  const splitPlanDone = Boolean(splitPlan.outputPath) || text(splitPlan.status) === "passed";

  let current: PhaseKey;
  let hint: string;
  const tags = new Map<PhaseKey, string>();

  if (syncActive) {
    current = "sync";
    hint = "Syncing upstream, intaking merged PRs, and rebuilding knowledge...";
    tags.set("sync", "running");
  } else if (!hasRun || runStatus === "complete" || runStatus === "failed") {
    current = "sync";
    hint = "Sync upstream first, then init a run from the fresh baseline.";
    tags.set("sync", "intake open");
  } else if (runStatus === "active") {
    current = "run";
    hint = processRunning ? "Workers are driving the board. Sync and handoff prep are locked; pause intake to stop work first." : "Run is active but stopped — start workers or prepare handoff.";
    tags.set("run", processRunning ? "workers active" : "stopped");
  } else if (qaStatus === "pr_ready" && splitPlanDone) {
    current = "ship";
    hint = "QA is pr_ready and the split plan is written. Ship the PR slices, then resync.";
    tags.set("ship", "operator");
    tags.set("validate", "pr_ready");
  } else {
    current = "validate";
    if (activeLeases > 0) {
      hint = `Draining: ${activeLeases} lease(s) still active. Handoff unlocks at 0.`;
      tags.set("validate", `${activeLeases} leases`);
    } else if (qaStatus === "blocked") {
      hint = "QA is blocked by regressions. Run the reconcile agent, then re-run QA.";
      tags.set("validate", "QA blocked");
    } else if (checkpoint.id) {
      hint = "Checkpoint written. Run QA, then plan PR slices.";
      tags.set("validate", `${text(qaStatus, "QA next")}`);
    } else {
      hint = "Run is paused. Checkpoint the work, then validate.";
      tags.set("validate", "drained");
    }
  }

  const currentIndex = PHASE_ORDER.findIndex((phase) => phase.key === current);
  const runActive = runStatus === "active";
  const syncLockReason = runActive
    ? "Hard-locked while the run is active: pulling upstream would invalidate the baseline all worker evidence is measured against. Pause intake or finish handoff first."
    : processRunning
      ? "Stop the managed process before syncing."
      : null;

  const steps = PHASE_ORDER.map((phase, index) => {
    const locked = (phase.key === "sync" && index > currentIndex && Boolean(syncLockReason)) || (phase.key === "resync" && runActive);
    return {
      key: phase.key,
      label: phase.label,
      state: index < currentIndex ? ("done" as const) : index === currentIndex ? ("current" as const) : ("todo" as const),
      tag: tags.get(phase.key) ?? (index < currentIndex ? "done" : locked ? "locked" : ""),
      locked,
    };
  });

  return { current, steps, hint, syncLockReason };
}

export function PhaseStepper({ model }: { model: PhaseModel }) {
  return (
    <div className="border-b border-line2 bg-raised px-3 py-2.5">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-dim">Session Phase</div>
      <ol className="m-0 grid list-none gap-1 p-0">
        {model.steps.map((step, index) => (
          <li
            className={`grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 text-xs ${
              step.state === "current" ? "font-bold text-fg" : step.state === "done" ? "text-soft" : "text-dim"
            }`}
            key={step.key}
          >
            <span
              className={`grid h-3.5 w-3.5 place-items-center rounded-full border text-[8px] ${
                step.state === "done" ? "border-up bg-up text-ink" : step.state === "current" ? "border-fg bg-fg text-ink" : "border-line2"
              }`}
            >
              {step.state === "done" ? "✓" : index + 1}
            </span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{step.label}</span>
            <span className={`text-[9px] uppercase tracking-[0.08em] ${step.locked ? "text-warn" : step.state === "current" ? "text-fg" : "text-dim"}`}>
              {step.locked ? "locked" : step.tag}
            </span>
          </li>
        ))}
      </ol>
      {model.hint ? <div className="mt-2 border-t border-line pt-1.5 text-[11px] leading-snug text-soft">{model.hint}</div> : null}
    </div>
  );
}
