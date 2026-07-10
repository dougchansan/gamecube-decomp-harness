import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { BoardMeasures, BoardRankBreakdown, BoardSnapshot, TargetCandidate } from "@server/core/shared/types/index.js";
import { classifySourceFunctions, loadFunctionSourceMap, type FunctionSourceMapEntry, type SourceProgressClass } from "../source-progress.js";
import { candidateFromReportFunction, closenessPriority, closenessScore, objdiffSourceMap } from "./candidates.js";
import { asArray, asObject, numberValue, stringValue, type JsonObject } from "./json.js";

const HIGH_ACCURACY_BONUS_WEIGHT = 0.4;
const ACCURACY_READINESS_READINESS_WEIGHT = 0.35;
const ACCURACY_READINESS_INFORMATION_WEIGHT = 0.1;
const MAX_ACCURACY_READINESS_BONUS = 18;
const MAX_CLOSENESS_FALLBACK_SCORE = 3;

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

export interface LoadBoardSnapshotOptions {
  codeGraphFunctionsIndexPath?: string;
  excludeSourcePaths?: string[];
  fuzzyMax?: number;
  objdiffPath?: string;
  rankFeatureProvider?: BoardRankFeatureProvider;
  reportPath?: string;
  sizeMin?: number;
  sizeMax?: number;
}

export type BoardRankFeatureProvider = (candidate: TargetCandidate) => BoardRankFeature | null | undefined;

export interface BoardRankFeature {
  target?: {
    source_path: string;
    unit?: string;
    symbol?: string;
  };
  source_path: string;
  editability: "editable" | "read_only_complete" | "locked" | "blocked" | "unknown";
  graph_degree: number;
  function_graph_degree: number;
  fresh_edges_since_last_attempt: number;
  relevant_pr_count: number;
  review_risk_count: number;
  duplicate_reference_count: number;
  linked_unlock_potential: number;
  connected_incomplete_function_count: number;
  connected_matched_reference_count: number;
  resource_evidence_count: number;
  path_fact_count: number;
  historical_lesson_count: number;
  curated_signal_count: number;
  proposal_fact_count: number;
  stale_fact_count: number;
  information_gain_score: number;
  unlock_score: number;
  context_quality_score: number;
  completion_readiness_score: number;
  information_value_score: number;
  risk_penalty: number;
  priority_bonus: number;
  explanation: string[];
}

function sessionBaselineRepoRoot(repoRoot: string): string | null {
  const worktreeName = basename(repoRoot);
  if (worktreeName !== "current" && worktreeName !== "source") return null;
  const sessionRoot = dirname(repoRoot);
  const sessionsRoot = dirname(sessionRoot);
  if (basename(sessionsRoot) !== "sessions") return null;
  return resolve(dirname(sessionsRoot), "upstream-current");
}

interface ReportFunctionInfo {
  unitName: string;
  sourcePath: string;
  symbol: string;
  size: number;
  fuzzy: number;
}

function candidateKey(unit: string, symbol: string): string {
  return `${unit}:${symbol}`;
}

function mappedSourcePath(symbol: string, fallback: string, sourceMap: Map<string, FunctionSourceMapEntry>): string {
  return fallback || sourceMap.get(symbol)?.sourcePath || "";
}

function sourceConversionFuzzy(_klass: SourceProgressClass): number {
  return 0;
}

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function buildableSourcePaths(repoRoot: string, reportRelPath: string): Set<string> {
  const buildDir = dirname(reportRelPath).replace(/\\/g, "/");
  const ninjaPath = resolve(repoRoot, "build.ninja");
  const paths = new Set<string>();
  if (!existsSync(ninjaPath) || !buildDir || buildDir === ".") return paths;

  const targetPattern = new RegExp(`^build\\s+${escapeRegExp(buildDir)}/(src/.+?)\\.o:`);
  for (const line of readFileSync(ninjaPath, "utf8").split(/\r?\n/)) {
    const match = targetPattern.exec(line);
    if (!match) continue;
    paths.add(`${match[1]}.c`);
  }
  return paths;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excludedSources(options: LoadBoardSnapshotOptions): Set<string> {
  return new Set((options.excludeSourcePaths ?? []).map(normalizeSourcePath).filter(Boolean));
}

function filterExcludedCandidates(candidates: TargetCandidate[], excluded: Set<string>): TargetCandidate[] {
  if (excluded.size === 0) return candidates;
  return candidates.filter((candidate) => !excluded.has(normalizeSourcePath(candidate.sourcePath)));
}

function filterFuzzyMaxCandidates(candidates: TargetCandidate[], fuzzyMax: number | undefined): TargetCandidate[] {
  if (fuzzyMax == null || !Number.isFinite(fuzzyMax)) return candidates;
  return candidates.filter((candidate) => candidate.fuzzy <= fuzzyMax);
}

function filterSizeBandCandidates(candidates: TargetCandidate[], sizeMin: number | undefined, sizeMax: number | undefined): TargetCandidate[] {
  const min = sizeMin != null && Number.isFinite(sizeMin) ? sizeMin : Number.NEGATIVE_INFINITY;
  const max = sizeMax != null && Number.isFinite(sizeMax) ? sizeMax : Number.POSITIVE_INFINITY;
  if (min === Number.NEGATIVE_INFINITY && max === Number.POSITIVE_INFINITY) return candidates;
  return candidates.filter((candidate) => candidate.size >= min && candidate.size <= max);
}

function sourceConversionCandidate(params: {
  entry: FunctionSourceMapEntry;
  report: ReportFunctionInfo | undefined;
  sourceClass: SourceProgressClass;
  buildableSources: Set<string>;
}): TargetCandidate | null {
  if (params.sourceClass === "REAL_C") return null;
  if (!params.entry.sourcePath.endsWith(".c")) return null;
  if (!params.buildableSources.has(normalizeSourcePath(params.entry.sourcePath))) return null;
  const unit = params.report?.unitName ?? "";
  if (!unit) return null;
  const size = params.report?.size || params.entry.size;
  if (size <= 0) return null;
  const fuzzy = sourceConversionFuzzy(params.sourceClass);
  const reportedFuzzy = params.report ? `${params.report.fuzzy.toFixed(5)}%` : "unavailable";
  return {
    unit,
    sourcePath: params.entry.sourcePath,
    symbol: params.entry.symbol,
    size,
    fuzzy,
    priority: closenessPriority(size, fuzzy),
    reason:
      `source-conversion candidate: active ${params.sourceClass} in ${params.entry.sourcePath}; ` +
      `func_tu_map status ${params.entry.status}; objdiff reports ${reportedFuzzy}, so this needs honest C conversion rather than score-only progress`,
  };
}

export function loadBoardSnapshot(repoRoot: string, limit: number, options: LoadBoardSnapshotOptions = {}): BoardSnapshot {
  const reportRelPath = options.reportPath ?? "build/GC6E01/report.json";
  const objdiffRelPath = options.objdiffPath ?? "objdiff.json";
  let reportPath = resolveRepoPath(repoRoot, reportRelPath);
  let objdiffPath = resolveRepoPath(repoRoot, objdiffRelPath);
  if (!existsSync(reportPath) || !existsSync(objdiffPath)) {
    const baselineRoot = sessionBaselineRepoRoot(repoRoot);
    const baselineReportPath = baselineRoot ? resolveRepoPath(baselineRoot, reportRelPath) : "";
    const baselineObjdiffPath = baselineRoot ? resolveRepoPath(baselineRoot, objdiffRelPath) : "";
    if (baselineReportPath && existsSync(baselineReportPath) && existsSync(baselineObjdiffPath)) {
      reportPath = baselineReportPath;
      objdiffPath = baselineObjdiffPath;
    } else {
      return loadBoardSnapshotFromCodeGraphIndex(limit, reportPath, objdiffPath, options);
    }
  }

  const report = readJson(reportPath);
  const objdiff = readJson(objdiffPath);
  const sourceByUnit = objdiffSourceMap(objdiff);
  const functionSourceMap = loadFunctionSourceMap(repoRoot);
  const sourceClasses = classifySourceFunctions(repoRoot, functionSourceMap);
  const buildableSources = buildableSourcePaths(repoRoot, reportRelPath);
  const reportFunctions = new Map<string, ReportFunctionInfo>();
  const candidateKeys = new Set<string>();
  const excluded = excludedSources(options);
  const candidates: TargetCandidate[] = [];
  // When a fuzzyMax filter is active, functions objdiff never scored (no fuzzy_match_percent field —
  // typically because no matching target function exists yet, i.e. genuinely from-scratch) are treated
  // as fuzzy 0 so they can surface as from-scratch candidates. Without a fuzzyMax filter, they keep the
  // historical fallback of 100 (excluded as already-matched) to preserve existing default behavior.
  const missingFuzzyDefault = options.fuzzyMax != null && Number.isFinite(options.fuzzyMax) ? 0 : 100;

  for (const unitValue of asArray(report.units)) {
    const unit = asObject(unitValue);
    const unitName = stringValue(unit.name);
    if (!unitName) continue;
    const metadata = asObject(unit.metadata);
    const unitSourcePath = stringValue(metadata.source_path, sourceByUnit.get(unitName) ?? "");
    for (const fnValue of asArray(unit.functions)) {
      const fn = asObject(fnValue);
      const fnMetadata = asObject(fn.metadata);
      const symbol = stringValue(fn.name);
      const sourcePath = mappedSourcePath(symbol, stringValue(fnMetadata.source_path, unitSourcePath), functionSourceMap);
      const size = numberValue(fn.size);
      const fuzzy = numberValue(fn.fuzzy_match_percent, 100);
      if (symbol) {
        reportFunctions.set(symbol, { unitName, sourcePath, symbol, size, fuzzy });
      }
      const candidate = candidateFromReportFunction({
        unitName,
        sourcePath,
        fn,
        defaultFuzzy: missingFuzzyDefault,
      });
      if (candidate) {
        candidates.push(candidate);
        candidateKeys.add(candidateKey(candidate.unit, candidate.symbol));
      }
    }
  }

  for (const [symbol, sourceClass] of sourceClasses) {
    const entry = functionSourceMap.get(symbol);
    if (!entry) continue;
    const candidate = sourceConversionCandidate({ entry, report: reportFunctions.get(symbol), sourceClass, buildableSources });
    if (!candidate) continue;
    const key = candidateKey(candidate.unit, candidate.symbol);
    if (candidateKeys.has(key)) continue;
    candidates.push(candidate);
    candidateKeys.add(key);
  }

  const filteredCandidates = filterSizeBandCandidates(
    filterFuzzyMaxCandidates(filterExcludedCandidates(candidates, excluded), options.fuzzyMax),
    options.sizeMin,
    options.sizeMax,
  );
  rankBoardCandidates(filteredCandidates, options.rankFeatureProvider);
  filteredCandidates.sort((left, right) => right.priority - left.priority);
  const measures = asObject(report.measures) as BoardMeasures;
  return {
    generatedAt: new Date().toISOString(),
    reportPath,
    objdiffPath,
    measures,
    candidates: filteredCandidates.slice(0, limit),
  };
}

function resolveRepoPath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(repoRoot, path);
}

function loadBoardSnapshotFromCodeGraphIndex(
  limit: number,
  reportPath: string,
  objdiffPath: string,
  options: LoadBoardSnapshotOptions = {},
): BoardSnapshot {
  const functionsIndex = options.codeGraphFunctionsIndexPath ?? "";
  if (!functionsIndex || !existsSync(functionsIndex)) {
    const missing = [reportPath, objdiffPath, functionsIndex || "code graph functions index path"].filter((path) => !existsSync(path));
    throw new Error(`Missing board snapshot inputs: ${missing.join(", ")}`);
  }

  const rows = readJsonl(functionsIndex);
  const excluded = excludedSources(options);
  const candidates: TargetCandidate[] = [];
  let totalFunctions = 0;
  let matchedFunctions = 0;
  let totalBytes = 0;
  let matchedBytes = 0;
  const missingFuzzyDefault = options.fuzzyMax != null && Number.isFinite(options.fuzzyMax) ? 0 : 100;
  const sizeMin = options.sizeMin != null && Number.isFinite(options.sizeMin) ? options.sizeMin : Number.NEGATIVE_INFINITY;
  const sizeMax = options.sizeMax != null && Number.isFinite(options.sizeMax) ? options.sizeMax : Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const unit = stringValue(row.unit);
    const sourcePath = stringValue(row.sourcePath, stringValue(row.source_path));
    const symbol = stringValue(row.symbol);
    const size = numberValue(row.size);
    const fuzzy = numberValue(row.fuzzy, numberValue(row.fuzzy_match_percent, missingFuzzyDefault));
    if (!unit || !sourcePath || !symbol || size <= 0 || excluded.has(normalizeSourcePath(sourcePath))) continue;
    totalFunctions += 1;
    totalBytes += size;
    if (fuzzy >= 100) {
      matchedFunctions += 1;
      matchedBytes += size;
      continue;
    }
    if (options.fuzzyMax != null && Number.isFinite(options.fuzzyMax) && fuzzy > options.fuzzyMax) continue;
    if (size < sizeMin || size > sizeMax) continue;
    candidates.push({
      unit,
      sourcePath,
      symbol,
      size,
      fuzzy,
      priority: closenessPriority(size, fuzzy),
      reason: `code_graph index finish candidate: ${size} bytes at ${fuzzy.toFixed(5)}% fuzzy, ${Math.max(0, 100 - fuzzy).toFixed(
        5,
      )}% gap to exact`,
    });
  }

  rankBoardCandidates(candidates, options.rankFeatureProvider);
  candidates.sort((left, right) => right.priority - left.priority);
  const measures: BoardMeasures = {
    matched_functions_percent: percent(matchedFunctions, totalFunctions),
    matched_code_percent: percent(matchedBytes, totalBytes),
    complete_code_percent: percent(matchedBytes, totalBytes),
  };
  return {
    generatedAt: new Date().toISOString(),
    reportPath: functionsIndex,
    objdiffPath: "",
    measures,
    candidates: candidates.slice(0, limit),
  };
}

function readJsonl(path: string): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as JsonObject);
  }
  return rows;
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Number(((part / whole) * 100).toFixed(5));
}

function rankBoardCandidates(candidates: TargetCandidate[], rankFeatureProvider?: BoardRankFeatureProvider): void {
  if (!rankFeatureProvider || candidates.length === 0) {
    for (const candidate of candidates) applyCandidateRank(candidate);
    return;
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const feature = rankFeatureProvider(candidate);
    if (!feature) {
      applyCandidateRank(candidate);
      continue;
    }
    if (feature.editability === "read_only_complete" || feature.editability === "locked" || feature.editability === "blocked") {
      candidates.splice(index, 1);
      continue;
    }
    applyCandidateRank(candidate, feature);
  }
}

function applyCandidateRank(candidate: TargetCandidate, graph?: BoardRankFeature): void {
  const rawCloseness = closenessPriority(candidate.size, candidate.fuzzy);
  const localClosenessScore = closenessScore(candidate.size, candidate.fuzzy);
  const graphScore = graph?.priority_bonus ?? 0;
  const hasInformationSignals =
    graph &&
    (graphScore > 0 ||
      (graph.information_gain_score ?? 0) > 0 ||
      (graph.unlock_score ?? 0) > 0 ||
      (graph.context_quality_score ?? 0) > 0 ||
      (graph.completion_readiness_score ?? 0) > 0);
  const highAccuracyBonus = graph && hasInformationSignals ? roundScore(localClosenessScore * HIGH_ACCURACY_BONUS_WEIGHT) : graph ? 0 : localClosenessScore;
  const closenessFallbackScore = graph && !hasInformationSignals ? fallbackClosenessScore(candidate, rawCloseness) : 0;
  const accuracyReadinessBonus = graph
    ? roundScore(
        Math.min(
          MAX_ACCURACY_READINESS_BONUS,
          (localClosenessScore / 30) *
            ((graph.completion_readiness_score ?? 0) * ACCURACY_READINESS_READINESS_WEIGHT +
              (graph.information_gain_score ?? 0) * ACCURACY_READINESS_INFORMATION_WEIGHT),
        ),
      )
    : 0;
  const rank: BoardRankBreakdown = {
    raw_finishability_priority: roundScore(rawCloseness),
    finishability_score: localClosenessScore,
    closeness_score: localClosenessScore,
    information_gain_score: graph?.information_gain_score ?? 0,
    unlock_score: graph?.unlock_score ?? 0,
    context_quality_score: graph?.context_quality_score ?? 0,
    completion_readiness_score: graph?.completion_readiness_score ?? 0,
    information_value_score: graph?.information_value_score ?? 0,
    information_priority_score: graphScore,
    high_accuracy_bonus: highAccuracyBonus,
    accuracy_readiness_bonus: accuracyReadinessBonus,
    closeness_fallback_score: closenessFallbackScore,
    risk_penalty: graph?.risk_penalty ?? 0,
    graph_score: graphScore,
    total_priority: roundScore(graphScore + highAccuracyBonus + accuracyReadinessBonus + closenessFallbackScore),
    explanation: graph ? [...graph.explanation, hasInformationSignals ? "information_signals=present" : "information_signals=absent"] : ["graph_db=unavailable"],
  };
  candidate.priority = rank.total_priority;
  candidate.rank = rank;
  candidate.reason = `${candidate.reason}; board rank ${rank.total_priority.toFixed(2)} = information priority ${rank.information_priority_score.toFixed(
    2,
  )} + high-accuracy bonus ${rank.high_accuracy_bonus.toFixed(2)} + accuracy/readiness bonus ${rank.accuracy_readiness_bonus.toFixed(
    2,
  )} + closeness fallback ${rank.closeness_fallback_score.toFixed(
    2,
  )}; signals: closeness ${rank.closeness_score.toFixed(2)}, information gain ${rank.information_gain_score.toFixed(
    2,
  )}, unlock ${rank.unlock_score.toFixed(2)}, readiness ${rank.completion_readiness_score.toFixed(
    2,
  )}, context ${rank.context_quality_score.toFixed(2)}, risk ${rank.risk_penalty.toFixed(2)}`;
}

function fallbackClosenessScore(candidate: TargetCandidate, rawCloseness: number): number {
  const gap = Math.max(0, 100 - candidate.fuzzy);
  const fuzzyComponent = Math.exp(-gap / 0.08);
  const rawComponent = clamp((Math.log1p(Math.max(0, rawCloseness)) - 6) / 6);
  const sizeComponent = clamp(Math.log1p(Math.max(0, candidate.size)) / Math.log1p(4096));
  return roundScore(Math.min(MAX_CLOSENESS_FALLBACK_SCORE, 0.2 + fuzzyComponent * 1.8 + rawComponent * 0.7 + sizeComponent * 0.3));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}
