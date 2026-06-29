export interface WorkerRunnerValidation {
  status:
    | "passed"
    | "failed"
    | "skipped"
    | "build_failed"
    | "snapshot_unavailable"
    | "no_official_score_change"
    | "target_regressed"
    | "same_unit_regression";
  reasons: string[];
  command?: string;
  exitCode?: number;
  summaryPath?: string;
  baselinePath?: string;
  reportPath?: string;
  diffPath?: string;
  objectTarget?: string;
  stdoutPath?: string;
  stderrPath?: string;
  target?: {
    unit: string;
    symbol: string;
    before: number | null;
    after: number | null;
    improved: boolean;
    exact: boolean;
  };
  regressions?: Array<{
    kind: "unit" | "function" | "section";
    unit: string;
    item: string;
    before: number;
    after: number;
  }>;
  improvements?: Array<{
    kind: "unit" | "function" | "section";
    unit: string;
    item: string;
    before: number;
    after: number;
  }>;
  postReturnCheck?: {
    status: "passed" | "failed" | "skipped";
    reasons: string[];
    command?: string;
    exitCode?: number;
    summaryPath?: string;
    stdoutPath?: string;
    stderrPath?: string;
  };
}
