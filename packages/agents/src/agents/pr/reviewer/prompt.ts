import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PiPromptBundle } from "@decomp-orchestrator/core/types";
import { globalStandardsPromptXml, standardExamplesPromptXml } from "@decomp-orchestrator/knowledge";
import { readTemplate, renderTemplate, stableJson, type PromptTemplateValues } from "../../../runtime/index.js";
import { loadPreshipExhibits, preshipExhibitsPromptXml, type PreshipExhibit } from "./preship.js";

function preshipTemplatePath(name: "preship_system" | "preship_user" | "preship_schema"): string {
  return fileURLToPath(new URL(name === "preship_schema" ? "./templates/preship_schema.json" : `./templates/${name}.md`, import.meta.url));
}

/**
 * The slice diff is the whole review subject; keep it large but bounded so a
 * sweeping slice cannot blow out the prompt. Truncation is announced inline so
 * the reviewer knows its evidence is incomplete.
 */
export const PRESHIP_DIFF_CHAR_LIMIT = 150_000;

export interface PrPreshipReviewPromptOptions {
  sliceId: string;
  /** Unified diff text for the slice (git diff <base> <head> -- <pathspecs>). */
  sliceDiff: string;
  /** Parsed QA scan result (or any JSON-able lint payload) for the slice. */
  lintFindings?: unknown;
  /** Set when the deterministic lint tool could not run; included verbatim. */
  lintUnavailableNote?: string;
  /** Override the static curated exhibits (Phase 4 retrieval hook). */
  exhibits?: PreshipExhibit[];
  diffCharLimit?: number;
}

function truncatedDiff(diff: string, limit: number): string {
  if (diff.length <= limit) return diff;
  const omitted = diff.length - limit;
  return `${diff.slice(0, limit)}\n\n[diff truncated after ${limit} characters; ${omitted} characters omitted. Treat truncation as reduced evidence, not approval.]`;
}

function lintFindingsJson(options: PrPreshipReviewPromptOptions): string {
  if (options.lintUnavailableNote) {
    return stableJson({ lint_available: false, note: options.lintUnavailableNote });
  }
  return stableJson({ lint_available: true, result: options.lintFindings ?? null });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectLintSelectors(
  value: unknown,
  selectors: { standardIds: Set<string>; qaRuleIds: Set<string> },
  depth = 0,
): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectLintSelectors(item, selectors, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.standard_id === "string" && value.standard_id) selectors.standardIds.add(value.standard_id);
  if (typeof value.rule_id === "string" && value.rule_id) selectors.qaRuleIds.add(value.rule_id);
  for (const item of Object.values(value)) collectLintSelectors(item, selectors, depth + 1);
}

function standardExamplesForLint(lintFindings: unknown): string {
  const selectors = { standardIds: new Set<string>(), qaRuleIds: new Set<string>() };
  collectLintSelectors(lintFindings, selectors);
  if (selectors.standardIds.size === 0 && selectors.qaRuleIds.size === 0) {
    return standardExamplesPromptXml({ limit: 12 });
  }
  return standardExamplesPromptXml({
    standardIds: selectors.standardIds,
    qaRuleIds: selectors.qaRuleIds,
    limit: 12,
  });
}

export function prPreshipReviewPrompt(options: PrPreshipReviewPromptOptions): PiPromptBundle {
  const systemTemplatePath = preshipTemplatePath("preship_system");
  const userTemplatePath = preshipTemplatePath("preship_user");
  const values = {
    SLICE_ID: options.sliceId,
    DECOMP_STANDARDS_XML: globalStandardsPromptXml(),
    EXHIBITS_XML: preshipExhibitsPromptXml(options.exhibits ?? loadPreshipExhibits()),
    STANDARD_EXAMPLES_XML: standardExamplesForLint(options.lintFindings),
    SLICE_DIFF: truncatedDiff(options.sliceDiff, options.diffCharLimit ?? PRESHIP_DIFF_CHAR_LIMIT),
    LINT_FINDINGS_JSON: lintFindingsJson(options),
    PRESHIP_OUTPUT_SCHEMA_JSON: stableJson(JSON.parse(readFileSync(preshipTemplatePath("preship_schema"), "utf8"))),
  } as unknown as PromptTemplateValues;
  return {
    systemPrompt: renderTemplate(readTemplate(systemTemplatePath), values),
    userPrompt: renderTemplate(readTemplate(userTemplatePath), values),
    systemTemplatePath,
    userTemplatePath,
  };
}
