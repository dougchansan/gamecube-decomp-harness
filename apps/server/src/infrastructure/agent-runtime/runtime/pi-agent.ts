import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiPromptBundle, PiRunResult, RuntimeAgentRole } from "@server/core/shared/types";
import { loadLocalEnv } from "@server/infrastructure/env";
import { buildAgentTools, type AgentToolProfileInput, type AgentToolRuntimeContext } from "@server/core/tools/index.js";
import { applyProcessEnvPatch } from "./process-env.js";

export interface PiRunOptions {
  role: RuntimeAgentRole;
  cwd: string;
  prompt: PiPromptBundle;
  outputDir: string;
  dryRun: boolean;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  timeoutMs?: number;
  sessionDir?: string;
  env?: Record<string, string | undefined>;
  toolProfile?: AgentToolProfileInput;
  toolContext?: Partial<Omit<AgentToolRuntimeContext, "role" | "cwd">>;
  /** Pi built-in tool names to disable for this session (e.g. ["write"]). */
  excludeBuiltinTools?: string[];
  /** Custom JSONL entries to append immediately after the Pi session is created. */
  customSessionEntries?: PiCustomSessionEntry[];
  /** Custom type used for Pi lifecycle JSONL entries; omitted disables lifecycle markers. */
  piLifecycleCustomType?: string;
}

export interface PiCustomSessionEntry {
  customType: string;
  data?: Record<string, unknown>;
}

export const DEFAULT_PI_PROVIDER = "codex-lb";
export const DEFAULT_PI_MODEL = "gpt-5.5";
export const DEFAULT_PI_THINKING_LEVEL = "medium";
export const DEFAULT_PI_SESSION_DIR_NAME = ".pi-sessions";
export const CLAUDE_CODE_PROVIDER = "claude-code";

function packageRoot(): string {
  return fileURLToPath(new URL("../../../../../..", import.meta.url));
}

export function defaultPiSessionRoot(): string {
  return resolve(packageRoot(), DEFAULT_PI_SESSION_DIR_NAME);
}

export function defaultPiSessionDir(role: RuntimeAgentRole): string {
  return resolve(defaultPiSessionRoot(), role);
}

async function writeOutput(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

// The provider expects "xhigh"; "x-high"/"x_high" variants make it error and fall
// back to a different model, so normalize here where every agent's config flows through.
function normalizeThinkingLevel(level: string): string {
  const normalized = level.trim().toLowerCase();
  return normalized === "x-high" || normalized === "x_high" ? "xhigh" : normalized;
}

function piConfig(options: PiRunOptions): { provider: string; model: string; thinkingLevel: string } {
  return {
    provider: options.provider ?? DEFAULT_PI_PROVIDER,
    model: options.model ?? DEFAULT_PI_MODEL,
    thinkingLevel: normalizeThinkingLevel(options.thinkingLevel ?? DEFAULT_PI_THINKING_LEVEL),
  };
}

export function isClaudeCodeProvider(provider: string | undefined): boolean {
  return (provider ?? "").trim().toLowerCase() === CLAUDE_CODE_PROVIDER;
}

function dryRunTranscript(
  options: PiRunOptions,
  paths: { systemPromptPath: string; userPromptPath: string },
  customTools: Array<{ name: string }>,
): string {
  const config = piConfig(options);
  return [
    `[dry-run ${options.role} Pi agent]`,
    `cwd: ${options.cwd}`,
    `provider: ${config.provider}`,
    `model: ${config.model}`,
    `thinking: ${config.thinkingLevel}`,
    `session_dir: ${options.sessionDir ?? defaultPiSessionDir(options.role)}`,
    `env_overrides: ${Object.keys(options.env ?? {}).sort().join(", ") || "(none)"}`,
    `system_template: ${options.prompt.systemTemplatePath}`,
    `user_template: ${options.prompt.userTemplatePath}`,
    `system_prompt_artifact: ${paths.systemPromptPath}`,
    `user_prompt_artifact: ${paths.userPromptPath}`,
    `custom_tools: ${customTools.map((tool) => tool.name).join(", ") || "(none)"}`,
    `custom_session_entries: ${options.customSessionEntries?.map((entry) => entry.customType).join(", ") || "(none)"}`,
    `pi_lifecycle_custom_type: ${options.piLifecycleCustomType ?? "(none)"}`,
    "",
    "=== SYSTEM PROMPT ===",
    options.prompt.systemPrompt,
    "",
    "=== INITIAL USER PROMPT ===",
    options.prompt.userPrompt,
  ].join("\n");
}

function textFromContentPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const record = part as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") return record.text;
  if (record.type === "output_text" && typeof record.text === "string") return record.text;
  return "";
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  if (record.role && record.role !== "assistant") return "";
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textFromContentPart).join("");
  return "";
}

// Telemetry (Track B): coerce a possibly-missing usage field to a finite number.
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type SessionManagerWithCustomEntries = {
  appendCustomEntry?: (customType: string, data?: unknown) => string;
};

function appendCustomEntry(
  sessionManager: SessionManagerWithCustomEntries | undefined,
  customType: string,
  data?: unknown,
): void {
  if (typeof sessionManager?.appendCustomEntry !== "function") {
    console.warn(`Pi SessionManager cannot append custom entry ${customType}`);
    return;
  }
  sessionManager.appendCustomEntry(customType, data);
}

function attachPiLifecycleLogger(session: any, customType: string): (() => void) | undefined {
  const sessionManager = session?.sessionManager as SessionManagerWithCustomEntries | undefined;
  if (typeof session?.subscribe !== "function") return undefined;
  let turnIndex = 0;
  return session.subscribe((event: any) => {
    switch (event?.type) {
      case "agent_start":
        turnIndex = 0;
        appendCustomEntry(sessionManager, customType, { phase: "agent_start" });
        break;
      case "agent_end": {
        const messages = Array.isArray(event.messages) ? event.messages : [];
        const last = messages.at(-1) as { usage?: { input?: number; output?: number } } | undefined;
        appendCustomEntry(sessionManager, customType, {
          phase: "agent_end",
          inputTokens: last?.usage?.input,
          outputTokens: last?.usage?.output,
        });
        break;
      }
      case "turn_start":
        appendCustomEntry(sessionManager, customType, {
          phase: "turn_start",
          turnIndex,
        });
        break;
      case "turn_end":
        appendCustomEntry(sessionManager, customType, {
          phase: "turn_end",
          turnIndex,
          stopReason: event.message?.stopReason,
        });
        turnIndex += 1;
        break;
      default:
        break;
    }
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, message: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function claudeCodeModel(model: string | undefined): string {
  const normalized = (model ?? "").trim();
  if (!normalized) return "sonnet";
  if (/^claude-(?:3|4|opus|sonnet|haiku)/.test(normalized)) return normalized;
  if (/sonnet/i.test(normalized)) return "sonnet";
  if (/opus/i.test(normalized)) return "opus";
  if (/haiku/i.test(normalized)) return "haiku";
  return normalized;
}

function claudeCodeCompatibilityPrompt(systemPrompt: string): string {
  return [
    systemPrompt,
    "",
    "<claude_code_runtime_compatibility>",
    "This session is running under Claude Code CLI rather than the Pi custom-tool SDK.",
    "If the prompt names Pi custom tools such as checkdiff_run, direct_compile_tu, or knowledge graph tools, treat them as reference capabilities and use local Bash commands, canonical tool paths, and repository scripts instead.",
    "Do not report missing Pi custom tools as a blocker when equivalent local validation can be run.",
    "</claude_code_runtime_compatibility>",
  ].join("\n");
}

function claudeCodeToolArgs(options: PiRunOptions): string[] {
  const args: string[] = [];
  if (options.toolProfile?.replace && options.toolProfile.replace.length === 0) {
    args.push("--tools", "");
  }
  if (options.excludeBuiltinTools?.some((tool) => tool.toLowerCase() === "write")) {
    args.push("--disallowedTools", "Write");
  }
  return args;
}

function claudeCodeCommandArgs(options: PiRunOptions, paths: { systemPromptPath: string; sessionId: string }): string[] {
  const config = piConfig(options);
  const args = [
    "--print",
    "--model",
    claudeCodeModel(config.model),
    "--effort",
    config.thinkingLevel,
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--system-prompt-file",
    paths.systemPromptPath,
    "--session-id",
    paths.sessionId,
    "--name",
    `${options.role}-${paths.sessionId.slice(0, 8)}`,
  ];
  if (!(options.toolProfile?.replace && options.toolProfile.replace.length === 0)) {
    args.push("--dangerously-skip-permissions");
  }
  args.push(...claudeCodeToolArgs(options));
  return args;
}

function claudeCodeFailureText(params: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}): string {
  const parts = [
    `[Claude Code session failed]`,
    `exit_code: ${params.exitCode ?? "(none)"}`,
    `signal: ${params.signal ?? "(none)"}`,
  ];
  if (params.stderr.trim()) parts.push("", "=== STDERR ===", params.stderr.trimEnd());
  if (params.stdout.trim()) parts.push("", "=== STDOUT ===", params.stdout.trimEnd());
  return `${parts.join("\n")}\n`;
}

async function spawnClaudeCode(
  options: PiRunOptions,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs)
      : undefined;
    const child = spawn("claude", args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      signal: controller.signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${options.role} Claude Code session timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`));
      } else {
        reject(error);
      }
    });
    child.on("close", (exitCode, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode, signal });
    });
    child.stdin.end(options.prompt.userPrompt);
  });
}

function parseClaudeCodeJson(stdout: string): Record<string, any> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, any>;
  } catch {
    const lastLine = trimmed.split("\n").reverse().find((line) => line.trim().startsWith("{"));
    if (!lastLine) return null;
    try {
      return JSON.parse(lastLine) as Record<string, any>;
    } catch {
      return null;
    }
  }
}

async function runClaudeCodeAgent(options: PiRunOptions): Promise<PiRunResult> {
  const sessionId = randomUUID();
  const sessionDir = options.sessionDir ?? defaultPiSessionDir(options.role);
  const outputPath = resolve(options.outputDir, `${options.role}_${sessionId}.txt`);
  const systemPromptPath = resolve(options.outputDir, `${options.role}_${sessionId}.system.md`);
  const userPromptPath = resolve(options.outputDir, `${options.role}_${sessionId}.user.md`);
  const sessionFile = resolve(sessionDir, `${sessionId}.claude-code.json`);
  await mkdir(sessionDir, { recursive: true });
  await writeOutput(systemPromptPath, claudeCodeCompatibilityPrompt(options.prompt.systemPrompt));
  await writeOutput(userPromptPath, options.prompt.userPrompt);

  if (options.dryRun) {
    const rawText = [
      `[dry-run ${options.role} Claude Code agent]`,
      `cwd: ${options.cwd}`,
      `provider: ${CLAUDE_CODE_PROVIDER}`,
      `model: ${claudeCodeModel(options.model)}`,
      `thinking: ${normalizeThinkingLevel(options.thinkingLevel ?? DEFAULT_PI_THINKING_LEVEL)}`,
      `session_dir: ${sessionDir}`,
      `system_prompt_artifact: ${systemPromptPath}`,
      `user_prompt_artifact: ${userPromptPath}`,
      "",
      "=== SYSTEM PROMPT ===",
      claudeCodeCompatibilityPrompt(options.prompt.systemPrompt),
      "",
      "=== INITIAL USER PROMPT ===",
      options.prompt.userPrompt,
    ].join("\n");
    await writeOutput(outputPath, rawText);
    return {
      sessionId,
      sessionFile,
      sessionDir,
      outputPath,
      systemPromptPath,
      userPromptPath,
      rawText,
      dryRun: true,
    };
  }

  const args = claudeCodeCommandArgs(options, { systemPromptPath, sessionId });
  try {
    const result = await spawnClaudeCode(options, args);
    const parsed = parseClaudeCodeJson(result.stdout);
    await writeOutput(sessionFile, `${JSON.stringify({
      provider: CLAUDE_CODE_PROVIDER,
      model: claudeCodeModel(options.model),
      role: options.role,
      cwd: options.cwd,
      command: ["claude", ...args],
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      result: parsed,
    }, null, 2)}\n`);
    if (result.exitCode !== 0 || result.signal) {
      const failureText = claudeCodeFailureText(result);
      await writeOutput(outputPath, failureText);
      return {
        sessionId,
        sessionFile,
        sessionDir,
        outputPath,
        systemPromptPath,
        userPromptPath,
        rawText: failureText,
        dryRun: false,
        failed: true,
        error: result.signal ? `Claude Code exited on signal ${result.signal}` : `Claude Code exited with code ${result.exitCode}`,
      };
    }
    const outputText = typeof parsed?.result === "string" ? parsed.result : result.stdout;
    await writeOutput(outputPath, outputText);
    const providerError =
      parsed?.is_error === true
        ? String(parsed?.result ?? parsed?.api_error_status ?? "Claude Code returned an error")
        : undefined;
    // Telemetry (Track B): the claude-code CLI reports token usage under
    // `parsed.usage.*` (snake_case, cache fields) and `parsed.total_cost_usd`.
    // All optional — guard so a shape drift never throws in the worker.
    const usageRaw = (parsed?.usage ?? {}) as Record<string, unknown>;
    const usage: PiRunResult["usage"] = {
      inputTokens: finiteNumber(usageRaw.input_tokens),
      outputTokens: finiteNumber(usageRaw.output_tokens),
      cacheReadTokens: finiteNumber(usageRaw.cache_read_input_tokens),
      cacheWriteTokens: finiteNumber(usageRaw.cache_creation_input_tokens),
      costUsd: finiteNumber((parsed as Record<string, unknown> | undefined)?.total_cost_usd),
    };
    return {
      sessionId: typeof parsed?.session_id === "string" ? parsed.session_id : sessionId,
      sessionFile,
      sessionDir,
      outputPath,
      systemPromptPath,
      userPromptPath,
      rawText: outputText,
      dryRun: false,
      providerError,
      usage,
      endedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureText = `[Claude Code session failed]\n${message}\n`;
    await writeOutput(outputPath, failureText);
    await writeOutput(sessionFile, `${JSON.stringify({
      provider: CLAUDE_CODE_PROVIDER,
      model: claudeCodeModel(options.model),
      role: options.role,
      cwd: options.cwd,
      error: message,
    }, null, 2)}\n`);
    return {
      sessionId,
      sessionFile,
      sessionDir,
      outputPath,
      systemPromptPath,
      userPromptPath,
      rawText: failureText,
      dryRun: false,
      failed: true,
      error: message,
    };
  }
}

export async function runPiAgent(options: PiRunOptions): Promise<PiRunResult> {
  loadLocalEnv();
  if (isClaudeCodeProvider(options.provider)) {
    return runClaudeCodeAgent(options);
  }
  const sessionId = randomUUID();
  const outputPath = resolve(options.outputDir, `${options.role}_${sessionId}.txt`);
  const systemPromptPath = resolve(options.outputDir, `${options.role}_${sessionId}.system.md`);
  const userPromptPath = resolve(options.outputDir, `${options.role}_${sessionId}.user.md`);
  const toolContext: AgentToolRuntimeContext = {
    role: options.role,
    cwd: options.cwd,
    repoRoot: options.cwd,
    ...options.toolContext,
  };
  const customTools = buildAgentTools(toolContext, options.toolProfile);
  await writeOutput(systemPromptPath, options.prompt.systemPrompt);
  await writeOutput(userPromptPath, options.prompt.userPrompt);

  if (options.dryRun) {
    const rawText = dryRunTranscript(options, { systemPromptPath, userPromptPath }, customTools);
    await writeOutput(outputPath, rawText);
    return {
      sessionId,
      sessionDir: options.sessionDir ?? defaultPiSessionDir(options.role),
      outputPath,
      systemPromptPath,
      userPromptPath,
      rawText,
      dryRun: true,
    };
  }

  const pi = (await import("@earendil-works/pi-coding-agent")) as Record<string, any>;
  const config = piConfig(options);
  const sessionDir = options.sessionDir ?? defaultPiSessionDir(options.role);
  await mkdir(sessionDir, { recursive: true });
  const authStorage = pi.AuthStorage?.create?.();
  const modelRegistry = pi.ModelRegistry?.create?.(authStorage);
  const model = modelRegistry?.find?.(config.provider, config.model);
  if (!model) {
    throw new Error(`Pi model not found: ${config.provider}/${config.model}`);
  }
  const sessionManager = pi.SessionManager?.create?.(options.cwd, sessionDir);
  if (!sessionManager) {
    throw new Error("Pi SessionManager.create is unavailable; cannot persist session files");
  }
  let resourceLoader: any;
  if (typeof pi.DefaultResourceLoader === "function") {
    resourceLoader = new pi.DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: typeof pi.getAgentDir === "function" ? pi.getAgentDir() : options.cwd,
      systemPromptOverride: () => options.prompt.systemPrompt,
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload?.();
  }
  const previousCwd = process.cwd();
  const restoreEnv = applyProcessEnvPatch(options.env);
  let rawText = "";
  let finalAssistantText = "";
  let lastUsage: PiRunResult["usage"];
  let session: any;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeLifecycle: (() => void) | undefined;

  try {
    process.chdir(options.cwd);
    const created = await pi.createAgentSession({
      cwd: options.cwd,
      authStorage,
      model,
      modelRegistry,
      thinkingLevel: config.thinkingLevel,
      sessionManager,
      resourceLoader,
      customTools,
      ...(options.excludeBuiltinTools?.length ? { excludeTools: options.excludeBuiltinTools } : {}),
    });
    session = created.session;
    for (const entry of options.customSessionEntries ?? []) {
      appendCustomEntry(session.sessionManager, entry.customType, entry.data);
    }
    if (options.piLifecycleCustomType) {
      unsubscribeLifecycle = attachPiLifecycleLogger(session, options.piLifecycleCustomType);
    }

    let lastAssistantStopReason: string | undefined;
    let lastAssistantErrorMessage: string | undefined;
    unsubscribe = session.subscribe((event: any) => {
      if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        rawText += event.assistantMessageEvent.delta;
      }
      if (event?.type === "agent_end") {
        // Telemetry (Track B): hoist the final-turn token usage. Shape is the Pi
        // SDK's `usage.input`/`usage.output`; guard so a missing field is undefined.
        const messages = Array.isArray(event.messages) ? event.messages : [];
        const last = messages.at(-1) as { usage?: { input?: number; output?: number } } | undefined;
        if (last?.usage) {
          lastUsage = {
            inputTokens: typeof last.usage.input === "number" ? last.usage.input : undefined,
            outputTokens: typeof last.usage.output === "number" ? last.usage.output : undefined,
          };
        }
      }
      if (event?.type === "message_end" || event?.type === "turn_end") {
        const text = textFromMessage(event.message);
        if (text) finalAssistantText = text;
        const record = event.message as Record<string, unknown> | undefined;
        if (record?.role === "assistant") {
          lastAssistantStopReason = typeof record.stopReason === "string" ? record.stopReason : undefined;
          lastAssistantErrorMessage = typeof record.errorMessage === "string" ? record.errorMessage : undefined;
        }
      }
    });
    await withTimeout(
      session.prompt(options.prompt.userPrompt),
      options.timeoutMs,
      `${options.role} Pi session timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`,
    );
    const outputText = finalAssistantText || rawText;
    await writeOutput(outputPath, outputText);
    const providerError =
      lastAssistantStopReason === "error" ? lastAssistantErrorMessage ?? "provider ended the session with an error and no message" : undefined;
    return {
      sessionId: String(session.sessionId ?? sessionId),
      sessionFile: typeof session.sessionFile === "string" ? session.sessionFile : undefined,
      sessionDir,
      outputPath,
      systemPromptPath,
      userPromptPath,
      rawText: outputText,
      dryRun: false,
      providerError,
      usage: lastUsage,
      endedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outputText = finalAssistantText || rawText;
    const failureText = outputText ? `${outputText}\n\n[Pi session failed]\n${message}\n` : `[Pi session failed]\n${message}\n`;
    await writeOutput(outputPath, failureText);
    return {
      sessionId: String(session?.sessionId ?? sessionId),
      sessionFile: typeof session?.sessionFile === "string" ? session.sessionFile : undefined,
      sessionDir,
      outputPath,
      systemPromptPath,
      userPromptPath,
      rawText: failureText,
      dryRun: false,
      failed: true,
      error: message,
      usage: lastUsage,
      endedAt: new Date().toISOString(),
    };
  } finally {
    unsubscribeLifecycle?.();
    unsubscribe?.();
    session?.dispose?.();
    process.chdir(previousCwd);
    restoreEnv();
  }
}
