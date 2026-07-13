import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TargetClaimFilter {
  minSize?: number;
  maxSize?: number;
  minFuzzy?: number;
  maxFuzzy?: number;
  sourceIncludes?: string[];
  sourceExcludes?: string[];
  targetKeys?: string[];
  targetKeysFile?: string;
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

function assertTargetKey(value: string, source: string, lineNumber: number): string {
  const separator = value.indexOf("::");
  if (separator <= 0 || separator >= value.length - 2) {
    throw new Error(`Invalid target_key in ${source}:${lineNumber}: ${value}`);
  }
  return value;
}

export function parseTargetKeysManifest(text: string, source = "<target-keys-file>"): string[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((value, index) => ({ value: value.trim(), lineNumber: index + 1 }))
    .filter((line) => line.value && !line.value.startsWith("#"));
  if (lines.length === 0) throw new Error(`Target keys manifest is empty: ${source}`);

  const header = lines[0].value.split("\t").map((value) => value.trim().toLowerCase());
  const targetKeyColumn = header.indexOf("target_key");
  const dataLines = targetKeyColumn >= 0 ? lines.slice(1) : lines;
  const keys: string[] = [];
  for (const line of dataLines) {
    const cells = line.value.split("\t");
    if (targetKeyColumn < 0 && cells.length > 1) {
      throw new Error(`TSV target keys manifest must have a target_key header: ${source}:${line.lineNumber}`);
    }
    const value = (targetKeyColumn >= 0 ? cells[targetKeyColumn] : cells[0])?.trim() ?? "";
    if (!value) throw new Error(`Missing target_key in ${source}:${line.lineNumber}`);
    keys.push(assertTargetKey(value, source, line.lineNumber));
  }

  const unique = cleanList(keys);
  if (unique.length === 0) throw new Error(`Target keys manifest contains no targets: ${source}`);
  return unique;
}

export function loadTargetKeysManifest(path: string): { path: string; targetKeys: string[] } {
  const absolutePath = resolve(path);
  return {
    path: absolutePath,
    targetKeys: parseTargetKeysManifest(readFileSync(absolutePath, "utf8"), absolutePath),
  };
}

function hasValues(filter: TargetClaimFilter): boolean {
  return (
    filter.minSize != null ||
    filter.maxSize != null ||
    filter.minFuzzy != null ||
    filter.maxFuzzy != null ||
    cleanList(filter.sourceIncludes).length > 0 ||
    cleanList(filter.sourceExcludes).length > 0 ||
    cleanList(filter.targetKeys).length > 0
  );
}

export function targetClaimFilterFromArgs(args: Map<string, string | true>): TargetClaimFilter | undefined {
  const targetKeysFileArg = args.get("--target-keys-file");
  if (targetKeysFileArg === true) throw new Error("--target-keys-file requires a path");
  const manifest = typeof targetKeysFileArg === "string" ? loadTargetKeysManifest(targetKeysFileArg) : undefined;
  const filter: TargetClaimFilter = {
    minSize: finiteNumber(args.get("--target-min-size")),
    maxSize: finiteNumber(args.get("--target-max-size")),
    minFuzzy: finiteNumber(args.get("--target-min-fuzzy")),
    maxFuzzy: finiteNumber(args.get("--target-max-fuzzy")),
    sourceIncludes: stringList(args.get("--target-sources")),
    sourceExcludes: stringList(args.get("--target-exclude-sources")),
    targetKeys: manifest?.targetKeys,
    targetKeysFile: manifest?.path,
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

  const targetKeys = cleanList(filter.targetKeys);
  if (targetKeys.length > 0) {
    clauses.push(`${prefix}target_key IN (${targetKeys.map(() => "?").join(", ")})`);
    params.push(...targetKeys);
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
  if (cleanList(filter.targetKeys).length > 0 && !filter.targetKeysFile) {
    throw new Error("Target key filters require targetKeysFile for child command propagation");
  }
  if (filter.targetKeysFile) args.push("--target-keys-file", resolve(filter.targetKeysFile));
  return args;
}
