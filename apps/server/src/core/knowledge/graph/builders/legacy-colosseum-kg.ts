import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { legacyColosseumKgEnrichmentPath } from "../../paths.js";
import { fileEntityId, functionEntityId } from "./code-graph.js";
import type { GraphEdge, GraphEntity, GraphFact, GraphRecords, SearchChunk } from "../types.js";
import { ensureParentDir, filesFingerprint, numberValue, objectValue, readJson, readJsonlLazy, shortHash, stringValue, truncate } from "../util.js";

const SOURCE_ID = "legacy_colosseum_kg";

type LegacyKgKind = "legacy_lever" | "legacy_crack" | "legacy_wall_class" | "legacy_function_hint" | "legacy_lever_doc";

interface LegacyKgRecord {
  kind: LegacyKgKind;
  id: string;
  evidence_ref: string;
  status?: string;
  [key: string]: unknown;
}

interface CurrentFunction {
  entityId: string;
  fileEntityId?: string;
  sourcePath?: string;
  symbol: string;
  unit: string;
  address?: string;
  fuzzy?: number;
}

export interface ImportLegacyColosseumKgOptions {
  inputPath: string;
  outputPath?: string;
  leverDocPath?: string;
}

export interface ImportLegacyColosseumKgResult {
  input_path: string;
  output_path: string;
  records_written: number;
  levers: number;
  cracks: number;
  wall_classes: number;
  function_hints: number;
  lever_docs: number;
}

export function importLegacyColosseumKg(options: ImportLegacyColosseumKgOptions): ImportLegacyColosseumKgResult {
  const inputPath = resolve(options.inputPath);
  if (!existsSync(inputPath)) throw new Error(`Missing legacy Colosseum KG DB: ${inputPath}`);
  const outputPath = resolve(options.outputPath ?? legacyColosseumKgEnrichmentPath());
  const db = new Database(inputPath, { readonly: true });
  const records: LegacyKgRecord[] = [];
  try {
    for (const row of db
      .query(
        `
          SELECT
            l.slug,
            l.title,
            l.description,
            l.opt_gated,
            l.source,
            COUNT(c.id) AS crack_count
          FROM levers l
          LEFT JOIN cracked_by c ON c.lever_slug = l.slug
          GROUP BY l.slug, l.title, l.description, l.opt_gated, l.source
          ORDER BY crack_count DESC, l.slug
        `,
      )
      .all() as Array<Record<string, unknown>>) {
      const slug = compact(stringValue(row.slug));
      if (!slug) continue;
      records.push({
        kind: "legacy_lever",
        id: `legacy_lever:${slug}`,
        slug,
        title: compact(stringValue(row.title, slug)),
        description: optionalText(row.description),
        opt_gated: Boolean(Number(row.opt_gated ?? 0)),
        source: optionalText(row.source),
        crack_count: numberValue(row.crack_count),
        status: "accepted",
        evidence_ref: `legacy-colosseum-kg:levers:${slug}`,
      });
    }

    for (const row of db
      .query(
        `
          SELECT
            c.id,
            c.addr,
            c.lever_slug,
            c.commit_sha,
            c.delta,
            c.ts,
            f.tu,
            f.byte_pct,
            f.status AS legacy_status,
            f.is_equivalent,
            f.wall_class,
            f.notes,
            l.title AS lever_title,
            l.description AS lever_description
          FROM cracked_by c
          LEFT JOIN functions f ON f.addr = c.addr
          LEFT JOIN levers l ON l.slug = c.lever_slug
          ORDER BY c.ts DESC, c.id DESC
        `,
      )
      .all() as Array<Record<string, unknown>>) {
      const addr = compact(stringValue(row.addr));
      const leverSlug = compact(stringValue(row.lever_slug));
      if (!addr || !leverSlug) continue;
      const commitSha = optionalText(row.commit_sha);
      const rowId = String(row.id ?? shortHash(`${addr}:${leverSlug}:${commitSha ?? ""}`));
      records.push({
        kind: "legacy_crack",
        id: `legacy_crack:${rowId}`,
        addr,
        lever_slug: leverSlug,
        lever_title: optionalText(row.lever_title),
        lever_description: optionalText(row.lever_description),
        commit_sha: commitSha,
        delta: optionalText(row.delta),
        created_at: unixSecondsToIso(row.ts),
        source_path: sourcePathValue(row.tu),
        legacy_tu: optionalText(row.tu),
        legacy_byte_pct: finiteNumber(row.byte_pct),
        legacy_status: optionalText(row.legacy_status),
        legacy_is_equivalent: Boolean(Number(row.is_equivalent ?? 0)),
        legacy_wall_class: optionalText(row.wall_class),
        legacy_notes: optionalText(row.notes),
        status: "accepted",
        evidence_ref: commitSha ? `legacy-colosseum-kg:cracked_by:${addr}:${leverSlug}:${commitSha}` : `legacy-colosseum-kg:cracked_by:${rowId}`,
      });
    }

    for (const row of db
      .query("SELECT class, title, c_controllable, description FROM walls ORDER BY class")
      .all() as Array<Record<string, unknown>>) {
      const wallClass = compact(stringValue(row.class));
      if (!wallClass) continue;
      records.push({
        kind: "legacy_wall_class",
        id: `legacy_wall_class:${wallClass}`,
        class: wallClass,
        title: compact(stringValue(row.title, wallClass)),
        c_controllable: Boolean(Number(row.c_controllable ?? 0)),
        description: optionalText(row.description),
        status: "accepted",
        evidence_ref: `legacy-colosseum-kg:walls:${wallClass}`,
      });
    }

    for (const row of db
      .query(
        `
          SELECT addr, name, tu, byte_pct, compiler, status, is_equivalent, wall_class, scratch_url, notes, updated_at
          FROM functions
          WHERE length(trim(coalesce(notes, ''))) > 0
             OR byte_pct IS NOT NULL
             OR is_equivalent = 1
             OR length(trim(coalesce(wall_class, ''))) > 0
          ORDER BY updated_at DESC, addr
        `,
      )
      .all() as Array<Record<string, unknown>>) {
      const addr = compact(stringValue(row.addr));
      if (!addr) continue;
      records.push({
        kind: "legacy_function_hint",
        id: `legacy_function_hint:${addr}`,
        addr,
        name: optionalText(row.name),
        source_path: sourcePathValue(row.tu),
        legacy_tu: optionalText(row.tu),
        legacy_byte_pct: finiteNumber(row.byte_pct),
        legacy_compiler: optionalText(row.compiler),
        legacy_status: optionalText(row.status),
        legacy_is_equivalent: Boolean(Number(row.is_equivalent ?? 0)),
        legacy_wall_class: optionalText(row.wall_class),
        scratch_url: optionalText(row.scratch_url),
        notes: optionalText(row.notes),
        updated_at: unixSecondsToIso(row.updated_at),
        status: "stale",
        evidence_ref: `legacy-colosseum-kg:functions:${addr}`,
      });
    }
  } finally {
    db.close();
  }

  const leverDocPath = options.leverDocPath ? resolve(options.leverDocPath) : "";
  if (leverDocPath && existsSync(leverDocPath)) {
    const text = readFileSync(leverDocPath, "utf8");
    records.push({
      kind: "legacy_lever_doc",
      id: `legacy_lever_doc:${shortHash(leverDocPath)}`,
      title: "Legacy Colosseum crack lever catalog",
      source_path: leverDocPath,
      text,
      status: "accepted",
      evidence_ref: leverDocPath,
    });
  }

  ensureParentDir(outputPath);
  writeFileSync(outputPath, records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "", "utf8");
  return {
    input_path: inputPath,
    output_path: outputPath,
    records_written: records.length,
    levers: records.filter((record) => record.kind === "legacy_lever").length,
    cracks: records.filter((record) => record.kind === "legacy_crack").length,
    wall_classes: records.filter((record) => record.kind === "legacy_wall_class").length,
    function_hints: records.filter((record) => record.kind === "legacy_function_hint").length,
    lever_docs: records.filter((record) => record.kind === "legacy_lever_doc").length,
  };
}

export function buildLegacyColosseumKgGraphRecords(repoRoot: string, path = legacyColosseumKgEnrichmentPath()): GraphRecords | null {
  const enrichmentPath = resolve(path);
  if (!existsSync(enrichmentPath)) return null;
  const sourceVersionId = `source-version:${SOURCE_ID}:${shortHash(filesFingerprint([enrichmentPath]))}`;
  const currentFunctions = currentFunctionIndex(repoRoot);
  const entities: GraphEntity[] = [];
  const facts: GraphFact[] = [];
  const edges: GraphEdge[] = [];
  const chunks: SearchChunk[] = [];

  readJsonlLazy(enrichmentPath, (row) => {
    const record = row as LegacyKgRecord;
    if (record.kind === "legacy_lever") addLever(record, sourceVersionId, entities, facts, chunks);
    else if (record.kind === "legacy_crack") addCrack(record, currentFunctions, sourceVersionId, entities, facts, edges, chunks);
    else if (record.kind === "legacy_wall_class") addWallClass(record, sourceVersionId, entities, facts, chunks);
    else if (record.kind === "legacy_function_hint") addFunctionHint(record, currentFunctions, sourceVersionId, entities, facts, edges, chunks);
    else if (record.kind === "legacy_lever_doc") addLeverDoc(record, sourceVersionId, entities, facts, chunks);
  });

  return {
    sourceVersion: {
      id: sourceVersionId,
      sourceId: SOURCE_ID,
      contentHash: shortHash(readFileSync(enrichmentPath, "utf8")),
      sourcePaths: [enrichmentPath],
    },
    entities,
    facts,
    edges,
    chunks,
  };
}

function addLever(record: LegacyKgRecord, sourceVersionId: string, entities: GraphEntity[], facts: GraphFact[], chunks: SearchChunk[]): void {
  const slug = compact(stringValue(record.slug));
  if (!slug) return;
  const entityId = leverEntityId(slug);
  const payload = { ...record };
  entities.push({ id: entityId, entityType: "legacy_lever", stableKey: slug, payload });
  facts.push({
    id: `fact:${SOURCE_ID}:lever:${shortHash(slug)}`,
    entityId,
    factType: "legacy_lever",
    payload,
    confidence: 0.65,
    trustTier: "historical",
    evidenceRef: stringValue(record.evidence_ref),
    sourceVersionId,
    status: "accepted",
  });
  chunks.push({
    id: `chunk:${SOURCE_ID}:lever:${shortHash(slug)}`,
    sourceId: SOURCE_ID,
    sourceVersionId,
    entityId,
    title: `Legacy lever: ${stringValue(record.title, slug)}`,
    text: [slug, stringValue(record.title), stringValue(record.description), `crack_count=${numberValue(record.crack_count)}`, stringValue(record.source)]
      .filter(Boolean)
      .join("\n"),
    evidenceRef: stringValue(record.evidence_ref),
    payload,
  });
}

function addCrack(
  record: LegacyKgRecord,
  currentFunctions: Map<string, CurrentFunction>,
  sourceVersionId: string,
  entities: GraphEntity[],
  facts: GraphFact[],
  edges: GraphEdge[],
  chunks: SearchChunk[],
): void {
  const addr = compact(stringValue(record.addr));
  const leverSlug = compact(stringValue(record.lever_slug));
  if (!addr || !leverSlug) return;
  const current = currentForRecord(currentFunctions, record);
  const legacySourcePath = stringValue(record.source_path);
  const crackEntityId = `legacy_crack:${shortHash(`${addr}:${leverSlug}:${stringValue(record.commit_sha)}`)}`;
  const targetEntityId = current?.entityId ?? legacyFunctionEntityId(addr);
  const payload = { ...record, current_function: current ?? null };
  entities.push({ id: crackEntityId, entityType: "legacy_crack", stableKey: `${addr}:${leverSlug}:${stringValue(record.commit_sha)}`, payload });
  if (!current) entities.push({ id: targetEntityId, entityType: "legacy_function", stableKey: addr, payload: { addr }, replace: false });
  if (legacySourcePath) addLegacySourceFile(entities, legacySourcePath);
  facts.push({
    id: `fact:${SOURCE_ID}:crack:${shortHash(`${addr}:${leverSlug}:${stringValue(record.commit_sha)}`)}`,
    entityId: targetEntityId,
    factType: "legacy_crack",
    payload,
    confidence: 0.58,
    trustTier: "historical",
    evidenceRef: stringValue(record.evidence_ref),
    sourceVersionId,
    status: "accepted",
  });
  edges.push(edge(targetEntityId, "LEGACY_CRACKED_BY_LEVER", leverEntityId(leverSlug), sourceVersionId, stringValue(record.evidence_ref), 0.55));
  edges.push(edge(targetEntityId, "HAS_LEGACY_LEVER_LESSON", crackEntityId, sourceVersionId, stringValue(record.evidence_ref), 0.45));
  if (current?.fileEntityId) edges.push(edge(current.fileEntityId, "HAS_LEGACY_LEVER_LESSON", crackEntityId, sourceVersionId, stringValue(record.evidence_ref), 0.4));
  if (legacySourcePath) edges.push(edge(fileEntityId(legacySourcePath), "HAS_LEGACY_LEVER_LESSON", crackEntityId, sourceVersionId, stringValue(record.evidence_ref), 0.35));

  const text = [
    addr,
    current?.symbol,
    current?.sourcePath ?? legacySourcePath,
    legacySourcePath && current?.sourcePath && legacySourcePath !== current.sourcePath ? `legacy_source_path=${legacySourcePath}` : "",
    `lever=${leverSlug}`,
    stringValue(record.lever_title),
    stringValue(record.lever_description),
    stringValue(record.delta),
    stringValue(record.legacy_notes),
  ]
    .filter(Boolean)
    .join("\n");
  chunks.push({
    id: `chunk:${SOURCE_ID}:crack:${shortHash(`${addr}:${leverSlug}:${stringValue(record.commit_sha)}`)}`,
    sourceId: SOURCE_ID,
    sourceVersionId,
    entityId: current?.fileEntityId ?? targetEntityId,
    title: `Legacy crack: ${addr} via ${leverSlug}`,
    text,
    evidenceRef: stringValue(record.evidence_ref),
    payload,
  });
  if (legacySourcePath && legacySourcePath !== current?.sourcePath) {
    chunks.push({
      id: `chunk:${SOURCE_ID}:crack:${shortHash(`${addr}:${leverSlug}:${stringValue(record.commit_sha)}:${legacySourcePath}`)}`,
      sourceId: SOURCE_ID,
      sourceVersionId,
      entityId: fileEntityId(legacySourcePath),
      title: `Legacy crack for ${legacySourcePath}: ${addr} via ${leverSlug}`,
      text,
      evidenceRef: stringValue(record.evidence_ref),
      payload,
    });
  }
}

function addWallClass(record: LegacyKgRecord, sourceVersionId: string, entities: GraphEntity[], facts: GraphFact[], chunks: SearchChunk[]): void {
  const wallClass = compact(stringValue(record.class));
  if (!wallClass) return;
  const entityId = `legacy_wall_class:${wallClass}`;
  const payload = { ...record };
  entities.push({ id: entityId, entityType: "legacy_wall_class", stableKey: wallClass, payload });
  facts.push({
    id: `fact:${SOURCE_ID}:wall_class:${shortHash(wallClass)}`,
    entityId,
    factType: "legacy_wall_class",
    payload,
    confidence: 0.55,
    trustTier: "historical",
    evidenceRef: stringValue(record.evidence_ref),
    sourceVersionId,
    status: "accepted",
  });
  chunks.push({
    id: `chunk:${SOURCE_ID}:wall_class:${shortHash(wallClass)}`,
    sourceId: SOURCE_ID,
    sourceVersionId,
    entityId,
    title: `Legacy wall class: ${wallClass}`,
    text: [wallClass, stringValue(record.title), stringValue(record.description), `c_controllable=${Boolean(record.c_controllable)}`]
      .filter(Boolean)
      .join("\n"),
    evidenceRef: stringValue(record.evidence_ref),
    payload,
  });
}

function addFunctionHint(
  record: LegacyKgRecord,
  currentFunctions: Map<string, CurrentFunction>,
  sourceVersionId: string,
  entities: GraphEntity[],
  facts: GraphFact[],
  edges: GraphEdge[],
  chunks: SearchChunk[],
): void {
  const addr = compact(stringValue(record.addr));
  if (!addr) return;
  const current = currentForRecord(currentFunctions, record);
  const legacySourcePath = stringValue(record.source_path);
  const targetEntityId = current?.entityId ?? legacyFunctionEntityId(addr);
  const payload = { ...record, current_function: current ?? null, historical_warning: "Legacy status/progress only; revalidate under the current dtk-template pipeline." };
  if (!current) entities.push({ id: targetEntityId, entityType: "legacy_function", stableKey: addr, payload: { addr }, replace: false });
  if (legacySourcePath) addLegacySourceFile(entities, legacySourcePath);
  facts.push({
    id: `fact:${SOURCE_ID}:function_hint:${shortHash(addr)}`,
    entityId: targetEntityId,
    factType: "legacy_function_status",
    payload,
    confidence: 0.35,
    trustTier: "historical",
    evidenceRef: stringValue(record.evidence_ref),
    sourceVersionId,
    status: "stale",
  });
  if (current?.fileEntityId) {
    edges.push(edge(current.fileEntityId, "HAS_LEGACY_FUNCTION_STATUS", targetEntityId, sourceVersionId, stringValue(record.evidence_ref), 0.25, "stale"));
  }
  if (legacySourcePath) {
    edges.push(edge(fileEntityId(legacySourcePath), "HAS_LEGACY_FUNCTION_STATUS", targetEntityId, sourceVersionId, stringValue(record.evidence_ref), 0.2, "stale"));
  }
  chunks.push({
    id: `chunk:${SOURCE_ID}:function_hint:${shortHash(addr)}`,
    sourceId: SOURCE_ID,
    sourceVersionId,
    entityId: current?.fileEntityId ?? targetEntityId,
    title: `Legacy function hint: ${addr}`,
    text: [
      addr,
      current?.symbol,
      current?.sourcePath ?? legacySourcePath,
      legacySourcePath && current?.sourcePath && legacySourcePath !== current.sourcePath ? `legacy_source_path=${legacySourcePath}` : "",
      stringValue(record.legacy_status),
      stringValue(record.legacy_wall_class),
      finiteText(record.legacy_byte_pct, "legacy_byte_pct"),
      stringValue(record.notes),
    ]
      .filter(Boolean)
      .join("\n"),
    evidenceRef: stringValue(record.evidence_ref),
    payload,
  });
  if (legacySourcePath && legacySourcePath !== current?.sourcePath) {
    chunks.push({
      id: `chunk:${SOURCE_ID}:function_hint:${shortHash(`${addr}:${legacySourcePath}`)}`,
      sourceId: SOURCE_ID,
      sourceVersionId,
      entityId: fileEntityId(legacySourcePath),
      title: `Legacy function hint for ${legacySourcePath}: ${addr}`,
      text: [
        addr,
        legacySourcePath,
        stringValue(record.legacy_status),
        stringValue(record.legacy_wall_class),
        finiteText(record.legacy_byte_pct, "legacy_byte_pct"),
        stringValue(record.notes),
      ]
        .filter(Boolean)
        .join("\n"),
      evidenceRef: stringValue(record.evidence_ref),
      payload,
    });
  }
}

function addLeverDoc(record: LegacyKgRecord, sourceVersionId: string, entities: GraphEntity[], facts: GraphFact[], chunks: SearchChunk[]): void {
  const entityId = `legacy_lever_doc:${shortHash(stringValue(record.evidence_ref, stringValue(record.id)))}`;
  const payload = { ...record, text: truncate(stringValue(record.text), 4000) };
  entities.push({ id: entityId, entityType: "legacy_lever_doc", stableKey: stringValue(record.evidence_ref, stringValue(record.id)), payload });
  facts.push({
    id: `fact:${SOURCE_ID}:lever_doc:${shortHash(entityId)}`,
    entityId,
    factType: "legacy_lever_doc",
    payload,
    confidence: 0.6,
    trustTier: "historical",
    evidenceRef: stringValue(record.evidence_ref),
    sourceVersionId,
    status: "accepted",
  });
  chunks.push({
    id: `chunk:${SOURCE_ID}:lever_doc:${shortHash(entityId)}`,
    sourceId: SOURCE_ID,
    sourceVersionId,
    entityId,
    title: stringValue(record.title, "Legacy lever catalog"),
    text: stringValue(record.text),
    evidenceRef: stringValue(record.evidence_ref),
    payload,
  });
}

function currentFunctionIndex(repoRoot: string): Map<string, CurrentFunction> {
  const reportPath = resolve(repoRoot, "build/GC6E01/report.json");
  const objdiffPath = resolve(repoRoot, "objdiff.json");
  if (!existsSync(reportPath) || !existsSync(objdiffPath)) return new Map();
  const sourceByUnit = objdiffSourceMap(readJson(objdiffPath));
  const report = readJson(reportPath);
  const index = new Map<string, CurrentFunction>();
  for (const unitValue of Array.isArray(report.units) ? report.units : []) {
    const unit = objectValue(unitValue);
    const unitName = stringValue(unit.name);
    if (!unitName) continue;
    const sourcePath = stringValue(objectValue(unit.metadata).source_path, sourceByUnit.get(unitName) ?? "");
    for (const fnValue of Array.isArray(unit.functions) ? unit.functions : []) {
      const fn = objectValue(fnValue);
      const symbol = stringValue(fn.name);
      if (!symbol) continue;
      const address = formatAddress(objectValue(fn.metadata).virtual_address);
      const current: CurrentFunction = {
        entityId: functionEntityId(unitName, symbol),
        fileEntityId: sourcePath ? fileEntityId(sourcePath) : undefined,
        sourcePath: sourcePath || undefined,
        symbol,
        unit: unitName,
        address,
        fuzzy: finiteNumber(fn.fuzzy_match_percent),
      };
      index.set(symbol, current);
      if (address) index.set(address.toLowerCase(), current);
      const fnAddress = symbol.match(/^fn_([0-9A-Fa-f]{8})$/)?.[1];
      if (fnAddress) index.set(`0x${fnAddress}`.toLowerCase(), current);
    }
  }
  return index;
}

function currentForRecord(currentFunctions: Map<string, CurrentFunction>, record: LegacyKgRecord): CurrentFunction | undefined {
  const addr = compact(stringValue(record.addr));
  return currentFunctions.get(addr) ?? currentFunctions.get(addr.toLowerCase()) ?? currentFunctions.get(addrToAddress(addr).toLowerCase());
}

function objdiffSourceMap(objdiff: Record<string, unknown>): Map<string, string> {
  const byUnit = new Map<string, string>();
  for (const unitValue of Array.isArray(objdiff.units) ? objdiff.units : []) {
    const unit = objectValue(unitValue);
    const name = stringValue(unit.name);
    const sourcePath = stringValue(objectValue(unit.metadata).source_path);
    if (name && sourcePath) byUnit.set(name, sourcePath);
  }
  return byUnit;
}

function leverEntityId(slug: string): string {
  return `legacy_lever:${slug}`;
}

function legacyFunctionEntityId(addr: string): string {
  return `legacy_function:${addr}`;
}

function addLegacySourceFile(entities: GraphEntity[], sourcePath: string): void {
  entities.push({
    id: fileEntityId(sourcePath),
    entityType: "source_file",
    stableKey: sourcePath,
    payload: { source_path: sourcePath, legacy_only: true },
    replace: false,
  });
}

function edge(from: string, type: string, to: string, sourceVersionId: string, evidenceRef: string, weight: number, status = "accepted"): GraphEdge {
  return {
    id: `edge:${type}:${shortHash(`${from}:${to}:${evidenceRef}`)}`,
    fromEntityId: from,
    edgeType: type,
    toEntityId: to,
    weight,
    evidenceRef,
    sourceVersionId,
    status,
  };
}

function sourcePathValue(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  if (text.startsWith("src/") || text.startsWith("include/") || text.startsWith("config/")) return text;
  return undefined;
}

function formatAddress(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
  if (typeof value === "string" && /^\d+$/.test(value)) return `0x${Number(value).toString(16).toUpperCase().padStart(8, "0")}`;
  return typeof value === "string" ? value : "";
}

function addrToAddress(value: string): string {
  const match = value.match(/^fn_([0-9A-Fa-f]{8})$/);
  return match ? `0x${match[1]}` : value;
}

function finiteText(value: unknown, label: string): string | undefined {
  const number = finiteNumber(value);
  return number === undefined ? undefined : `${label}=${number}`;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function optionalText(value: unknown): string | undefined {
  const text = compact(stringValue(value));
  return text ? text : undefined;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
