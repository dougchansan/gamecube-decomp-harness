import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { packageRoot, sourceDataRoot } from "./paths.js";
import { readJsonl } from "./graph/util.js";

type JsonRecord = Record<string, unknown>;

const STRENGTH_SCORE: Record<string, number> = {
  strong_hint: 30,
  medium_hint: 20,
  weak_hint: 10,
};

const FINAL_AUTHORITY =
  "Current source, headers, symbols, splits, assembly, objdiff, and regression output outrank global standards and path facts.";

export interface PathFactResolution {
  source: "path_facts";
  path: string;
  limit: number;
  matched_fact_ids: string[];
  excluded_fact_ids: string[];
  facts: JsonRecord[];
  trust_rule: string;
  resolve_command: string;
}

export interface StandardExampleSelector {
  standardIds?: Iterable<string>;
  qaRuleIds?: Iterable<string>;
  limit?: number;
}

export function globalStandardsContext(): Record<string, unknown> {
  const records = loadGlobalStandards();
  return {
    source: "decomp_standards",
    status: records.length ? "ready" : "missing_records",
    standard_count: records.length,
    accepted_standard_count: records.filter((record) => record.status === "accepted").length,
    trust_rule: FINAL_AUTHORITY,
    mutation_policy: "proposal_only_until_validated",
    search_command: "python3 knowledge/sources/injectable/decomp_standards/api/search.py --query <query> --limit 10 --json",
    standards: records.map((record) => ({
      id: record.id,
      status: record.status,
      family: record.family,
      disposition: record.disposition,
      severity: record.severity,
      qa_enforcement: record.qa_enforcement,
      worker_facing: record.worker_facing,
      retired_into: record.retired_into,
      title: record.title,
      summary: stringArray(record.summary),
      qa_rule_ids: stringArray(record.qa_rule_ids),
      do: stringArray(record.do),
      do_not: stringArray(record.do_not),
      evidence_refs: stringArray(record.evidence_refs),
    })),
  };
}

export function loadStandardExamples(): JsonRecord[] {
  return readJsonl(resolve(sourceDataRoot("decomp_standards"), "examples.jsonl"));
}

export function standardExamplesPromptXml(selector: StandardExampleSelector = {}): string {
  const standardIds = new Set([...(selector.standardIds ?? [])].filter(Boolean));
  const qaRuleIds = new Set([...(selector.qaRuleIds ?? [])].filter(Boolean));
  const hasFilter = standardIds.size > 0 || qaRuleIds.size > 0;
  const examples = loadStandardExamples()
    .filter((record) => {
      if (!hasFilter) return true;
      const standardId = stringValue(record.standard_id);
      const qaRuleId = stringValue(record.qa_rule_id);
      return (standardId && standardIds.has(standardId)) || (qaRuleId && qaRuleIds.has(qaRuleId));
    })
    .slice(0, Math.max(0, selector.limit ?? 12));

  const lines = [
    `<standard_examples count="${examples.length}">`,
    "    <instruction>Use these examples only after a lint finding, repair item, or pre-ship concern identifies the relevant standard or rule. Do not dump examples into ordinary worker reasoning.</instruction>",
  ];
  for (const example of examples) {
    const attrs = [
      optionalXmlAttribute("id", example.id),
      optionalXmlAttribute("standard_id", example.standard_id),
      optionalXmlAttribute("qa_rule_id", example.qa_rule_id),
      optionalXmlAttribute("severity", example.severity),
    ].filter(Boolean);
    lines.push(`    <example ${attrs.join(" ")}>`);
    lines.push(`        <bad_pattern>${xmlText(example.bad_pattern)}</bad_pattern>`);
    lines.push(`        <preferred_shape>${xmlText(example.preferred_shape)}</preferred_shape>`);
    lines.push("        <description>");
    for (const item of standardExampleDescription(example)) {
      lines.push(`            - ${xmlText(item)}`);
    }
    lines.push("        </description>");
    if (example.evidence_ref) {
      lines.push(`        <evidence_ref>${xmlText(example.evidence_ref)}</evidence_ref>`);
    }
    lines.push("    </example>");
  }
  lines.push("</standard_examples>");
  return lines.join("\n");
}

export function globalStandardsPromptXml(): string {
  const records = loadGlobalStandards().filter((record) => record.status === "accepted" && record.worker_facing !== false);
  const lines = [
    "<decomp_standards>",
    "    <instruction>All code changes must conform to the active code-quality standards below. Detailed examples are routed to QA repair and pre-ship review after a finding identifies the relevant standard.</instruction>",
    `    <authority>${xmlText(FINAL_AUTHORITY)}</authority>`,
  ];

  for (const record of records) {
    const attrs = [
      `id="${xmlAttribute(promptStandardId(record.id))}"`,
      optionalXmlAttribute("family", record.family),
      optionalXmlAttribute("severity", record.severity),
      optionalXmlAttribute("qa_enforcement", record.qa_enforcement),
    ].filter(Boolean);
    lines.push(`    <standard ${attrs.join(" ")}>`);
    lines.push("        <summary>");
    for (const item of stringArray(record.summary)) {
      lines.push(`            - ${xmlText(item)}`);
    }
    lines.push("        </summary>");
    lines.push("        <do>");
    for (const item of stringArray(record.do)) {
      lines.push(`            - ${xmlText(item)}`);
    }
    lines.push("        </do>");
    lines.push("        <do_not>");
    for (const item of stringArray(record.do_not)) {
      lines.push(`            - ${xmlText(item)}`);
    }
    lines.push("        </do_not>");
    lines.push("    </standard>");
  }

  lines.push("</decomp_standards>");
  return lines.join("\n");
}

export function resolvePathFactsContext(sourcePath: string, limit = 5): PathFactResolution {
  const normalizedPath = normalizeMeleePath(sourcePath);
  const scored: Array<{ score: number; fact: JsonRecord }> = [];
  for (const fact of loadPathFacts()) {
    if (fact.status !== "accepted") continue;
    const score = matchScore(normalizedPath, fact);
    if (score > 0) scored.push({ score, fact });
  }
  scored.sort((left, right) => right.score - left.score || String(left.fact.id).localeCompare(String(right.fact.id)));
  const matches = scored.slice(0, Math.max(0, limit)).map(({ fact, score }) => formatPathFact(fact, score));
  const excluded = scored.slice(Math.max(0, limit)).map(({ fact }) => String(fact.id ?? ""));
  return {
    source: "path_facts",
    path: normalizedPath,
    limit,
    matched_fact_ids: matches.map((fact) => String(fact.id ?? "")),
    excluded_fact_ids: excluded,
    facts: matches,
    trust_rule: FINAL_AUTHORITY,
    resolve_command: `python3 knowledge/sources/injectable/path_facts/api/resolve_for_path.py --path ${shellQuote(normalizedPath)} --limit ${limit} --json`,
  };
}

function loadGlobalStandards(): JsonRecord[] {
  return readJsonl(resolve(sourceDataRoot("decomp_standards"), "standards.jsonl"));
}

function loadPathFacts(): JsonRecord[] {
  const root = resolve(sourceDataRoot("path_facts"), "path_facts");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) => readJsonl(resolve(root, file)).map((row) => ({ ...row, source_file: `knowledge/sources/injectable/path_facts/data/path_facts/${file}` })));
}

function formatPathFact(fact: JsonRecord, score: number): JsonRecord {
  return {
    id: fact.id,
    title: fact.title,
    directory: fact.directory,
    score,
    strength: fact.strength,
    scope_globs: stringArray(fact.scope_globs),
    summary: fact.summary,
    do: stringArray(fact.do),
    do_not: stringArray(fact.do_not),
    evidence_refs: stringArray(fact.evidence_refs),
    watched_paths: stringArray(fact.watched_paths),
    slice_ref: fact.slice_ref,
  };
}

function matchScore(path: string, fact: JsonRecord): number {
  let best = 0;
  for (const rawGlob of stringArray(fact.scope_globs)) {
    const glob = normalizeMeleePath(rawGlob);
    if (!globMatches(glob, path)) continue;
    const components = glob.split("/").filter((part) => part && part !== "**" && !part.includes("*"));
    let score = 100 + components.length * 5;
    if (glob === path) score += 100;
    if (glob.endsWith("/**") && path.startsWith(glob.slice(0, -3))) score += 15;
    best = Math.max(best, score);
  }
  if (best === 0) return 0;
  return best + (STRENGTH_SCORE[String(fact.strength ?? "")] ?? 0);
}

function globMatches(glob: string, path: string): boolean {
  if (!glob.includes("*")) return glob === path;
  if (glob.endsWith("/**") && path.startsWith(glob.slice(0, -3))) return true;
  const pattern = glob
    .split("")
    .map((char, index, chars) => {
      if (char !== "*") return escapeRegExp(char);
      if (chars[index + 1] === "*") return "";
      if (chars[index - 1] === "*") return ".*";
      return "[^/]*";
    })
    .join("");
  return new RegExp(`^${pattern}$`).test(path);
}

function normalizeMeleePath(path: string): string {
  let value = path.trim().replace(/\\/g, "/");
  const sourceMarker = "/src/melee/";
  const includeMarker = "/include/";
  if (value.includes(sourceMarker)) value = `src/melee/${value.split(sourceMarker, 2)[1]}`;
  if (value.includes(includeMarker)) value = `include/${value.split(includeMarker, 2)[1]}`;
  value = value.replace(/^\.\//, "").replace(/^\.\.\//, "");
  if (value.startsWith(`${basename(packageRoot())}/`)) value = value.slice(basename(packageRoot()).length + 1);
  return value;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  const text = stringValue(value).trim();
  return text ? [text] : [];
}

function standardExampleDescription(record: JsonRecord): string[] {
  const description = stringArray(record.description).filter((item) => item.trim());
  if (description.length > 0) return description;
  const legacyWhy = stringValue(record.why).trim();
  return legacyWhy ? [legacyWhy] : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function promptStandardId(value: unknown): string {
  return String(value ?? "").replace(/^global_standard:/, "");
}

function xmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlAttribute(value: unknown): string {
  return xmlText(value).replace(/"/g, "&quot;");
}

function optionalXmlAttribute(name: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return `${name}="${xmlAttribute(value)}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
