import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type { LoaderDeclaration } from "@agent-kernel/kernel/context";
import type { PiPromptBundle } from "@server/core/shared/types";
import { globalStandardsPromptXml, standardExamplesPromptXml } from "@server/core/knowledge";
import { stableJson } from "@server/infrastructure/agent-runtime/runtime";
import {
  createInlineAgentContextResolver,
  rootContextLoaderDeclaration,
} from "@server/core/agent-catalog/kernel-context.js";
import { loadPreshipExhibits, preshipExhibitsPromptXml, type PreshipExhibit } from "./preship.js";

const loaders = [
  rootContextLoaderDeclaration,
  { kind: "pr-slice-diff", ref: "pr-slice-diff", label: "pr-slice-diff" },
  { kind: "review-lint-findings", ref: "review-lint-findings", label: "review-lint-findings" },
  { kind: "standard-examples", ref: "standard-examples", label: "standard-examples" },
] as const satisfies readonly LoaderDeclaration[];

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

export const PRESHIP_REVIEW_TURN_PROMPT = [
  "Use the injected pre-ship review context packet.",
  "Review the slice diff adversarially and return exactly one JSON object.",
].join(" ");

export const context = defineContext(
  createInlineAgentContextResolver(loaders, PRESHIP_REVIEW_TURN_PROMPT),
);

function schemaPath(): string {
  return fileURLToPath(new URL("./schema.json", import.meta.url));
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

function sliceDiffContext(options: PrPreshipReviewPromptOptions, sliceDiff: string): string {
  return [
    "<task>",
    `    Adversarial pre-ship review of PR slice \`${options.sliceId}\`.`,
    "    Find every reason the maintainer would reject this diff. Judge only the diff below.",
    "</task>",
    "",
    "<slice_diff>",
    "```diff",
    sliceDiff,
    "```",
    "</slice_diff>",
    "",
    "<output_contract>",
    "Use this top-level shape:",
    "",
    stableJson(JSON.parse(readFileSync(schemaPath(), "utf8"))),
    "</output_contract>",
    "",
    "Return exactly one JSON object.",
  ].join("\n");
}

export function buildPrPreshipReviewKernelContext(options: PrPreshipReviewPromptOptions): NonNullable<PiPromptBundle["kernelContext"]> {
  const sliceDiff = truncatedDiff(options.sliceDiff, options.diffCharLimit ?? PRESHIP_DIFF_CHAR_LIMIT);
  const lintJson = lintFindingsJson(options);
  const diffContext = sliceDiffContext(options, sliceDiff);
  const lintContext = `<lint_findings>\n\`\`\`json\n${lintJson}\n\`\`\`\n</lint_findings>`;
  const standardsContext = [
    globalStandardsPromptXml(),
    preshipExhibitsPromptXml(options.exhibits ?? loadPreshipExhibits()),
    standardExamplesForLint(options.lintFindings),
  ].join("\n\n");
  return {
    turnPrompt: PRESHIP_REVIEW_TURN_PROMPT,
    renderedContext: [standardsContext, lintContext, diffContext].join("\n\n"),
    inputs: [
      {
        loaderKind: "pr-slice-diff",
        inputRef: options.sliceId,
        content: diffContext,
      },
      {
        loaderKind: "review-lint-findings",
        inputRef: "review-lint-findings",
        content: lintContext,
      },
      {
        loaderKind: "standard-examples",
        inputRef: "review-standards-exhibits-examples",
        content: standardsContext,
      },
    ],
  };
}

export default context;
