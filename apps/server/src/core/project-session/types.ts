export type ProjectSessionStatus = "idle" | "active" | "blocked" | "complete";
export type ProjectSessionPhase = "preparing" | "running" | "pr" | "complete";
export type PhaseLifecycleStatus = "pending" | "active" | "complete" | "blocked";

export type PreparingSubphase = "config" | "sync_intake" | "processing_prs" | "knowledge_refresh" | "baseline" | "ready" | "other";
export type RunningSubphase = "candidate_list" | "graph_rebuild" | "epoch_build" | "workers" | "checkpoint" | "draining" | "other";
export type PrSubphase = "final_build" | "qa" | "qa_fixes" | "split" | "prepare_prs" | "publish" | "review" | "intake" | "other";
export type CompleteSubphase = "settled" | "other";

export type PhaseSubphase = PreparingSubphase | RunningSubphase | PrSubphase | CompleteSubphase;
export type RunningStopReason = "hit_100_percent" | "manual_stop" | "error" | "other";
export type ManualStopMode = "finish_epoch" | "hard_stop";

export interface ProjectSessionBlocker {
  code: string;
  message: string;
  source?: string;
  severity?: "info" | "warning" | "error";
}

export interface PhaseStateEnvelope<TSubphase extends string = string> {
  status: PhaseLifecycleStatus;
  subphase: TSubphase;
  subphase_detail?: string;
  started_at: string | null;
  completed_at: string | null;
  blockers: ProjectSessionBlocker[];
}

export interface PreparingPhaseState extends PhaseStateEnvelope<PreparingSubphase> {
  completion?: Record<string, unknown>;
  config?: Record<string, unknown>;
  sync?: Record<string, unknown>;
  intake?: Record<string, unknown>;
  knowledge?: Record<string, unknown>;
  baseline?: Record<string, unknown>;
  worker_config?: Record<string, unknown>;
}

export interface RunningPhaseState extends PhaseStateEnvelope<RunningSubphase> {
  stop_reason?: RunningStopReason;
  manual_stop_mode?: ManualStopMode;
  completion?: Record<string, unknown>;
  candidate_list?: Record<string, unknown>;
  graph?: Record<string, unknown>;
  epoch?: Record<string, unknown>;
  workers?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
}

export interface PrPhaseStepState {
  status?: PhaseLifecycleStatus;
  started_at?: string | null;
  completed_at?: string | null;
  [key: string]: unknown;
}

export interface PrPhaseState extends PhaseStateEnvelope<PrSubphase> {
  completion?: Record<string, unknown>;
  final_build?: PrPhaseStepState;
  final_score?: Record<string, unknown>;
  qa?: Record<string, unknown>;
  qa_fixes?: Record<string, unknown>;
  split?: Record<string, unknown>;
  prs?: Record<string, unknown>;
  review?: Record<string, unknown>;
}

export interface CompletePhaseState extends PhaseStateEnvelope<CompleteSubphase> {
  completed_reason?: string;
  completed_by?: string;
  final_save_point?: Record<string, unknown>;
  settled_pr_counts?: Record<string, unknown>;
}

export interface ProjectSessionProcessState {
  process_name: string;
  project_id: string;
  session_uuid: string;
  status: "idle" | "running" | "draining" | "stopping" | "exited" | "unknown";
  pid?: number | null;
  process_group?: number | null;
  process_file_path?: string | null;
  command?: string[];
  repo_root?: string | null;
  state_dir?: string | null;
  graph_db_path?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  updated_at: string;
  [key: string]: unknown;
}

export interface ProjectSessionKernelTraceState {
  session_uuid: string;
  app_session_id: string;
  root_container_id?: string | null;
  active_container_id?: string | null;
  trace_url?: string | null;
  [key: string]: unknown;
}

export interface ProjectSessionRecord {
  id: string;
  project_id: string;
  session_uuid: string;
  status: ProjectSessionStatus;
  phase: ProjectSessionPhase;
  active_run_id: string | null;
  base_ref: string | null;
  base_sha: string | null;
  preparing_state_json: PreparingPhaseState;
  running_state_json: RunningPhaseState;
  pr_state_json: PrPhaseState;
  complete_state_json: CompletePhaseState;
  process_state_json: ProjectSessionProcessState | null;
  kernel_trace_json: ProjectSessionKernelTraceState | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProjectSessionGates {
  can_start_workers: boolean;
  can_prepare_prs: boolean;
  can_publish_prs: boolean;
  can_mark_complete: boolean;
  can_start_next: boolean;
  force_to_pr_available: boolean;
}

export interface ProjectSessionView {
  id: string;
  projectId: string;
  sessionUuid: string;
  status: ProjectSessionStatus;
  phase: ProjectSessionPhase;
  activeSubphase: PhaseSubphase;
  activeSubphaseDetail: string | null;
  activeRunId: string | null;
  baseRef: string | null;
  baseSha: string | null;
  phases: {
    preparing: PreparingPhaseState;
    running: RunningPhaseState;
    pr: PrPhaseState;
    complete: CompletePhaseState;
  };
  process: ProjectSessionProcessState | null;
  kernelTrace: ProjectSessionKernelTraceState | null;
  gates: ProjectSessionGates;
  blockers: ProjectSessionBlocker[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateProjectSessionInput {
  projectId: string;
  baseRef?: string | null;
  baseSha?: string | null;
  activeRunId?: string | null;
  now?: string;
  sessionUuid?: string;
  id?: string;
}

export interface ProjectSessionPatch {
  status?: ProjectSessionStatus;
  phase?: ProjectSessionPhase;
  active_run_id?: string | null;
  base_ref?: string | null;
  base_sha?: string | null;
  preparing_state_json?: PreparingPhaseState;
  running_state_json?: RunningPhaseState;
  pr_state_json?: PrPhaseState;
  complete_state_json?: CompletePhaseState;
  process_state_json?: ProjectSessionProcessState | null;
  kernel_trace_json?: ProjectSessionKernelTraceState | null;
  completed_at?: string | null;
}
