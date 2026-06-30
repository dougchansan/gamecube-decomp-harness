import { TraceLevel, type EventData } from "@agent-kernel/protocol";
import type { AgentContextResolver } from "@agent-kernel/kernel/context";
import type { ParsedAgent } from "@agent-kernel/kernel/spawn-pipeline";
import type { PiRunResult, RuntimeAgentRole } from "@server/core/shared/types";
import type { PiRunOptions } from "@server/infrastructure/agent-runtime/runtime";
import { buildAgentTools, type AgentToolRuntimeContext } from "@server/core/tools";
import {
  meleeKernelAgent,
  toKernelParsedAgentFromBundle,
  type KernelAgentId,
} from "@server/core/agent-catalog/kernel-catalog";

import {
  createMeleeKernel,
  type MeleeKernelSpawnContext,
  type MeleeKernelSpawnOptions,
} from "@server/infrastructure/kernel/bridge/kernel";
import {
  createMeleeKernelSpawnAgent,
  type BuildMeleeKernelToolFactories,
  type KernelSpawnAgentFactoryPort,
} from "@server/infrastructure/kernel/bridge/spawn-agent";
import { createMeleeKernelBridgeConfig } from "@server/infrastructure/kernel/bridge/config";
import { meleeKernelRuntimeRequiredFromEnv } from "@server/infrastructure/kernel/bridge/database";
import {
  getDefaultMeleeKernelRuntime,
  type MeleeKernelRuntime,
} from "@server/infrastructure/kernel/bridge/runtime";
import type { MeleeTraceWriter } from "@server/infrastructure/kernel/bridge/trace-writer";
import { runPiAgent } from "./runtime/pi-agent.js";

export const MELEE_AGENT_SPAWN_STARTED_EVENT = "melee:agent_spawn_started";
export const MELEE_AGENT_SPAWN_COMPLETED_EVENT = "melee:agent_spawn_completed";
export const MELEE_AGENT_SPAWN_FAILED_EVENT = "melee:agent_spawn_failed";

export type MeleeKernelSpawnStrategy = "auto" | "kernel";

export interface MeleeKernelAgentCatalogEntry {
  name: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  thinking?: string | null;
}

export interface KernelPromptBundleConversion {
  parsed: ParsedAgent;
  userPrompt: string;
  contextResolver?: AgentContextResolver | null;
}

export type ResolveMeleeKernelAgent = (role: RuntimeAgentRole) => MeleeKernelAgentCatalogEntry;

export type ConvertMeleeKernelPromptBundle = (
  entry: MeleeKernelAgentCatalogEntry,
  bundle: PiRunOptions["prompt"],
) => KernelPromptBundleConversion;

export type MeleeKernelSpawnTraceWriter =
  Pick<MeleeTraceWriter, "submitAppEvent"> &
  Partial<Pick<MeleeTraceWriter, "submit">>;
export interface MeleeKernelSpawnRuntime {
  config?: Pick<MeleeKernelRuntime["config"], "markerConfig" | "piSessionsDir">;
  db?: unknown;
  traceWriter?: MeleeKernelSpawnTraceWriter;
  upsertSpawnContainers?: MeleeKernelRuntime["upsertSpawnContainers"];
}

export interface MeleeKernelPiRunOptions extends PiRunOptions {
  autoInitializeKernelRuntime?: boolean;
  kernelContext?: MeleeKernelSpawnContext;
  kernelOptions?: MeleeKernelSpawnOptions;
  kernelRuntime?: MeleeKernelSpawnRuntime | null;
  kernelSpawnStrategy?: MeleeKernelSpawnStrategy;
  traceWriter?: MeleeKernelSpawnTraceWriter;
}

export type PiRunAgentPort = (options: PiRunOptions) => Promise<PiRunResult>;

export interface CreateMeleeKernelPiAgentRunnerOptions {
  buildToolFactories?: BuildMeleeKernelToolFactories;
  createKernelSpawnAgent?: KernelSpawnAgentFactoryPort;
  resolveKernelAgent?: ResolveMeleeKernelAgent;
  runPiAgent?: PiRunAgentPort;
  toKernelParsedAgentFromBundle?: ConvertMeleeKernelPromptBundle;
}

function defaultKernelAgent(role: RuntimeAgentRole): MeleeKernelAgentCatalogEntry {
  return {
    name: role,
    model: undefined,
    tools: [],
    disallowedTools: [],
    thinking: null,
  };
}

function defaultParsedAgentFromBundle(
  entry: MeleeKernelAgentCatalogEntry,
  bundle: PiRunOptions["prompt"],
): KernelPromptBundleConversion {
  return {
    parsed: {
      frontmatter: {
        name: entry.name,
        description: "",
        model: entry.model ?? "unspecified",
        tools: entry.tools ?? [],
        disallowed_tools: entry.disallowedTools ?? [],
        variables: {},
        thinking: entry.thinking ?? undefined,
      },
      body: bundle.systemPrompt,
    },
    userPrompt: bundle.userPrompt,
    contextResolver: null,
  };
}

function defaultKernelContext(options: PiRunOptions): MeleeKernelSpawnContext {
  return {
    workingDir: options.cwd,
    phase: options.role,
    metadata: {
      role: options.role,
      outputDir: options.outputDir,
      dryRun: options.dryRun,
    },
  };
}

function kernelOptionsFor(options: PiRunOptions, overrides?: MeleeKernelSpawnOptions): MeleeKernelSpawnOptions {
  const provider = options.provider ?? undefined;
  const model = options.model ?? undefined;
  return {
    timeoutMs: options.timeoutMs,
    model: provider && model ? `${provider}/${model}` : model,
    ...overrides,
    metadata: {
      role: options.role,
      outputDir: options.outputDir,
      dryRun: options.dryRun,
      ...(overrides?.metadata ?? {}),
    },
  };
}

function spawnStrategyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MeleeKernelSpawnStrategy {
  const value = env.ORCH_AGENT_KERNEL_SPAWN_STRATEGY;
  if (!value) return "auto";
  if (value === "kernel" || value === "auto") return value;
  throw new Error(`Unsupported ORCH_AGENT_KERNEL_SPAWN_STRATEGY "${value}"; expected "auto" or "kernel"`);
}

function spawnEventData(
  options: PiRunOptions,
  extra: Record<string, unknown> = {},
): EventData {
  return {
    agent: options.role,
    outputDir: options.outputDir,
    dryRun: options.dryRun,
    systemTemplatePath: options.prompt.systemTemplatePath,
    userTemplatePath: options.prompt.userTemplatePath,
    ...extra,
  } as EventData;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function kernelSessionBindingEntries(
  context: MeleeKernelSpawnContext,
  options: PiRunOptions,
  markerConfig: MeleeKernelRuntime["config"]["markerConfig"],
): PiRunOptions["customSessionEntries"] {
  if (!context.appSessionId) return undefined;
  const metadata = context.metadata ?? {};
  const lineage = context.containerLineage ?? [];
  const leaf = lineage.length > 0 ? lineage[lineage.length - 1] : undefined;
  return [
    {
      customType: markerConfig.sessionBinding,
      data: {
        appSessionId: context.appSessionId,
        appSessionSlug:
          metadataString(metadata, "appSessionSlug") ??
          metadataString(metadata, "sessionId") ??
          metadataString(metadata, "runId") ??
          context.appSessionId,
        appSessionDir:
          metadataString(metadata, "appSessionDir") ??
          metadataString(metadata, "stateDir") ??
          context.workingDir ??
          options.cwd,
        containerId: context.containerId,
        phase: context.phase ?? options.role,
        agentName: options.role,
        role: options.role,
        displayLabel: leaf?.label ?? options.role,
        workingDir: context.workingDir ?? options.cwd,
        outputDir: options.outputDir,
        metadata,
      },
    },
  ];
}

async function submitSpawnEvent(
  traceWriter: MeleeKernelSpawnTraceWriter | undefined,
  context: MeleeKernelSpawnContext,
  type: string,
  options: PiRunOptions,
  eventData: Record<string, unknown> = {},
): Promise<void> {
  if (!traceWriter || !context.appSessionId) return;
  await traceWriter.submitAppEvent({
    appSessionId: context.appSessionId,
    containerId: context.containerId,
    type,
    traceLevel: TraceLevel.PROCESSING,
    agentId: options.role,
    eventData: spawnEventData(options, eventData),
  });
}

let runtimeStepWarningShown = false;

async function runRuntimeStep(
  label: string,
  required: boolean,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (required) throw error;
    if (!runtimeStepWarningShown) {
      runtimeStepWarningShown = true;
      console.warn(
        `Agent Kernel runtime step "${label}" failed; continuing without persisted kernel observability for this spawn: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function directUserPromptForContextSpawn(
  piOptions: PiRunOptions,
  prompt: string,
): string {
  const renderedContext = piOptions.prompt.kernelContext?.renderedContext?.trim();
  if (!renderedContext) return piOptions.prompt.userPrompt;
  const turnPrompt = prompt.trim();
  if (!turnPrompt || turnPrompt === renderedContext) return renderedContext;
  return `${renderedContext}\n\n${turnPrompt}`;
}

export function createMeleeKernelPiAgentRunner(
  deps: CreateMeleeKernelPiAgentRunnerOptions = {},
): (options: MeleeKernelPiRunOptions) => Promise<PiRunResult> {
  const runPiAgent =
    deps.runPiAgent ??
    (async () => {
      throw new Error("createMeleeKernelPiAgentRunner requires a runPiAgent port");
    });
  const resolveKernelAgent = deps.resolveKernelAgent ?? defaultKernelAgent;
  const convertPromptBundle = deps.toKernelParsedAgentFromBundle ?? defaultParsedAgentFromBundle;

  return async function runMeleeKernelPiAgent(
    options: MeleeKernelPiRunOptions,
  ): Promise<PiRunResult> {
    const {
      autoInitializeKernelRuntime = true,
      kernelContext,
      kernelOptions,
      kernelRuntime,
      kernelSpawnStrategy,
      traceWriter,
      ...piOptions
    } = options;
    const entry = resolveKernelAgent(piOptions.role);
    const converted = convertPromptBundle(entry, piOptions.prompt);
    const context = {
      ...defaultKernelContext(piOptions),
      ...(kernelContext ?? {}),
      metadata: {
        ...defaultKernelContext(piOptions).metadata,
        ...(kernelContext?.metadata ?? {}),
        kernelAgentId: entry.name,
      },
    };
    const runtime =
      kernelRuntime ??
      (autoInitializeKernelRuntime
        ? await getDefaultMeleeKernelRuntime({
            config: {
              workingDir: piOptions.cwd,
            },
            database: {
              maxConnections: 1,
            },
          })
        : null);
    const spawnTraceWriter = traceWriter ?? runtime?.traceWriter;
    const runtimeRequired = kernelRuntime != null || meleeKernelRuntimeRequiredFromEnv();
    const markerConfig =
      runtime?.config?.markerConfig ??
      createMeleeKernelBridgeConfig({ workingDir: piOptions.cwd }).markerConfig;
    const strategy = kernelSpawnStrategy ?? spawnStrategyFromEnv();
    const useKernelCreateSpawnAgent =
      strategy === "kernel" ||
      (strategy === "auto" && Boolean(runtime?.db && context.appSessionId && !piOptions.dryRun));

    if (strategy === "kernel" && piOptions.dryRun) {
      throw new Error("Kernel createSpawnAgent strategy does not support Pi dryRun");
    }
    if (!piOptions.dryRun && !useKernelCreateSpawnAgent) {
      const reason = !runtime?.db
        ? "initialized kernel runtime DB"
        : !context.appSessionId
          ? "kernel app session id"
          : "kernel spawn strategy";
      throw new Error(`Non-dry Melee agent spawns must use kernel createSpawnAgent; missing ${reason}.`);
    }
    if (useKernelCreateSpawnAgent && !runtime?.db) {
      throw new Error("Kernel createSpawnAgent strategy requires an initialized kernel runtime DB");
    }
    if (useKernelCreateSpawnAgent && !runtime?.config?.piSessionsDir) {
      throw new Error("Kernel createSpawnAgent strategy requires runtime.config.piSessionsDir");
    }

    const kernel = createMeleeKernel<PiRunResult>({
      spawnAgent: useKernelCreateSpawnAgent
        ? createMeleeKernelSpawnAgent({
            piOptions,
            parsedAgent: converted.parsed,
            contextResolver: converted.contextResolver ?? null,
            runtime: {
              db: runtime!.db,
              config: {
                markerConfig,
                piSessionsDir: runtime!.config!.piSessionsDir,
              },
              traceWriter: spawnTraceWriter,
            },
            buildToolFactories: deps.buildToolFactories,
            createSpawnAgent: deps.createKernelSpawnAgent,
          })
        : async (name, prompt) => {
            if (name !== entry.name) {
              throw new Error(`Melee kernel spawn mismatch: expected ${entry.name}, got ${name}`);
            }
            const userPrompt = converted.contextResolver
              ? directUserPromptForContextSpawn(piOptions, prompt)
              : prompt;
            return runPiAgent({
              ...piOptions,
              customSessionEntries: [
                ...(piOptions.customSessionEntries ?? []),
                ...(kernelSessionBindingEntries(context, piOptions, markerConfig) ?? []),
              ],
              piLifecycleCustomType:
                piOptions.piLifecycleCustomType ??
                (context.appSessionId ? markerConfig.lifecycle : undefined),
              prompt: {
                ...piOptions.prompt,
                systemPrompt: converted.parsed.body,
                userPrompt,
              },
            });
          },
    });

    const upsertSpawnContainers = runtime?.upsertSpawnContainers;
    if (upsertSpawnContainers) {
      await runRuntimeStep("upsert spawn containers", runtimeRequired, () =>
        upsertSpawnContainers(context),
      );
    }
    await runRuntimeStep("submit spawn started event", runtimeRequired, () =>
      submitSpawnEvent(spawnTraceWriter, context, MELEE_AGENT_SPAWN_STARTED_EVENT, piOptions),
    );
    try {
      const result = await kernel.spawnAgent(
        entry.name,
        converted.userPrompt,
        context,
        kernelOptionsFor(piOptions, kernelOptions),
      );
      const status = result.failed || result.providerError ? "failed" : result.dryRun ? "dry_run" : "succeeded";
      const eventType =
        result.failed || result.providerError
          ? MELEE_AGENT_SPAWN_FAILED_EVENT
          : MELEE_AGENT_SPAWN_COMPLETED_EVENT;
      await runRuntimeStep("submit spawn completed event", runtimeRequired, () =>
        submitSpawnEvent(spawnTraceWriter, context, eventType, piOptions, {
          sessionId: result.sessionId,
          sessionFile: result.sessionFile ?? null,
          outputPath: result.outputPath,
          status,
          error: result.error ?? result.providerError ?? null,
        }),
      );
      return result;
    } catch (error) {
      await runRuntimeStep("submit spawn failed event", runtimeRequired, () =>
        submitSpawnEvent(spawnTraceWriter, context, MELEE_AGENT_SPAWN_FAILED_EVENT, piOptions, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    } finally {
      kernel.dispose();
    }
  };
}

const buildToolFactories: BuildMeleeKernelToolFactories = (options) => {
  const toolContext: AgentToolRuntimeContext = {
    role: options.role,
    cwd: options.cwd,
    repoRoot: options.cwd,
    ...(options.toolContext ?? {}),
  };
  return buildAgentTools(toolContext, options.toolProfile).map((tool) => {
    return (pi) => {
      pi.registerTool(tool as never);
    };
  });
};

export const runMeleeKernelPiAgent = createMeleeKernelPiAgentRunner({
  buildToolFactories,
  resolveKernelAgent(role) {
    return meleeKernelAgent(role as KernelAgentId);
  },
  runPiAgent,
  toKernelParsedAgentFromBundle(entry, bundle) {
    return toKernelParsedAgentFromBundle(meleeKernelAgent(entry.name as KernelAgentId), bundle);
  },
});
