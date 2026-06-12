import { Tokenizr } from "tokenizr";
import type { PromptPreviewStats } from "@decomp-orchestrator/ui-contract";

const unresolvedPlaceholderPattern = /\{\{\s*[A-Z0-9_]+\s*\}\}|\{(?:pr_context_json|curator_context_json)\}/g;

function countPromptTokens(prompt: string): number {
  if (!prompt) return 0;

  const lexer = new Tokenizr();
  lexer.rule(/[ \t\r\n]+/, (ctx) => {
    ctx.ignore();
  });
  lexer.rule(/\{\{\s*[A-Z0-9_]+\s*\}\}/, (ctx) => {
    ctx.accept("placeholder");
  });
  lexer.rule(/\{(?:pr_context_json|curator_context_json)\}/, (ctx) => {
    ctx.accept("placeholder");
  });
  lexer.rule(/```[A-Za-z0-9_-]*/, (ctx) => {
    ctx.accept("code_fence");
  });
  lexer.rule(/<\/?[A-Za-z0-9_:-]+(?:\s+[A-Za-z0-9_:-]+(?:=(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s>]+))?)*\s*\/?>/, (ctx) => {
    ctx.accept("xml_tag");
  });
  lexer.rule(/"(?:\\.|[^"\\])*"/, (ctx) => {
    ctx.accept("string");
  });
  lexer.rule(/'(?:\\.|[^'\\])*'/, (ctx) => {
    ctx.accept("string");
  });
  lexer.rule(/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, (ctx) => {
    ctx.accept("number");
  });
  lexer.rule(/[A-Za-z_][A-Za-z0-9_:-]*/, (ctx) => {
    ctx.accept("word");
  });
  lexer.rule(/[^\s]/, (ctx) => {
    ctx.accept("punctuation");
  });

  lexer.input(prompt);
  return lexer.tokens().filter((token) => token.type !== "EOF").length;
}

export function promptStats(prompt: string): PromptPreviewStats {
  const unresolved = new Set<string>();
  for (const match of prompt.matchAll(unresolvedPlaceholderPattern)) {
    unresolved.add(match[0] ?? "");
  }
  return {
    tokens: countPromptTokens(prompt),
    unresolvedPlaceholders: [...unresolved].filter(Boolean).sort(),
  };
}
