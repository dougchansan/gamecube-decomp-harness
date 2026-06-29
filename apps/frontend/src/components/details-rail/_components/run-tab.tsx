import { asObject } from "@/lib/format";

import { RailDetails } from "./rail-details";
import { RunDetailsPanel } from "./run-details-panel";
import { WorkerStates } from "./worker-reports";
import type { RunTabProps } from "../_lib/types";

export function RunTab({ dashboard, loadRunDetails, loadingRunDetails, runDetails }: RunTabProps) {
  const run = asObject(dashboard?.status?.run);
  if (!run.id) {
    return <div className="p-3 text-dim">No active run</div>;
  }

  return (
    <>
      <RailDetails open summary="Worker States">
        <WorkerStates dashboard={dashboard} loadRunDetails={loadRunDetails} loadingRunDetails={loadingRunDetails} runDetails={runDetails} />
      </RailDetails>
      <RailDetails summary="Full Run" onToggle={(open) => open && !runDetails && loadRunDetails()}>
        <RunDetailsPanel loadRunDetails={loadRunDetails} loadingRunDetails={loadingRunDetails} runDetails={runDetails} />
      </RailDetails>
    </>
  );
}
