import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  createSpawnAgent as defaultCreateSpawnAgent,
  type CreateSpawnAgentAdapters,
  type KernelSpawnAgent,
  type KernelSpawnOptions,
  type ParsedAgent,
} from "@agent-kernel/kernel/spawn-pipeline";
import {
  createSpawnContext as defaultCreateSpawnContext,
  type AgentContextResolver,
  type CreateSpawnContextParams,
  type SpawnContext,
} from "@agent-kernel/kernel/context";
import type { TraceEvent } from "@agent-kernel/protocol";
import type { PiRunResult } from "@server/core/shared/types";
import type { PiRunOptions } from "@server/infrastructure/agent-runtime/runtime";
import { applyProcessEnvPatch } from "@server/infrastructure/agent-runtime/runtime/process-env";

import type { ColosseumKernelBridgeConfig } from "./config.js";
import type {
  ColosseumKernelSpawnAdapter,
  ColosseumKernelSpawnContext,
  ColosseumKernelSpawnOptions,
} from "./kernel.js";
import { createColosseumLoaderCatalog } from "./loaders.js";

export type BuildColosseumKernelToolFactories = (
  piOptions: PiRunOptions,
) => ReturnType<CreateSpawnAgentAdapters["buildToolFactories"]>;

export const COLOSSEUM_KERNEL_MANAGED_RUN_MARKER_FIELD = "kernelManagedRun";

export type KernelSpawnAgentFactoryPort = (
  adapters: CreateSpawnAgentAdapters,
) => KernelSpawnAgent;

export type KernelTraceWriterSinkLike = {
  submit?: (event: TraceEvent) => unknown;
};

export interface ColosseumCreateSpawnAgentRuntime {
  db: unknown;
  config: Pick<ColosseumKernelBridgeConfig, "markerConfig" | "piSessionsDir">;
  traceWriter?: KernelTraceWriterSinkLike;
}

export interface CreateColosseumKernelSpawnAgentOptions {
  piOptions: PiRunOptions;
  parsedAgent: ParsedAgent;
  contextResolver?: AgentContextResolver | null;
  runtime: ColosseumCreateSpawnAgentRuntime;
  createSpawnAgent?: KernelSpawnAgentFactoryPort;
  createSpawnContext?: (params: CreateSpawnContextParams) => SpawnContext;
  loadAgentResolver?: (name: string) => Promise<AgentContextResolver | null>;
  buildToolFactories?: BuildColosseumKernelToolFactories;
  buildPrivateRegisterFactory?: CreateSpawnAgentAdapters["buildPrivateRegisterFactory"];
  logger?: CreateSpawnAgentAdapters["logger"];
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function defaultPiAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_CODING_AGENT_DIR;
  return configured ? expandTilde(configured) : join(homedir(), ".pi", "agent");
}

function modelOverride(
  piOptions: PiRunOptions,
  spawnOptions?: ColosseumKernelSpawnOptions,
): string | undefined {
  if (spawnOptions?.model) return spawnOptions.model;
  if (piOptions.provider && piOptions.model) return `${piOptions.provider}/${piOptions.model}`;
  return piOptions.model;
}

export function parsedAgentForColosseumKernelSpawn(
  parsedAgent: ParsedAgent,
  piOptions: PiRunOptions,
  spawnOptions?: ColosseumKernelSpawnOptions,
): ParsedAgent {
  const sourceEditingRoles = new Set(["worker", "integration-resolver", "pr-fixer", "qa-repair", "reconcile"]);
  const sourceEditingCoreTools = sourceEditingRoles.has(piOptions.role)
    ? ["read", "glob", "grep", "bash", "edit", "write"]
    : [];
  const disallowed = [
    ...(parsedAgent.frontmatter.disallowed_tools ?? []),
    ...(piOptions.excludeBuiltinTools ?? []),
  ];
  const model = modelOverride(piOptions, spawnOptions);
  return {
    ...parsedAgent,
    frontmatter: {
      ...parsedAgent.frontmatter,
      ...(model ? { model } : {}),
      ...(piOptions.thinkingLevel ? { thinking: piOptions.thinkingLevel } : {}),
      tools: [...new Set([...(parsedAgent.frontmatter.tools ?? []), ...sourceEditingCoreTools])],
      disallowed_tools: [...new Set(disallowed)],
    },
  };
}

function traceWriterSink(
  writer: KernelTraceWriterSinkLike | undefined,
): KernelSpawnOptions["traceWriter"] {
  if (typeof writer?.submit !== "function") return undefined;
  return {
    submit(event) {
      Promise.resolve(writer.submit?.(event)).catch((error) => {
        console.warn(
          `Agent Kernel trace event submit failed during spawn: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    },
  };
}

async function writeOutput(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function promptWithRenderedContext(piOptions: PiRunOptions, prompt: string): string {
  const renderedContext = piOptions.prompt.kernelContext?.renderedContext?.trim();
  if (!renderedContext) return prompt;
  const turnPrompt = prompt.trim();
  if (!turnPrompt || turnPrompt === renderedContext) return renderedContext;
  return `${renderedContext}\n\n${turnPrompt}`;
}

function resultPaths(piOptions: PiRunOptions, sessionId: string): Pick<
  PiRunResult,
  "outputPath" | "systemPromptPath" | "userPromptPath"
> {
  return {
    outputPath: resolve(piOptions.outputDir, `${piOptions.role}_${sessionId}.txt`),
    systemPromptPath: resolve(piOptions.outputDir, `${piOptions.role}_${sessionId}.system.md`),
    userPromptPath: resolve(piOptions.outputDir, `${piOptions.role}_${sessionId}.user.md`),
  };
}

function sessionDirFor(
  runtime: ColosseumCreateSpawnAgentRuntime,
  appSessionId: string,
  piOptions: PiRunOptions,
): string {
  return piOptions.sessionDir ?? join(runtime.config.piSessionsDir, appSessionId, piOptions.role);
}

function timeoutMessage(piOptions: PiRunOptions): string {
  return `${piOptions.role} Pi session timed out after ${Math.round((piOptions.timeoutMs ?? 0) / 1000)}s`;
}

function spawnSignalWithTimeout(
  signal: AbortSignal | undefined,
  piOptions: PiRunOptions,
): { signal?: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  if (!piOptions.timeoutMs || piOptions.timeoutMs <= 0) {
    return { signal, cleanup: () => {}, timedOut: () => false };
  }
  const controller = new AbortController();
  let didTimeOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new Error(timeoutMessage(piOptions)));
  }, piOptions.timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
    timedOut: () => didTimeOut,
  };
}

function buildKernelSpawnOptions({
  context,
  piOptions,
  runtime,
  spawnOptions,
}: {
  context: ColosseumKernelSpawnContext;
  piOptions: PiRunOptions;
  runtime: ColosseumCreateSpawnAgentRuntime;
  spawnOptions?: ColosseumKernelSpawnOptions;
}): KernelSpawnOptions {
  const appSessionId = context.appSessionId;
  if (!appSessionId) {
    throw new Error("Kernel createSpawnAgent strategy requires kernelContext.appSessionId");
  }
  const metadata = context.metadata ?? {};
  const lineage = context.containerLineage ?? [];
  const leaf = lineage.length > 0 ? lineage[lineage.length - 1] : undefined;
  const workingDir = context.workingDir ?? piOptions.cwd;
  const appSessionSlug =
    metadataString(metadata, "appSessionSlug") ??
    metadataString(metadata, "sessionId") ??
    metadataString(metadata, "runId") ??
    appSessionId;
  const appSessionDir =
    metadataString(metadata, "appSessionDir") ??
    metadataString(metadata, "stateDir") ??
    workingDir;

  return {
    workingDir,
    thinkingLevel: piOptions.thinkingLevel,
    signal: spawnOptions?.abortSignal,
    appSessionId,
    appSessionSlug,
    appSessionDir,
    traceWriter: traceWriterSink(runtime.traceWriter),
    piSessionsDir: runtime.config.piSessionsDir,
    piAgentDir: metadataString(metadata, "piAgentDir") ?? defaultPiAgentDir(),
    containerId: context.containerId,
    phase: context.phase ?? piOptions.role,
    displayLabel: leaf?.label ?? piOptions.role,
  };
}

function createAppSessionBinding(
  runtime: ColosseumCreateSpawnAgentRuntime,
  piOptions: PiRunOptions,
): CreateSpawnAgentAdapters["createAppSessionBinding"] {
  return (opts) => {
    if (!opts.appSessionId) return undefined;
    return {
      customType: runtime.config.markerConfig.sessionBinding,
      data: {
        appSessionId: opts.appSessionId,
        appSessionSlug: opts.appSessionSlug ?? opts.appSessionId,
        appSessionDir: opts.appSessionDir ?? opts.workingDir ?? piOptions.cwd,
        containerId: opts.containerId,
        phase: opts.phase ?? piOptions.role,
        agentName: piOptions.role,
        role: piOptions.role,
        displayLabel: opts.displayLabel ?? piOptions.role,
        workingDir: opts.workingDir ?? piOptions.cwd,
        outputDir: piOptions.outputDir,
        [COLOSSEUM_KERNEL_MANAGED_RUN_MARKER_FIELD]: true,
      },
    };
  };
}

export function createColosseumKernelSpawnAgent(
  options: CreateColosseumKernelSpawnAgentOptions,
): ColosseumKernelSpawnAdapter<PiRunResult> {
  const createSpawnAgent = options.createSpawnAgent ?? defaultCreateSpawnAgent;
  const createSpawnContext = options.createSpawnContext ?? defaultCreateSpawnContext;

  return async function spawnWithKernelCreateSpawnAgent(
    name,
    prompt,
    context,
    spawnOptions,
  ): Promise<PiRunResult> {
    const spawnContext: ColosseumKernelSpawnContext = context ?? {
      workingDir: options.piOptions.cwd,
      phase: options.piOptions.role,
    };
    if (name !== options.piOptions.role) {
      throw new Error(
        `Colosseum kernel spawn mismatch: expected ${options.piOptions.role}, got ${name}`,
      );
    }
    if (options.piOptions.dryRun) {
      throw new Error("Kernel createSpawnAgent strategy does not support Pi dryRun");
    }

    const parsedAgent = parsedAgentForColosseumKernelSpawn(
      options.parsedAgent,
      options.piOptions,
      spawnOptions,
    );
    const adapters: CreateSpawnAgentAdapters = {
      loadAgent(agentName) {
        if (agentName !== name) {
          throw new Error(`No Colosseum parsed agent loaded for "${agentName}"`);
        }
        return parsedAgent;
      },
      loadAgentResolver:
        options.loadAgentResolver ??
        (async (agentName) => (agentName === name ? options.contextResolver ?? null : null)),
      buildPrivateRegisterFactory:
        options.buildPrivateRegisterFactory ?? (async () => null),
      buildToolFactories: () => options.buildToolFactories?.(options.piOptions) ?? [],
      createContextCatalog: () => createColosseumLoaderCatalog(),
      createSpawnContext,
      getDb: () => options.runtime.db,
      createAppSessionBinding: createAppSessionBinding(options.runtime, options.piOptions),
      piLifecycleCustomType: options.runtime.config.markerConfig.lifecycle,
      logger: options.logger,
    };
    const kernelSpawn = createSpawnAgent(adapters);
    const timeoutSignal = spawnSignalWithTimeout(spawnOptions?.abortSignal, options.piOptions);
    const kernelOptions = buildKernelSpawnOptions({
      context: spawnContext,
      piOptions: options.piOptions,
      runtime: options.runtime,
      spawnOptions: {
        ...spawnOptions,
        abortSignal: timeoutSignal.signal,
      },
    });
    const userPrompt = promptWithRenderedContext(options.piOptions, prompt);
    const restoreEnv = applyProcessEnvPatch(options.piOptions.env);
    try {
      const result = await kernelSpawn(name, userPrompt, null, kernelOptions).finally(
        timeoutSignal.cleanup,
      );
      const sessionId = String((result.session as { sessionId?: unknown }).sessionId ?? randomUUID());
      const paths = resultPaths(options.piOptions, sessionId);
      await writeOutput(paths.systemPromptPath, parsedAgent.body);
      await writeOutput(paths.userPromptPath, userPrompt);
      await writeOutput(paths.outputPath, result.responseText);
      result.session.dispose?.();

      return {
        sessionId,
        sessionFile:
          typeof (result.session as { sessionFile?: unknown }).sessionFile === "string"
            ? (result.session as { sessionFile: string }).sessionFile
            : undefined,
        sessionDir: spawnContext.appSessionId
          ? sessionDirFor(options.runtime, spawnContext.appSessionId, options.piOptions)
          : undefined,
        ...paths,
        rawText: result.responseText,
        dryRun: false,
        failed: result.aborted ? true : undefined,
        error: result.aborted
          ? timeoutSignal.timedOut()
            ? timeoutMessage(options.piOptions)
            : "Pi session aborted"
          : undefined,
      };
    } finally {
      restoreEnv();
    }
  };
}
