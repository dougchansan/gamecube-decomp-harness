import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { sourceDataRoot, sourceStorageRoot } from "../../paths.js";
import { fileEntityId } from "./code-graph.js";
import type { GraphEdge, GraphEntity, GraphFact, GraphRecords, SearchChunk, TrustTier } from "../types.js";
import { filesFingerprint, shortHash, stableJson, truncate } from "../util.js";

interface IndexedSliceRecord {
  id: string;
  title: string;
  text: string;
  evidenceRef: string;
  payload: Record<string, unknown>;
  linkedFilePaths?: string[];
  entityType?: string;
  entityKey?: string;
  trustTier?: TrustTier;
}

interface SourceBuildOptions {
  sourceId: string;
  trustTier: TrustTier;
  indexFileName: string;
  inputPaths: string[];
  records: IndexedSliceRecord[];
  defaultEntityType: string;
  factType: string;
  edgeType?: string;
}

const DOCUMENT_EXTENSIONS = new Set([".md", ".txt", ".text"]);
const FILE_MENTION_RE = /(?:^|[\s`"'(])((?:src|include|asm|config)\/[A-Za-z0-9_./+@-]+)\b/g;

export function buildPowerpcDocsGraphRecords(): GraphRecords | null {
  const sourceId = "powerpc_docs";
  const dataRoot = sourceDataRoot(sourceId);
  const pageIndex = resolve(dataRoot, "indexes/powerpc_pdf_pages.csv");
  if (!existsSync(pageIndex)) return null;
  const inputPaths = [pageIndex, ...recursiveFiles(resolve(dataRoot, "pdfs"))];
  const records: IndexedSliceRecord[] = [];

  for (const row of readCsvObjects(pageIndex)) {
    const documentId = stringField(row, "document_id") || stringField(row, "title") || "powerpc";
    const title = stringField(row, "title") || documentId;
    const page = stringField(row, "page");
    const text = stringField(row, "text");
    splitLongText(text, 3200).forEach((chunk, index) => {
      records.push({
        id: `${documentId}:page:${page}:chunk:${index + 1}`,
        title: `${title}: page ${page}${index ? ` chunk ${index + 1}` : ""}`,
        text: compactText([documentId, title, `page ${page}`, chunk]),
        evidenceRef: `${stringField(row, "pdf_path") || pageIndex}#page=${page}`,
        payload: {
          source_id: sourceId,
          document_id: documentId,
          title,
          pdf_path: stringField(row, "pdf_path"),
          page,
          chunk: index + 1,
          word_count: stringField(row, "word_count"),
        },
        linkedFilePaths: extractLinkedFilePaths(chunk),
        entityType: "powerpc_doc_page",
        entityKey: `${documentId}:${page}:${index + 1}`,
      });
    });
  }

  return buildIndexBackedGraphRecords({
    sourceId,
    trustTier: "reference",
    indexFileName: "pages.jsonl",
    inputPaths,
    records,
    defaultEntityType: "powerpc_doc_page",
    factType: "powerpc_reference",
    edgeType: "HAS_POWERPC_REFERENCE",
  });
}

export function buildDecompStandardsGraphRecords(): GraphRecords | null {
  const sourceId = "decomp_standards";
  const dataRoot = sourceDataRoot(sourceId);
  const dataFile = resolve(dataRoot, "standards.jsonl");
  const records = readJsonlObjects(dataFile).map((row) => {
    const text = compactText([
      stringField(row, "title"),
      stringField(row, "summary"),
      stringField(row, "family"),
      stringField(row, "disposition"),
      stringField(row, "qa_enforcement"),
      arrayField(row, "qa_rule_ids").join(" "),
      arrayField(row, "do").join(" "),
      arrayField(row, "do_not").join(" "),
      arrayField(row, "evidence_refs").join(" "),
    ]);
    return {
      id: stringField(row, "id") || shortHash(text),
      title: `Decomp standard: ${stringField(row, "title") || stringField(row, "id")}`,
      text,
      evidenceRef: arrayField(row, "evidence_refs").join(";") || dataFile,
      payload: { source_id: sourceId, record: row },
      linkedFilePaths: extractLinkedFilePaths(text),
      entityType: "decomp_standard",
      entityKey: stringField(row, "id") || shortHash(text),
    };
  });
  return buildIndexBackedGraphRecords({
    sourceId,
    trustTier: "reference",
    indexFileName: "standards.jsonl",
    inputPaths: [dataFile],
    records,
    defaultEntityType: "decomp_standard",
    factType: "decomp_standard",
    edgeType: "HAS_DECOMP_STANDARD",
  });
}

export function buildPathFactsGraphRecords(): GraphRecords | null {
  const sourceId = "path_facts";
  const dataRoot = sourceDataRoot(sourceId);
  const factsRoot = resolve(dataRoot, "path_facts");
  const factFiles = recursiveFiles(factsRoot).filter((path) => extname(path).toLowerCase() === ".jsonl");
  const sliceFiles = recursiveFiles(resolve(dataRoot, "slices")).filter((path) => DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase()));
  const inputPaths = [...factFiles, ...sliceFiles];
  const records: IndexedSliceRecord[] = [];
  for (const file of factFiles) {
    for (const row of readJsonlObjects(file)) {
      const text = compactText([
        stringField(row, "title"),
        stringField(row, "directory"),
        stringField(row, "summary"),
        arrayField(row, "scope_globs").join(" "),
        arrayField(row, "applies_when").join(" "),
        arrayField(row, "do").join(" "),
        arrayField(row, "do_not").join(" "),
        arrayField(row, "evidence_refs").join(" "),
        arrayField(row, "watched_paths").join(" "),
        stringField(row, "slice_ref"),
      ]);
      records.push({
        id: stringField(row, "id") || shortHash(text),
        title: `Path fact: ${stringField(row, "title") || stringField(row, "id")}`,
        text,
        evidenceRef: arrayField(row, "evidence_refs").join(";") || file,
        payload: { source_id: sourceId, source_file: relative(dataRoot, file), record: row },
        linkedFilePaths: [...new Set([...extractLinkedFilePaths(text), ...representativePathFactPaths(row)])].sort(),
        entityType: "path_fact",
        entityKey: stringField(row, "id") || shortHash(text),
      });
    }
  }
  return buildIndexBackedGraphRecords({
    sourceId,
    trustTier: "historical",
    indexFileName: "path_facts.jsonl",
    inputPaths,
    records,
    defaultEntityType: "path_fact",
    factType: "path_scoped_hint",
    edgeType: "HAS_PATH_FACT",
  });
}

function buildDocumentSource(options: {
  sourceId: string;
  trustTier: TrustTier;
  dataRoot: string;
  indexFileName: string;
  defaultEntityType: string;
}): GraphRecords | null {
  const files = recursiveFiles(options.dataRoot)
    .filter((path) => DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase()) || basename(path) === "SKILL.md")
    .filter((path) => !path.includes("/indexes/") && !path.includes("/tools/"));
  const records: IndexedSliceRecord[] = [];
  for (const file of files) {
    const relPath = relative(options.dataRoot, file);
    const text = readFileSync(file, "utf8");
    splitLongText(text, 3200).forEach((chunk, index) => {
      const heading = firstHeading(chunk);
      records.push({
        id: `${relPath}:chunk:${index + 1}`,
        title: `${sourceTitle(options.sourceId)}: ${relPath}${heading ? `: ${heading}` : ""}`,
        text: compactText([relPath, heading, chunk]),
        evidenceRef: `${file}#chunk=${index + 1}`,
        payload: { source_id: options.sourceId, path: relPath, chunk: index + 1, heading },
        linkedFilePaths: extractLinkedFilePaths(chunk),
        entityType: options.defaultEntityType,
        entityKey: `${relPath}:${index + 1}`,
      });
    });
  }
  return buildIndexBackedGraphRecords({
    sourceId: options.sourceId,
    trustTier: options.trustTier,
    indexFileName: options.indexFileName,
    inputPaths: files,
    records,
    defaultEntityType: options.defaultEntityType,
    factType: "document_reference",
    edgeType: "HAS_DOCUMENT_REFERENCE",
  });
}

function buildIndexBackedGraphRecords(options: SourceBuildOptions): GraphRecords | null {
  if (options.records.length === 0 || options.inputPaths.length === 0) {
    writeSourceIndex(options.sourceId, options.indexFileName, []);
    return null;
  }
  const sourceVersionId = `source-version:${options.sourceId}:${shortHash(filesFingerprint(options.inputPaths))}`;
  const entities: GraphEntity[] = [];
  const facts: GraphFact[] = [];
  const edges: GraphEdge[] = [];
  const chunks: SearchChunk[] = [];
  const indexRows: Array<Record<string, unknown>> = [];

  for (const record of options.records) {
    const resourceEntityId = resourceEntityIdFor(options.sourceId, record);
    const linkedFilePaths = [...new Set(record.linkedFilePaths ?? [])].sort();
    entities.push({
      id: resourceEntityId,
      entityType: record.entityType || options.defaultEntityType,
      stableKey: record.entityKey || record.id,
      payload: {
        source_id: options.sourceId,
        title: record.title,
        evidence_ref: record.evidenceRef,
        ...record.payload,
      },
    });
    facts.push({
      id: `fact:${options.sourceId}:${shortHash(record.id)}`,
      entityId: resourceEntityId,
      factType: options.factType,
      payload: {
        source_id: options.sourceId,
        title: record.title,
        evidence_ref: record.evidenceRef,
        linked_file_paths: linkedFilePaths,
        ...record.payload,
      },
      confidence: 0.55,
      trustTier: record.trustTier ?? options.trustTier,
      evidenceRef: record.evidenceRef,
      sourceVersionId,
    });
    for (const sourcePath of linkedFilePaths) {
      const fileEntity = fileEntityId(sourcePath);
      entities.push({
        id: fileEntity,
        entityType: "source_file",
        stableKey: sourcePath,
        payload: { source_path: sourcePath },
        replace: false,
      });
      edges.push({
        id: `edge:${options.edgeType ?? "HAS_RESOURCE_EVIDENCE"}:${shortHash(`${sourcePath}:${record.id}`)}`,
        fromEntityId: fileEntity,
        edgeType: options.edgeType ?? "HAS_RESOURCE_EVIDENCE",
        toEntityId: resourceEntityId,
        weight: 0.55,
        evidenceRef: record.evidenceRef,
        sourceVersionId,
      });
    }
    const chunkId = `chunk:${options.sourceId}:${shortHash(record.id)}`;
    const chunkEntityId = linkedFilePaths.length ? fileEntityId(linkedFilePaths[0]) : resourceEntityId;
    chunks.push({
      id: chunkId,
      sourceId: options.sourceId,
      sourceVersionId,
      entityId: chunkEntityId,
      title: record.title,
      text: truncate(record.text, 8000),
      evidenceRef: record.evidenceRef,
      payload: {
        source_id: options.sourceId,
        record_id: record.id,
        resource_entity_id: resourceEntityId,
        linked_file_paths: linkedFilePaths,
        ...record.payload,
      },
    });
    indexRows.push({
      id: record.id,
      source_id: options.sourceId,
      title: record.title,
      text: record.text,
      evidence_ref: record.evidenceRef,
      entity_id: chunkEntityId,
      resource_entity_id: resourceEntityId,
      linked_file_paths: linkedFilePaths,
      payload: record.payload,
    });
  }

  writeSourceIndex(options.sourceId, options.indexFileName, indexRows);
  return {
    sourceVersion: {
      id: sourceVersionId,
      sourceId: options.sourceId,
      contentHash: shortHash(filesFingerprint(options.inputPaths)),
      sourcePaths: options.inputPaths,
    },
    entities,
    facts,
    edges,
    chunks,
  };
}

function writeSourceIndex(sourceId: string, fileName: string, rows: Array<Record<string, unknown>>): void {
  const path = resolve(sourceStorageRoot(sourceId), "indexes", fileName);
  mkdirSync(dirname(path), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
}

function recursiveFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      if (basename(current) === ".git" || basename(current) === "node_modules") continue;
      for (const child of readdirSync(current)) stack.push(resolve(current, child));
    } else if (stat.isFile()) {
      out.push(current);
    }
  }
  return out.sort();
}

function directoryChildren(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((child) => resolve(root, child))
    .filter((path) => existsSync(path) && statSync(path).isDirectory())
    .sort();
}

function readCsvObjects(path: string): Array<Record<string, string>> {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header || `column_${index + 1}`] = row[index] ?? "";
    });
    return record;
  });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((csvRow) => csvRow.some((value) => value.trim()));
}

function readJsonlObjects(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) rows.push(parsed as Record<string, unknown>);
    } catch {
      // Ignore malformed JSONL rows; source and tool smoke checks expose bad indexes.
    }
  }
  return rows;
}

function splitLongText(input: string, maxChars: number): string[] {
  const text = input.replace(/\u0000/g, "").trim();
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  const parts = text.split(/(\n#{1,6}\s+[^\n]+|\n\s*\n)/g).filter((part) => part.length > 0);
  for (const part of parts) {
    if (current && current.length + part.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    if (part.length > maxChars) {
      for (let index = 0; index < part.length; index += maxChars) chunks.push(part.slice(index, index + maxChars).trim());
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function compactText(values: unknown[]): string {
  return values
    .map((value) => String(value ?? ""))
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  return typeof value === "string" ? value : "";
}

function arrayField(row: Record<string, unknown>, field: string): string[] {
  const value = row[field];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function representativePathFactPaths(row: Record<string, unknown>): string[] {
  const values = [...arrayField(row, "watched_paths"), ...arrayField(row, "scope_globs")];
  return values
    .map((value) => value.replace(/^\.\//, "").replace(/^\.\.\//, ""))
    .filter((value) => !value.includes("*"))
    .filter((value) => value.startsWith("src/") || value.startsWith("include/"))
    .slice(0, 12);
}

function extractLinkedFilePaths(text: string): string[] {
  const matches = [...text.matchAll(FILE_MENTION_RE)].map((match) => match[1]);
  return [...new Set(matches.map((path) => path.replace(/[),.;:]+$/, "")))].sort();
}

function firstHeading(text: string): string {
  const match = text.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function sourceTitle(sourceId: string): string {
  return sourceId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resourceEntityIdFor(sourceId: string, record: IndexedSliceRecord): string {
  return `resource:${sourceId}:${shortHash(`${record.entityType ?? ""}:${record.entityKey ?? record.id}`)}`;
}
