import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SourceProgressClass = "ASM" | "STUB" | "REAL_C";

export interface FunctionSourceMapEntry {
  symbol: string;
  sourcePath: string;
  status: string;
  size: number;
  address: string;
}

interface BranchFrame {
  kind: "if0" | "if1" | "other";
  inElse: boolean;
}

const DEFAULT_FUNC_TU_MAP = "config/GC6E01/func_tu_map.json";
const DEFAULT_SYMBOLS = "config/GC6E01/symbols.txt";
const FUNCTION_DEF =
  /^[ \t]*((?:static\s+|asm\s+|inline\s+)*)((?:[A-Za-z_]\w*[\s*]+)+)(fn_[0-9A-Fa-f]+|[A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/;

export interface CanonicalFunctionSourceIdentity {
  canonicalSymbol: string;
  canonicalAddress: string | null;
  traceAlias: string | null;
  canonicalClass: SourceProgressClass | null;
  traceAliasClass: SourceProgressClass | null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text) return fallback;
  const parsed = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text, 16) : Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function loadFunctionSourceMap(repoRoot: string, relPath = DEFAULT_FUNC_TU_MAP): Map<string, FunctionSourceMapEntry> {
  const path = resolve(repoRoot, relPath);
  if (!existsSync(path)) return new Map();
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const root = recordValue(raw);
  const map = new Map<string, FunctionSourceMapEntry>();
  for (const [symbol, value] of Object.entries(root)) {
    const entry = recordValue(value);
    const sourcePath = normalizeRepoPath(stringValue(entry.src));
    if (!sourcePath) continue;
    map.set(symbol, {
      symbol,
      sourcePath,
      status: stringValue(entry.status, "UNKNOWN"),
      size: numberValue(entry.size),
      address: stringValue(entry.addr),
    });
  }
  return map;
}

function branchIsActive(stack: BranchFrame[]): boolean {
  for (const frame of stack) {
    if (frame.kind === "if0" && !frame.inElse) return false;
    if (frame.kind === "if1" && frame.inElse) return false;
  }
  return true;
}

function updateBranchStack(line: string, stack: BranchFrame[]): boolean {
  const text = line.trim();
  const ifMatch = /^#\s*if\s+(0|1)\b/.exec(text);
  if (ifMatch) {
    stack.push({ kind: ifMatch[1] === "0" ? "if0" : "if1", inElse: false });
    return true;
  }
  if (/^#\s*if\b/.test(text)) {
    stack.push({ kind: "other", inElse: false });
    return true;
  }
  if (/^#\s*else\b/.test(text)) {
    const top = stack.at(-1);
    if (top) top.inElse = true;
    return true;
  }
  if (/^#\s*endif\b/.test(text)) {
    stack.pop();
    return true;
  }
  return false;
}

function bodyClass(qualifiers: string, bodyText: string): SourceProgressClass {
  if (
    /\basm\b/.test(qualifiers) ||
    /\b__asm\b/.test(bodyText) ||
    /#\s*include\s+["<][^">]+(?:\.inc|\.s)[">]/.test(bodyText)
  ) {
    return "ASM";
  }
  const compact = bodyText.replace(/\s+/g, "");
  const bodyOnly = compact.replace(/}+$/, "");
  if (
    bodyOnly === "" ||
    /\/\*TODO/i.test(compact) ||
    /\/\*stub/i.test(compact) ||
    bodyOnly === "return;" ||
    /^return[-0-9xa-fA-F]*;?$/.test(bodyOnly) ||
    /^(?:return)?[A-Za-z_]\w*\([^;{}]*\);?$/.test(bodyOnly)
  ) {
    return "STUB";
  }
  return "REAL_C";
}

function functionDefinitionAt(lines: string[], start: number): { match: RegExpExecArray; braceLine: number } | null {
  const signature: string[] = [];
  for (let index = start; index < lines.length && index < start + 8; index += 1) {
    const line = lines[index] ?? "";
    if (index > start && /^\s*#/.test(line)) break;
    signature.push(line);
    const text = signature.join("\n");
    if (text.includes(";")) return null;
    const match = FUNCTION_DEF.exec(text);
    if (!match) {
      if (text.includes("{")) return null;
      continue;
    }

    let braceLine = index;
    while (braceLine < lines.length && !String(lines[braceLine]).includes("{") && braceLine < index + 4) {
      braceLine += 1;
    }
    if (braceLine >= lines.length || !String(lines[braceLine]).includes("{")) return null;
    return { match, braceLine };
  }
  return null;
}

export function classifySourceText(text: string): Map<string, SourceProgressClass> {
  const lines = text.split(/\r?\n/);
  const stack: BranchFrame[] = [];
  const classes = new Map<string, SourceProgressClass>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (updateBranchStack(line, stack)) continue;
    if (!branchIsActive(stack)) continue;
    const definition = functionDefinitionAt(lines, i);
    if (!definition) continue;
    const { match, braceLine } = definition;
    const qualifiers = match[1] ?? "";
    const symbol = match[3] ?? "";
    if (!symbol) continue;

    const bodyParts: string[] = [];
    let depth = 0;
    for (let j = braceLine; j < lines.length && j < braceLine + 240; j += 1) {
      const bodyLine = lines[j] ?? "";
      bodyParts.push(j === braceLine ? bodyLine.slice(bodyLine.indexOf("{") + 1) : bodyLine);
      depth += (bodyLine.match(/\{/g) ?? []).length - (bodyLine.match(/\}/g) ?? []).length;
      if (depth <= 0) break;
    }
    classes.set(symbol, bodyClass(qualifiers, bodyParts.join("\n")));
  }
  return classes;
}

export function classifyFunctionInFile(path: string, symbol: string): SourceProgressClass | null {
  if (!path || !symbol || !existsSync(path)) return null;
  return classifySourceText(readFileSync(path, "utf8")).get(symbol) ?? null;
}

function canonicalFunctionAddress(repoRoot: string, symbol: string, relPath = DEFAULT_SYMBOLS): string | null {
  const path = resolve(repoRoot, relPath);
  if (!symbol || !existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_]\w*)\s*=\s*\.text:0x([0-9A-Fa-f]+)\s*;\s*\/\/.*\btype:function\b/.exec(line);
    if (!match || match[1] !== symbol) continue;
    return `0x${String(match[2]).toUpperCase().padStart(8, "0")}`;
  }
  return null;
}

/**
 * Classify the canonical function and its address-style trace alias in one
 * source file. The alias is derived only from the canonical function address
 * in symbols.txt; similarly named or same-file functions are never inferred as
 * replacements.
 */
export function classifyCanonicalFunctionSource(
  repoRoot: string,
  path: string,
  canonicalSymbol: string,
): CanonicalFunctionSourceIdentity {
  const classes = path && existsSync(path) ? classifySourceText(readFileSync(path, "utf8")) : new Map<string, SourceProgressClass>();
  const canonicalAddress = canonicalFunctionAddress(repoRoot, canonicalSymbol);
  const traceAlias = canonicalAddress ? `fn_${canonicalAddress.slice(2)}` : null;
  const distinctTraceAlias = traceAlias && traceAlias !== canonicalSymbol ? traceAlias : null;
  return {
    canonicalSymbol,
    canonicalAddress,
    traceAlias: distinctTraceAlias,
    canonicalClass: classes.get(canonicalSymbol) ?? null,
    traceAliasClass: distinctTraceAlias ? classes.get(distinctTraceAlias) ?? null : null,
  };
}

export function classifySourceFunctions(repoRoot: string, sourceMap: Map<string, FunctionSourceMapEntry>): Map<string, SourceProgressClass> {
  const files = new Set<string>();
  for (const entry of sourceMap.values()) {
    if (!entry.sourcePath.endsWith(".c")) continue;
    const absPath = resolve(repoRoot, entry.sourcePath);
    if (existsSync(absPath)) files.add(absPath);
  }

  const classes = new Map<string, SourceProgressClass>();
  for (const file of files) {
    for (const [symbol, klass] of classifySourceText(readFileSync(file, "utf8"))) {
      classes.set(symbol, klass);
    }
  }
  return classes;
}
