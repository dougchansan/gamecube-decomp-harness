export type JsonObject = Record<string, unknown>;

export interface ProjectSummary {
  id: string;
  displayName: string;
  kind: string;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
  processName: string;
  baseRef: string;
  descriptorPath: string;
  localOverridePath?: string;
  repoRootExists: boolean;
  stateDirExists: boolean;
  graphDbExists: boolean;
}

export interface UiConfig {
  defaultRepoRoot: string;
  defaultStateDir: string;
  defaultGraphDbPath: string;
  defaultProjectId: string;
  selectedProject: ProjectSummary | null;
  availableProjects: ProjectSummary[];
  projectDefaults: JsonObject | null;
  dashboardStreamIntervalMs: number;
  hotReload: boolean;
  port: number;
}

export interface FormState {
  projectId: string;
  usePathOverrides: boolean;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
  processName: string;
  maxWorkers: number;
  idleSleepMs: number;
  candidateLimit: number;
  queueTargetSize: number;
  queueLowWatermark: number;
  candidateWindow: number;
  epochSize: string;
  epochReadyQueueSize: number;
  agentTimeoutSeconds: number;
  fastKgMaintenanceEnabled: boolean;
  fastKgMaintenanceIntervalMs: number;
  fastKgMaintenanceReportCount: number;
  fullKgMaintenanceMode: string;
  goalValue: number;
  provider: string;
  model: string;
  thinkingLevel: string;
  workerThinkingLevel: string;
}

export interface Dashboard {
  project: ProjectSummary | null;
  projectSession?: JsonObject | null;
  projectWarnings?: string[];
  repoRoot: string;
  stateDir: string;
  graphDbPath?: string;
  usePathOverrides?: boolean;
  status: JsonObject;
  initial: JsonObject;
  current: JsonObject;
  trustedReport: JsonObject;
  checkpoint?: JsonObject | null;
  handoff?: JsonObject | null;
  runSummary: JsonObject;
  improvements: JsonObject[];
  improvedFiles: JsonObject[];
  activeFiles: JsonObject[];
  epochTargets: JsonObject[];
  workerStates: JsonObject[];
  progressWorkerStates: JsonObject[];
  touchedFiles: JsonObject[];
  events: JsonObject[];
  process: JsonObject;
  campaign?: JsonObject | null;
  epochs?: JsonObject[];
  /** Closed worker states since the last epoch checkpoint vs the checkpoint interval. */
  checkpointProgress?: JsonObject | null;
  prs?: JsonObject | null;
  /** Telemetry (Track B): per-model leaderboard rollup. */
  modelBenchmark?: JsonObject | null;
  /** Telemetry (Track B): per-agent-invocation token/cost sessions. */
  piSessions?: JsonObject[];
  /** Telemetry (Track B): dense match-over-time snapshots. */
  reportSnapshots?: JsonObject[];
  /** Observability: fuzzy-match distribution bucketed from the build report. */
  fuzzyBands?: JsonObject | null;
  /** Observability: per-function token/cost usage for the active run. */
  functionTokens?: JsonObject[];
  /** Observability: permuter-farm summary + active permutations. */
  permuterFarms?: JsonObject | null;
  /** Observability: top electricity cost per function across both permuter farms. */
  functionCost?: JsonObject[];
  /** Escalation ladder: rungs actually exercised by this run, in rung order. */
  ladderRungs?: LadderRung[];
}

/** One rung of the escalation ladder (kimi -> glm -> codex -> gpt-5.5 -> sonnet -> gpt-5.5 xhigh -> sol). */
export interface LadderRung {
  level: number;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  label: string;
}

export interface RunDetails {
  project?: ProjectSummary | null;
  stateDir: string;
  runId: string;
  generatedAt?: string;
  summary?: JsonObject;
  timeline?: JsonObject[];
  workerStates?: JsonObject[];
  events?: JsonObject[];
  sessions?: JsonObject[];
  /** Telemetry (Track B): per-model leaderboard rollup. */
  modelBenchmark?: JsonObject | null;
  /** Telemetry (Track B): dense match-over-time snapshots. */
  reportSnapshots?: JsonObject[];
  directorCycles?: JsonObject[];
  targetClaims?: JsonObject[];
  epochTargets?: JsonObject[];
  improvements?: JsonObject[];
  improvedFiles?: JsonObject[];
  knowledgeIntake?: JsonObject;
}

export type PromptPreviewAgentId =
  | "worker"
  | "integration-resolver"
  | "pr-indexer"
  | "pr-reviewer"
  | "pr-fixer"
  | "pr-splitter"
  | "knowledge-curator"
  | "reconcile"
  | "qa-repair";
export type PromptPreviewSource = "latest" | "sample";

export interface PromptPreviewStats {
  tokens: number;
  unresolvedPlaceholders: string[];
}

export interface PromptPreview {
  agent: PromptPreviewAgentId;
  requestedSource: PromptPreviewSource;
  contextSource: PromptPreviewSource;
  generatedAt: string;
  project: ProjectSummary | null;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
  systemPrompt: string;
  userPrompt: string;
  systemTemplatePath: string;
  userTemplatePath: string;
  systemStats: PromptPreviewStats;
  userStats: PromptPreviewStats;
  context: JsonObject;
  warnings: string[];
}

/** A durable decomp standard record loaded from the decomp_standards source. */
export interface StandardRecord {
  id: string;
  title: string;
  summary: string[];
  status: string;
  family?: string;
  disposition?: string;
  severity?: string;
  qaEnforcement?: string;
  workerFacing?: boolean;
  retiredInto?: string;
  qaRuleIds?: string[];
  examplePolicy?: string;
  preferredRepairs?: string[];
  do: string[];
  doNot: string[];
  evidenceRefs: string[];
}

/** A targeted repair/review example tied to a standard and optional QA rule. */
export interface StandardExampleRecord {
  id: string;
  standardId: string;
  qaRuleId?: string | null;
  severity: string;
  badPattern: string;
  preferredShape: string;
  description: string[];
  evidenceRef?: string;
}

/** Source/tool inventory surfaced by the Knowledge Base. */
export interface KnowledgeInventory {
  globalSources: string[];
  projectSources: string[];
  roots?: {
    projectKnowledgeRoot?: string;
    sourcesRoot?: string;
    resourceGraphRoot?: string;
    graphDbPath?: string;
  };
  validation: JsonObject;
  pr: JsonObject;
}

/** Payload returned by GET /api/standards for the Knowledge Base surface. */
export interface StandardsPayload {
  project: ProjectSummary | null;
  sourcePath: string;
  examplesPath?: string;
  records: StandardRecord[];
  examples: StandardExampleRecord[];
  /** Rendered <decomp_standards> XML as worker/QA prompts see it. */
  effectiveXml: string;
  /** The structured context object the knowledge package exposes. */
  context: JsonObject;
  inventory: KnowledgeInventory;
  warnings: string[];
}
