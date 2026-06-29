export interface WorkerReviewLintFinding {
  ruleId: string;
  severity: "error";
  path: string;
  evidence: string;
  message: string;
}

export interface WorkerReviewLint {
  status: "passed" | "failed" | "skipped";
  reasons: string[];
  findings: WorkerReviewLintFinding[];
}

const DIFF_FILE_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const ADDED_DEFINE_ALIAS_RE = /^\+\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()\s+([A-Za-z_][A-Za-z0-9_]*)\b\s*(?:$|\/\/|\/\*)/;
const ADDRESS_EXTERN_RE = /^([ +])\s*\/\*\s*(?:0x)?([0-9A-Fa-f]{6,8})\s*\*\/\s*extern\b.*?\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[.*\])?\s*;/;
const C_STRING_LITERAL_RE = /"(?:(?:\\.)|[^"\\])*"/g;
const IDENTIFIER_EXPR_RE = "(?:\\(\\s*(?:const\\s+)?(?:char|void)\\s*\\*+\\s*\\)\\s*)?([A-Za-z_][A-Za-z0-9_]*)";

interface AddressExtern {
  address: string;
  name: string;
  added: boolean;
  evidence: string;
}

interface RemovedStringLine {
  body: string;
  evidence: string;
}

export function lintWorkerReviewDiff(diffText: string): WorkerReviewLint {
  if (!diffText.trim()) {
    return { status: "skipped", reasons: ["empty write_set diff"], findings: [] };
  }

  const findings: WorkerReviewLintFinding[] = [];
  const externsByPath = new Map<string, AddressExtern[]>();
  let removedStringLines: RemovedStringLine[] = [];
  let currentPath = "";

  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = DIFF_FILE_RE.exec(line);
    if (fileMatch) {
      currentPath = fileMatch[2];
      removedStringLines = [];
      continue;
    }
    if (!currentPath) continue;
    if (line.startsWith("@@")) {
      removedStringLines = [];
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      const body = line.slice(1);
      if (isCSourcePath(currentPath) && bodyHasStringLiteral(body)) {
        removedStringLines.push({ body, evidence: body.trim() });
      }
      continue;
    }

    const defineMatch = ADDED_DEFINE_ALIAS_RE.exec(line);
    if (defineMatch && (looksLikeVariableIdentifier(defineMatch[1]) || looksLikeVariableIdentifier(defineMatch[2]))) {
      findings.push({
        ruleId: "no-define-alias-global-renames",
        severity: "error",
        path: currentPath,
        evidence: line.slice(1).trim(),
        message: `Avoid renaming variables with #define aliases: ${defineMatch[1]} -> ${defineMatch[2]}.`,
      });
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const addedBody = line.slice(1);
      for (const removedLine of removedStringLines) {
        const replacement = stringLiteralReplacement(removedLine.body, addedBody);
        if (!replacement) continue;
        findings.push({
          ruleId: "no-string-literal-symbol-regression",
          severity: "error",
          path: currentPath,
          evidence: `${removedLine.evidence} -> ${addedBody.trim()}`,
          message: `Keep string literal ${replacement.literal} inline instead of replacing it with ${replacement.identifier}.`,
        });
      }
    } else if (line.startsWith(" ")) {
      removedStringLines = [];
    }

    const externMatch = ADDRESS_EXTERN_RE.exec(line);
    if (externMatch) {
      const entries = externsByPath.get(currentPath) ?? [];
      entries.push({
        address: externMatch[2].toUpperCase(),
        name: externMatch[3],
        added: externMatch[1] === "+",
        evidence: line.slice(1).trim(),
      });
      externsByPath.set(currentPath, entries);
    }
  }

  for (const [path, entries] of externsByPath) {
    const byAddress = new Map<string, AddressExtern[]>();
    for (const entry of entries) {
      const grouped = byAddress.get(entry.address) ?? [];
      grouped.push(entry);
      byAddress.set(entry.address, grouped);
    }
    for (const [address, grouped] of byAddress) {
      const names = [...new Set(grouped.map((entry) => entry.name))].sort();
      if (names.length <= 1 || !grouped.some((entry) => entry.added)) continue;
      findings.push({
        ruleId: "duplicate-address-extern-alias",
        severity: "error",
        path,
        evidence: grouped.map((entry) => entry.evidence).join(" | "),
        message: `Address-commented extern 0x${address} appears under multiple names: ${names.join(", ")}.`,
      });
    }
  }

  return {
    status: findings.length ? "failed" : "passed",
    reasons: findings.map((finding) => `${finding.ruleId}: ${finding.message}`),
    findings,
  };
}

function looksLikeVariableIdentifier(identifier: string): boolean {
  return /^[a-z]/.test(identifier) || /^(?:fn|lbl|un)_[0-9A-Fa-f_]+$/.test(identifier) || /_[0-9A-Fa-f]{6,8}$/.test(identifier);
}

function isCSourcePath(path: string): boolean {
  return /\.(?:c|h)$/i.test(path);
}

function bodyHasStringLiteral(body: string): boolean {
  C_STRING_LITERAL_RE.lastIndex = 0;
  return C_STRING_LITERAL_RE.test(body);
}

function stringLiteralReplacement(removedBody: string, addedBody: string): { literal: string; identifier: string } | null {
  C_STRING_LITERAL_RE.lastIndex = 0;
  for (const match of removedBody.matchAll(C_STRING_LITERAL_RE)) {
    const literal = match[0];
    const prefix = removedBody.slice(0, match.index);
    const suffix = removedBody.slice((match.index ?? 0) + literal.length);
    const replacementMatch = new RegExp(`^\\s*${codeFragmentPattern(prefix)}\\s*${IDENTIFIER_EXPR_RE}\\s*${codeFragmentPattern(suffix)}\\s*$`).exec(addedBody);
    const identifier = replacementMatch?.[1];
    if (identifier && looksLikeVariableIdentifier(identifier)) {
      return { literal, identifier };
    }
  }
  return null;
}

function codeFragmentPattern(fragment: string): string {
  let pattern = "";
  for (const char of fragment.trim()) {
    pattern += /\s/.test(char) ? "\\s*" : escapeRegExp(char);
  }
  return pattern;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
