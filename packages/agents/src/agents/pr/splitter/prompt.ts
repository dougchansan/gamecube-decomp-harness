import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PiPromptBundle, RunProjectMetadata } from "@decomp-orchestrator/core/types";
import { globalStandardsPromptXml } from "@decomp-orchestrator/knowledge";
import { readTemplate, renderTemplate, stableJson, type PromptTemplateValues } from "../../../runtime/index.js";
import { availableToolsPromptXml, type AgentToolRuntimeContext } from "../../../tools/index.js";

export const PR_SPLITTER_SCHEMA_VERSION = "melee_pr_splitter_plan_v1";

export type PrSplitterLane = "match" | "local" | null;
export type PrSplitterIndependenceKind = "independent" | "shared-prep" | "stacked" | "needs-merge";

export interface PrSplitterSlice {
  id: string;
  display_name: string;
  title: string;
  lane: PrSplitterLane;
  scope: string;
  files: string[];
  depends_on: string[];
  independence_kind: PrSplitterIndependenceKind;
  review_focus: string;
  pr_body_summary: string;
  risks: string[];
  validation_notes: string[];
}

export interface PrSplitterPlan {
  schema_version: typeof PR_SPLITTER_SCHEMA_VERSION;
  slices: PrSplitterSlice[];
  warnings: string[];
  rationale: string;
  confidence: number;
}

export interface PrSplitterPromptOptions {
  splitContext: unknown;
  project?: RunProjectMetadata;
  repoRoot?: string;
  stateDir?: string;
}

function templatePath(name: "system" | "initial_user" | "schema"): string {
  return fileURLToPath(new URL(name === "schema" ? "./schema.json" : `./templates/${name}.md`, import.meta.url));
}

function toolContext(options: PrSplitterPromptOptions): AgentToolRuntimeContext {
  const repoRoot = options.repoRoot ?? ".";
  return {
    role: "pr-splitter",
    cwd: repoRoot,
    repoRoot,
    stateDir: options.stateDir,
    project: options.project,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function laneValue(value: unknown): PrSplitterLane | undefined {
  if (value === null) return null;
  if (value === "match" || value === "local") return value;
  return undefined;
}

function independenceValue(value: unknown): PrSplitterIndependenceKind | null {
  if (value === "independent" || value === "shared-prep" || value === "stacked" || value === "needs-merge") return value;
  return null;
}

function validateSlice(value: unknown, index: number, errors: string[]): PrSplitterSlice | null {
  const label = `slices[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  const id = stringValue(value.id);
  const displayName = stringValue(value.display_name);
  const title = stringValue(value.title);
  const lane = laneValue(value.lane);
  const scope = stringValue(value.scope);
  const files = stringArray(value.files);
  const dependsOn = stringArray(value.depends_on);
  const independenceKind = independenceValue(value.independence_kind);
  const reviewFocus = stringValue(value.review_focus);
  const prBodySummary = stringValue(value.pr_body_summary);
  const risks = stringArray(value.risks);
  const validationNotes = stringArray(value.validation_notes);

  if (!id) errors.push(`${label}.id must be a non-empty string`);
  if (!displayName) errors.push(`${label}.display_name must be a non-empty string`);
  if (!title) errors.push(`${label}.title must be a non-empty string`);
  if (lane === undefined) errors.push(`${label}.lane must be "match", "local", or null`);
  if (!scope) errors.push(`${label}.scope must be a non-empty string`);
  if (!files || files.length === 0) errors.push(`${label}.files must be a non-empty string array`);
  if (!dependsOn) errors.push(`${label}.depends_on must be a string array`);
  if (!independenceKind) errors.push(`${label}.independence_kind is invalid`);
  if (typeof value.review_focus !== "string") errors.push(`${label}.review_focus must be a string`);
  if (typeof value.pr_body_summary !== "string") errors.push(`${label}.pr_body_summary must be a string`);
  if (!risks) errors.push(`${label}.risks must be a string array`);
  if (!validationNotes) errors.push(`${label}.validation_notes must be a string array`);
  if (errors.length > 0 || lane === undefined || !files || !dependsOn || !independenceKind || !risks || !validationNotes) return null;

  return {
    id,
    display_name: displayName,
    title,
    lane,
    scope,
    files,
    depends_on: dependsOn,
    independence_kind: independenceKind,
    review_focus: reviewFocus,
    pr_body_summary: prBodySummary,
    risks,
    validation_notes: validationNotes,
  };
}

export function validatePrSplitterPlan(value: unknown): { plan: PrSplitterPlan | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { plan: null, errors: ["plan must be a JSON object"] };
  if (value.schema_version !== PR_SPLITTER_SCHEMA_VERSION) errors.push(`schema_version must be "${PR_SPLITTER_SCHEMA_VERSION}"`);
  if (!Array.isArray(value.slices) || value.slices.length === 0) errors.push("slices must be a non-empty array");
  const warnings = stringArray(value.warnings);
  if (!warnings) errors.push("warnings must be a string array");
  const rationale = stringValue(value.rationale);
  if (typeof value.rationale !== "string") errors.push("rationale must be a string");
  const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence) ? value.confidence : NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push("confidence must be a number from 0 to 1");
  const slices = Array.isArray(value.slices) ? value.slices.map((slice, index) => validateSlice(slice, index, errors)) : [];
  if (errors.length > 0 || !warnings) return { plan: null, errors };
  return {
    plan: {
      schema_version: PR_SPLITTER_SCHEMA_VERSION,
      slices: slices as PrSplitterSlice[],
      warnings,
      rationale,
      confidence,
    },
    errors: [],
  };
}

export function prSplitterPrompt(options: PrSplitterPromptOptions): PiPromptBundle {
  const systemTemplatePath = templatePath("system");
  const userTemplatePath = templatePath("initial_user");
  const values = {
    AVAILABLE_TOOLS_XML: availableToolsPromptXml(toolContext(options)),
    DECOMP_STANDARDS_XML: globalStandardsPromptXml(),
    PR_SPLITTER_CONTEXT_JSON: stableJson(options.splitContext),
    PR_SPLITTER_OUTPUT_SCHEMA_JSON: stableJson(JSON.parse(readFileSync(templatePath("schema"), "utf8"))),
  } as unknown as PromptTemplateValues;
  return {
    systemPrompt: renderTemplate(readTemplate(systemTemplatePath), values),
    userPrompt: renderTemplate(readTemplate(userTemplatePath), values),
    systemTemplatePath,
    userTemplatePath,
  };
}
