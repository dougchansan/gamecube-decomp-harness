import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiPromptBundle, RunProjectMetadata } from "@decomp-orchestrator/core/types";
import { globalStandardsPromptXml } from "@decomp-orchestrator/knowledge";
import { readTemplate, renderTemplate, stableJson } from "../../../runtime/index.js";
import { availableToolsPromptXml, type AgentToolRuntimeContext } from "../../../tools/index.js";

export interface PrIndexerPromptOptions {
  prContext: unknown;
  project?: RunProjectMetadata;
  repoRoot?: string;
  stateDir?: string;
}

function templatePath(name: "system" | "initial_user" | "schema"): string {
  return fileURLToPath(new URL(name === "schema" ? "./schema.json" : `./templates/${name}.md`, import.meta.url));
}

function toolContext(options: PrIndexerPromptOptions): AgentToolRuntimeContext {
  const repoRoot = options.repoRoot ?? ".";
  return {
    role: "pr-indexer",
    cwd: repoRoot,
    repoRoot,
    stateDir: options.stateDir,
    project: options.project,
  };
}

const PR_CONTEXT_FILE_CHAR_LIMIT = 24_000;
const PR_CONTEXT_MAX_LOADED_FILES = 10;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
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

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function optionalAttribute(name: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return ` ${name}="${xmlAttribute(value)}"`;
}

function jsonBlockXml(tag: string, value: unknown, indent = "    "): string {
  return [`${indent}<${tag}>`, "```json", stableJson(value), "```", `${indent}</${tag}>`].join("\n");
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(compactValue)
      .filter((item) => {
        if (item === null || item === undefined || item === "") return false;
        if (Array.isArray(item)) return item.length > 0;
        if (typeof item === "object") return Object.keys(item as JsonRecord).length > 0;
        return true;
      });
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .map(([key, entry]) => [key, compactValue(entry)] as const)
        .filter(([, entry]) => {
          if (entry === null || entry === undefined || entry === "") return false;
          if (Array.isArray(entry)) return entry.length > 0;
          if (typeof entry === "object") return Object.keys(entry as JsonRecord).length > 0;
          return true;
        }),
    );
  }
  return value;
}

function compactObject(value: JsonRecord): JsonRecord {
  return compactValue(value) as JsonRecord;
}

function clippedContent(content: string, limit = PR_CONTEXT_FILE_CHAR_LIMIT): { content: string; truncated: boolean; originalChars: number } {
  if (content.length <= limit) return { content, truncated: false, originalChars: content.length };
  return { content: `${content.slice(0, limit)}\n\n[truncated after ${limit} characters]`, truncated: true, originalChars: content.length };
}

function resolveContextPath(pathValue: string, repoRoot: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(repoRoot, pathValue);
}

function readLoadedFile(label: string, pathValue: string, repoRoot: string, limit = PR_CONTEXT_FILE_CHAR_LIMIT): JsonRecord {
  const absolutePath = resolveContextPath(pathValue, repoRoot);
  const attrs = compactObject({
    label,
    path: pathValue,
    absolute_path: absolutePath,
  });
  if (!existsSync(absolutePath)) {
    return { ...attrs, unavailable: true, reason: "File not found." };
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    return { ...attrs, unavailable: true, reason: "Path is not a file." };
  }
  const loaded = clippedContent(readFileSync(absolutePath, "utf8"), limit);
  return {
    ...attrs,
    original_chars: loaded.originalChars,
    truncated: loaded.truncated,
    content: loaded.content,
  };
}

function loadedFilesFromInline(context: JsonRecord): JsonRecord[] {
  return asRecordArray(context.loaded_files).map((file, index) => {
    const label = optionalString(file.label) ?? optionalString(file.name) ?? `loaded_file_${index + 1}`;
    const content = optionalString(file.content) ?? optionalString(file.text) ?? "";
    const loaded = clippedContent(content);
    return compactObject({
      label,
      path: optionalString(file.path),
      media_type: optionalString(file.media_type),
      source: optionalString(file.source),
      original_chars: file.original_chars ?? loaded.originalChars,
      truncated: Boolean(file.truncated) || loaded.truncated,
      content: loaded.content,
    });
  });
}

function loadedFilesFromLocalSlicePaths(context: JsonRecord, repoRoot: string): JsonRecord[] {
  const localSlicePaths = asRecord(context.local_slice_paths);
  return Object.entries(localSlicePaths)
    .slice(0, PR_CONTEXT_MAX_LOADED_FILES)
    .map(([label, pathValue]) => optionalString(pathValue) && readLoadedFile(label, optionalString(pathValue) ?? "", repoRoot))
    .filter((file): file is JsonRecord => Boolean(file));
}

function knownSliceFileCandidates(context: JsonRecord): Array<{ label: string; path: string }> {
  const source = asRecord(context.source);
  const sliceDir = optionalString(source.slice_dir);
  if (!sliceDir) return [];
  return [
    { label: "raw_pr_json", path: `${sliceDir}/raw/pr.json` },
    { label: "raw_diff", path: `${sliceDir}/raw/diff.diff` },
    { label: "human_pr_text", path: `${sliceDir}/extracted/human_pr_text.md` },
    { label: "review_comments", path: `${sliceDir}/extracted/review_comments.md` },
    { label: "changed_files", path: `${sliceDir}/extracted/changed_files.jsonl` },
    { label: "text_corpus", path: `${sliceDir}/extracted/text_corpus.jsonl` },
    { label: "counts", path: `${sliceDir}/counts.json` },
    { label: "activity", path: `${sliceDir}/activity.json` },
  ];
}

function dedupeLoadedFiles(files: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const deduped: JsonRecord[] = [];
  for (const file of files) {
    const key = optionalString(file.path) ?? optionalString(file.label) ?? String(deduped.length);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(file);
    if (deduped.length >= PR_CONTEXT_MAX_LOADED_FILES) break;
  }
  return deduped;
}

function loadedFilesFromContext(context: JsonRecord, repoRoot: string): JsonRecord[] {
  const inlineFiles = loadedFilesFromInline(context);
  const pathFiles = inlineFiles.length ? [] : loadedFilesFromLocalSlicePaths(context, repoRoot);
  const knownFiles =
    inlineFiles.length || pathFiles.length
      ? []
      : knownSliceFileCandidates(context)
          .filter((candidate) => existsSync(resolveContextPath(candidate.path, repoRoot)))
          .map((candidate) => readLoadedFile(candidate.label, candidate.path, repoRoot));
  return dedupeLoadedFiles([...inlineFiles, ...pathFiles, ...knownFiles]);
}

function loadedFilesXml(context: JsonRecord, repoRoot: string): string {
  const files = loadedFilesFromContext(context, repoRoot);
  if (!files.length) return '    <loaded_files count="0" />';
  const lines = [`    <loaded_files count="${files.length}">`];
  for (const file of files) {
    const content = optionalString(file.content) ?? "";
    const attrs = [
      optionalAttribute("label", optionalString(file.label)),
      optionalAttribute("path", optionalString(file.path)),
      optionalAttribute("media_type", optionalString(file.media_type)),
      optionalAttribute("truncated", file.truncated === undefined ? null : String(Boolean(file.truncated))),
      optionalAttribute("original_chars", file.original_chars),
      optionalAttribute("unavailable", file.unavailable === undefined ? null : String(Boolean(file.unavailable))),
    ].join("");
    lines.push(`        <file${attrs}>`);
    if (file.unavailable) {
      lines.push(`            <reason>${xmlText(file.reason)}</reason>`);
    } else {
      lines.push(cdata(content));
    }
    lines.push("        </file>");
  }
  lines.push("    </loaded_files>");
  return lines.join("\n");
}

function prMetadata(context: JsonRecord): JsonRecord {
  return compactObject({
    schema_version: context.schema_version,
    object_id: context.object_id,
    generated_at: context.generated_at,
    context_source: context.context_source,
    project: context.project,
    source: context.source,
    pr: context.pr,
    counts: context.counts,
    activity: context.activity,
    initial_classification: context.initial_classification,
    changed_files: context.changed_files,
    review_feedback_examples: context.review_feedback_examples,
    intake_focus: context.intake_focus,
  });
}

function evidenceExcerptsXml(context: JsonRecord): string {
  const excerptFields = [
    ["human_pr_text_excerpt", context.human_text_excerpt],
    ["review_comments_excerpt", context.review_comments_excerpt],
    ["diff_excerpt", context.diff_excerpt],
  ] as const;
  const lines = ["    <evidence_excerpts>"];
  for (const [tag, value] of excerptFields) {
    const text = optionalString(value);
    if (!text) continue;
    lines.push(`        <${tag}>`);
    lines.push(cdata(text));
    lines.push(`        </${tag}>`);
  }
  lines.push("    </evidence_excerpts>");
  return lines.join("\n");
}

export function prContextPromptXml(options: { prContext: unknown; repoRoot?: string }): string {
  const context = asRecord(options.prContext);
  const repoRoot = options.repoRoot ?? ".";
  const attrs = [optionalAttribute("schema_version", context.schema_version), optionalAttribute("object_id", context.object_id)].join("");
  return [`<pr_context${attrs}>`, jsonBlockXml("metadata_json", prMetadata(context)), evidenceExcerptsXml(context), loadedFilesXml(context, repoRoot), "</pr_context>"].join("\n");
}

export function prIndexerPrompt(options: PrIndexerPromptOptions): PiPromptBundle {
  const systemTemplatePath = templatePath("system");
  const userTemplatePath = templatePath("initial_user");
  const values = {
    AVAILABLE_TOOLS_XML: availableToolsPromptXml(toolContext(options)),
    DECOMP_STANDARDS_XML: globalStandardsPromptXml(),
    PR_CONTEXT_JSON: stableJson(options.prContext),
    PR_CONTEXT_XML: prContextPromptXml({ prContext: options.prContext, repoRoot: options.repoRoot }),
    PR_OUTPUT_SCHEMA_JSON: stableJson(JSON.parse(readFileSync(templatePath("schema"), "utf8"))),
  };
  return {
    systemPrompt: renderTemplate(readTemplate(systemTemplatePath), values),
    userPrompt: renderTemplate(readTemplate(userTemplatePath), values),
    systemTemplatePath,
    userTemplatePath,
  };
}
