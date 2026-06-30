import type { Dashboard, RunDetails } from "@/lib/format";

export type DetailsTab = "logs" | "run";

export interface DetailsRailProps {
  collapsed: boolean;
  dashboard: Dashboard | null;
  loadRunDetails: () => void;
  loadingRunDetails: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onResizeEnd: () => void;
  onResizeStart: () => void;
  onWidthChange: (width: number) => void;
  runDetails: RunDetails | null;
  tabRequest?: { nonce: number; tab: DetailsTab } | null;
}

export type RunDetailsControls = Pick<DetailsRailProps, "loadRunDetails" | "loadingRunDetails" | "runDetails">;
export type RunTabProps = Pick<DetailsRailProps, "dashboard" | "loadRunDetails" | "loadingRunDetails" | "runDetails">;
