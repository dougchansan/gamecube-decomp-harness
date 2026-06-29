import { asArray, asObject, clock, num, pct, text, type Dashboard } from "@/lib/format";
import { EmptyState, InfoRows, PanelSection, PanelTitle } from "@/components/primitives";
import type { SessionView } from "@/pages/workspace/_lib/types";

export function SessionHistoryPage({ dashboard, view }: { dashboard: Dashboard | null; view: SessionView }) {
  const epochs = asArray(dashboard?.epochs).map(asObject).slice(-12).reverse();
  const savePoint = asObject(asObject(dashboard?.campaign).savePoint);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 @[760px]:grid-cols-2">
        <PanelSection>
          <PanelTitle>Latest Save Point</PanelTitle>
          <InfoRows
            rows={[
              ["Commit", text(savePoint.commit_sha, "-")],
              ["Trigger", text(savePoint.trigger_kind, "-")],
              ["Branch", text(savePoint.branch, view.branchLabel)],
              ["Matched", savePoint.matched_code_percent ? pct(savePoint.matched_code_percent) : "-"],
            ]}
          />
        </PanelSection>
        <PanelSection>
          <PanelTitle>PR Intake</PanelTitle>
          <InfoRows
            rows={[
              ["Tracked PRs", num(view.prRecords.length)],
              ["Unresolved", num(view.prRecords.filter((record) => !["merged", "closed"].includes(record.status)).length)],
              ["Upstream", Number.isFinite(view.prSummary.upstreamOpen) ? num(view.prSummary.upstreamOpen) : "unknown"],
              ["Gate", view.newSessionBlocked ? "blocked" : "clear", view.newSessionBlocked ? "text-warn" : "text-up"],
            ]}
          />
        </PanelSection>
      </div>
      <PanelSection>
        <PanelTitle>Epoch Checkpoints</PanelTitle>
        {epochs.length === 0 ? (
          <EmptyState>No epoch checkpoints recorded for the visible session.</EmptyState>
        ) : (
          <div className="overflow-hidden border border-line bg-card">
            {epochs.map((epoch) => (
              <div className="grid min-h-8 grid-cols-[160px_110px_minmax(0,1fr)] items-center gap-2 border-t border-line px-2.5 py-1.5 first:border-t-0 max-[780px]:grid-cols-1" key={text(epoch.id, text(epoch.createdAt))}>
                <span className="text-soft">{clock(epoch.createdAt)}</span>
                <span className="text-up">{pct(epoch.matchedCodePercent)}</span>
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-dim">{text(epoch.label, "epoch checkpoint")}</span>
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </div>
  );
}
