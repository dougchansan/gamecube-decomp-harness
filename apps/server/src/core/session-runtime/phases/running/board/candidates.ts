import type { TargetCandidate } from "@server/core/shared/types/index.js";
import { asArray, asObject, numberValue, stringValue, type JsonObject } from "./json.js";

const CLOSENESS_SCORE_CAP = 30;

export function closenessPriority(size: number, fuzzy: number): number {
  if (fuzzy <= 0) return Math.max(0, size);
  const gap = Math.max(0.001, 100 - fuzzy);
  const completeness = Math.max(0, Math.min(1, fuzzy / 100));
  const nearExactBoost = fuzzy >= 99 ? 8 : fuzzy >= 98 ? 4 : fuzzy >= 95 ? 2 : 1;
  return (size * nearExactBoost * completeness ** 4) / (gap + 0.01);
}

export function finishabilityPriority(size: number, fuzzy: number): number {
  return closenessPriority(size, fuzzy);
}

export function closenessScore(size: number, fuzzy: number): number {
  return Number(Math.min(CLOSENESS_SCORE_CAP, Math.log1p(closenessPriority(size, fuzzy)) * 4).toFixed(4));
}

export function finishabilityScore(size: number, fuzzy: number): number {
  return closenessScore(size, fuzzy);
}

export function objdiffSourceMap(objdiff: JsonObject): Map<string, string> {
  const byUnit = new Map<string, string>();
  for (const unitValue of asArray(objdiff.units)) {
    const unit = asObject(unitValue);
    const metadata = asObject(unit.metadata);
    const name = stringValue(unit.name);
    const sourcePath = stringValue(metadata.source_path);
    if (name && sourcePath) byUnit.set(name, sourcePath);
  }
  return byUnit;
}

export function candidateFromReportFunction(params: {
  defaultFuzzy?: number;
  unitName: string;
  sourcePath: string;
  fn: JsonObject;
}): TargetCandidate | null {
  const fuzzy = numberValue(params.fn.fuzzy_match_percent, params.defaultFuzzy ?? 100);
  if (fuzzy >= 100) return null;
  const size = numberValue(params.fn.size);
  const symbol = stringValue(params.fn.name);
  if (!params.sourcePath || !symbol || size <= 0) return null;
  const priority = fuzzy > 0 ? closenessPriority(size, fuzzy) : size;
  return {
    unit: params.unitName,
    sourcePath: params.sourcePath,
    symbol,
    size,
    fuzzy,
    priority,
    reason:
      fuzzy > 0
        ? `matched-code finish candidate: ${size} bytes at ${fuzzy.toFixed(5)}% fuzzy, ${Math.max(0, 100 - fuzzy).toFixed(5)}% gap to exact`
        : `unscored function candidate: ${size} bytes with source mapping from project function map`,
  };
}
