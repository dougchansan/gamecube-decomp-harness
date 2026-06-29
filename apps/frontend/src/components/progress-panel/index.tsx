import { Pill } from "@/components/primitives";
import { TimelineChart } from "@/components/progress-panel/_components/timeline-chart";
import { checkpointCountdown } from "@/components/progress-panel/_lib/checkpoint";
import { processPillState } from "@/lib/processView";
import type { Dashboard } from "@/lib/format";

export function ProgressPanel({
  dashboard,
}: {
  dashboard: Dashboard | null;
  streamState: string;
}) {
  const countdown = checkpointCountdown(dashboard);
  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <TimelineChart dashboard={dashboard} />
    </div>
  );
}
