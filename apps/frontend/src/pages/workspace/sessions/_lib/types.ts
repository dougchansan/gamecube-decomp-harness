import type { AppRoute } from "@/routing";
import type { Dashboard, FormState } from "@/lib/format";
import type { ImprovedMode, WorkMode } from "@/components/work-tables";
import type { DashboardAction, SessionView, WorkspaceNav } from "@/pages/workspace/_lib/types";

export interface SessionsPageProps {
  busy: boolean;
  dashboard: Dashboard | null;
  form: FormState;
  improvedMode: ImprovedMode;
  improvedPage: number;
  nav: WorkspaceNav;
  onAction: (action: DashboardAction) => void;
  onOpenPr: (branch: string) => void;
  onPrepareLocalPr: (branch: string) => void;
  onSetReviewState: (branch: string, subState: string) => void;
  route: Extract<AppRoute, { kind: "workspace" }>;
  setForm: (updates: Partial<FormState>) => void;
  setImprovedMode: (mode: ImprovedMode) => void;
  setImprovedPage: (page: number | ((page: number) => number)) => void;
  setWorkMode: (mode: WorkMode) => void;
  streamState: string;
  view: SessionView;
  workMode: WorkMode;
}
