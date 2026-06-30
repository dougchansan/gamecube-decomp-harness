export interface TargetClaimFilter {
  minSize?: number;
  maxSize?: number;
  minFuzzy?: number;
  maxFuzzy?: number;
  sourceIncludes?: string[];
  sourceExcludes?: string[];
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric target filter: ${value}`);
  return parsed;
}

function stringList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function hasValues(filter: TargetClaimFilter): boolean {
  return (
    filter.minSize != null ||
    filter.maxSize != null ||
    filter.minFuzzy != null ||
    filter.maxFuzzy != null ||
    cleanList(filter.sourceIncludes).length > 0 ||
    cleanList(filter.sourceExcludes).length > 0
  );
}

export function targetClaimFilterFromArgs(args: Map<string, string | true>): TargetClaimFilter | undefined {
  const filter: TargetClaimFilter = {
    minSize: finiteNumber(args.get("--target-min-size")),
    maxSize: finiteNumber(args.get("--target-max-size")),
    minFuzzy: finiteNumber(args.get("--target-min-fuzzy")),
    maxFuzzy: finiteNumber(args.get("--target-max-fuzzy")),
    sourceIncludes: stringList(args.get("--target-sources")),
    sourceExcludes: stringList(args.get("--target-exclude-sources")),
  };
  return hasValues(filter) ? filter : undefined;
}

function escapeLikePattern(path: string): string {
  return path.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function likePattern(path: string): string {
  const wildcardPath = escapeLikePattern(path).replace(/\*/g, "%");
  return wildcardPath.endsWith("/") || wildcardPath.endsWith("%") ? wildcardPath : `${wildcardPath}%`;
}

export function targetClaimFilterSql(filter: TargetClaimFilter | undefined, alias = "epoch_targets"): { sql: string; params: Array<string | number> } {
  if (!filter) return { sql: "", params: [] };
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const prefix = alias ? `${alias}.` : "";

  if (filter.minSize != null) {
    clauses.push(`${prefix}size >= ?`);
    params.push(filter.minSize);
  }
  if (filter.maxSize != null) {
    clauses.push(`${prefix}size <= ?`);
    params.push(filter.maxSize);
  }
  if (filter.minFuzzy != null) {
    clauses.push(`${prefix}baseline_score >= ?`);
    params.push(filter.minFuzzy);
  }
  if (filter.maxFuzzy != null) {
    clauses.push(`${prefix}baseline_score <= ?`);
    params.push(filter.maxFuzzy);
  }

  const includes = cleanList(filter.sourceIncludes);
  if (includes.length > 0) {
    clauses.push(`(${includes.map(() => `${prefix}source_path LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    params.push(...includes.map(likePattern));
  }

  const excludes = cleanList(filter.sourceExcludes);
  if (excludes.length > 0) {
    clauses.push(`(${excludes.map(() => `${prefix}source_path NOT LIKE ? ESCAPE '\\'`).join(" AND ")})`);
    params.push(...excludes.map(likePattern));
  }

  return clauses.length > 0 ? { sql: ` AND ${clauses.join(" AND ")}`, params } : { sql: "", params: [] };
}

export function targetClaimFilterCommandArgs(filter: TargetClaimFilter | undefined): string[] {
  if (!filter) return [];
  const args: string[] = [];
  if (filter.minSize != null) args.push("--target-min-size", String(filter.minSize));
  if (filter.maxSize != null) args.push("--target-max-size", String(filter.maxSize));
  if (filter.minFuzzy != null) args.push("--target-min-fuzzy", String(filter.minFuzzy));
  if (filter.maxFuzzy != null) args.push("--target-max-fuzzy", String(filter.maxFuzzy));
  const includes = cleanList(filter.sourceIncludes);
  if (includes.length > 0) args.push("--target-sources", includes.join(","));
  const excludes = cleanList(filter.sourceExcludes);
  if (excludes.length > 0) args.push("--target-exclude-sources", excludes.join(","));
  return args;
}
