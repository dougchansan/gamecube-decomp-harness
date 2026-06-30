import { resolve } from "node:path";
import {
  DEFAULT_AGENT_KERNEL_DATABASE_URL,
  colosseumKernelDatabaseUrlFromEnv,
  colosseumKernelRuntimeRequiredFromEnv,
} from "@server/infrastructure/kernel/bridge/database";
import { createColosseumKernelRuntime, type ColosseumKernelRuntime } from "@server/infrastructure/kernel/bridge/runtime";
import { colosseumRootContainerId } from "@server/infrastructure/kernel/bridge/session-mapping";
import {
  submitColosseumWorkflowTraceEvent,
  type ColosseumWorkflowTraceStatus,
  type SubmitColosseumWorkflowTraceEventInput,
} from "@server/infrastructure/kernel/bridge/workflow-trace";
import type { ProjectRuntimeContext } from "@server/core/project-registry";

type JsonObject = Record<string, unknown>;
type JsonResponder = (data: unknown, init?: ResponseInit) => Response;

export interface DashboardKernelWorkflowEventInput {
  kind: SubmitColosseumWorkflowTraceEventInput["kind"];
  operation: string;
  status?: ColosseumWorkflowTraceStatus;
  sessionId?: string | null;
  runId?: string | null;
  prId?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DashboardKernelRuntimeService {
  closeForTests: () => Promise<void>;
  databaseUrl: () => string | null;
  enabled: () => Promise<boolean>;
  kernelRuntimeRequired: boolean;
  projectId: (paths: ProjectRuntimeContext) => string;
  readApiResponse: (req: Request) => Promise<Response>;
  runtime: () => Promise<ColosseumKernelRuntime | null>;
  sessionId: (paths: ProjectRuntimeContext, input: Pick<DashboardKernelWorkflowEventInput, "sessionId" | "runId">) => string;
  startTraceTailer: () => Promise<void>;
  status: () => Promise<JsonObject>;
  submitWorkflowEvent: (paths: ProjectRuntimeContext, input: DashboardKernelWorkflowEventInput) => Promise<JsonObject | null>;
}

export interface DashboardKernelRuntimeServiceDeps {
  activeProjectSessionUuid?: (stateDir: string, projectId: string) => string | null;
  appendLog: (stream: "stdout" | "stderr" | "ui", text: string) => void;
  defaultStateDir: string;
  env: Record<string, string | undefined>;
  json: JsonResponder;
  latestRunId: (stateDir: string) => string;
  packageRoot: string;
  port: number;
  recordProjectSessionKernelTrace?: (
    stateDir: string,
    projectId: string,
    sessionUuid: string,
    trace: {
      activeContainerId: string;
      appSessionId: string;
      rootContainerId: string;
      traceUrl: string;
    },
  ) => Promise<void> | void;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function redactedUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return value.replace(/\/\/([^/@]+)@/, "//***@");
  }
}

export function createDashboardKernelRuntimeService(deps: DashboardKernelRuntimeServiceDeps): DashboardKernelRuntimeService {
  const explicitKernelDatabaseUrl = colosseumKernelDatabaseUrlFromEnv(deps.env);
  const kernelRuntimeDisabled = /^(1|true|yes)$/i.test(deps.env.ORCH_AGENT_KERNEL_DISABLED ?? deps.env.ORCH_AGENT_KERNEL_DISABLE ?? "");
  const kernelDatabaseUrl = kernelRuntimeDisabled ? null : (explicitKernelDatabaseUrl || DEFAULT_AGENT_KERNEL_DATABASE_URL);
  const kernelDatabaseSource = kernelRuntimeDisabled ? "disabled" : (explicitKernelDatabaseUrl ? "env" : "default-local");
  const kernelRuntimeRequired = colosseumKernelRuntimeRequiredFromEnv(deps.env);
  const kernelAppBaseUrl = deps.env.ORCH_AGENT_KERNEL_APP_BASE_URL ?? `http://localhost:${deps.port}`;
  const kernelObserverUrl = deps.env.AGENT_KERNEL_OBSERVER_URL ?? null;
  let kernelRuntimePromise: Promise<ColosseumKernelRuntime | null> | null = null;

  function runtime(): Promise<ColosseumKernelRuntime | null> {
    if (!kernelDatabaseUrl) return Promise.resolve(null);
    if (!kernelRuntimePromise) {
      kernelRuntimePromise = createColosseumKernelRuntime({
        config: {
          workingDir: deps.packageRoot,
          piSessionsDir: resolve(deps.packageRoot, ".pi-sessions"),
          cursorSnapshotPath: resolve(deps.defaultStateDir, "agent-kernel-tailer-cursors.json"),
          appBaseUrl: kernelAppBaseUrl,
          appTraceUrlTemplate: `${kernelAppBaseUrl}/trace?containerId={containerId}`,
          genericTraceUrlTemplate: kernelObserverUrl ? `${kernelObserverUrl}/containers/{containerId}` : null,
          metadata: {
            processName: "pkmn-colosseum-live",
            server: "server",
          },
        },
        database: {
          databaseUrl: kernelDatabaseUrl,
        },
      }).catch((error) => {
        kernelRuntimePromise = null;
        deps.appendLog("stderr", `agent-kernel init failed: ${error instanceof Error ? error.message : String(error)}`);
        if (kernelRuntimeRequired) throw error;
        return null;
      });
    }
    return kernelRuntimePromise;
  }

  async function closeForTests(): Promise<void> {
    const runtimePromise = kernelRuntimePromise;
    kernelRuntimePromise = null;
    const current = await runtimePromise?.catch(() => null);
    await current?.close();
  }

  async function status(): Promise<JsonObject> {
    if (!kernelDatabaseUrl) {
      return {
        configured: false,
        enabled: false,
        required: kernelRuntimeRequired,
        disabled: kernelRuntimeDisabled,
        databaseUrl: null,
        databaseSource: kernelDatabaseSource,
        env: ["ORCH_AGENT_KERNEL_DATABASE_URL", "AGENT_KERNEL_DATABASE_URL"],
      };
    }

    try {
      const current = await runtime();
      return {
        configured: true,
        enabled: current !== null,
        required: kernelRuntimeRequired,
        databaseUrl: redactedUrl(kernelDatabaseUrl),
        databaseSource: kernelDatabaseSource,
        kernelId: current?.config.kernelId ?? null,
        piSessionsDir: current?.config.piSessionsDir ?? null,
        readApiPrefix: "/kernel",
        tailer: current?.traceTailerStatus() ?? null,
        registration: current?.registration
          ? {
              kernelId: current.registration.kernelId,
              lastSeenAt: current.registration.lastSeenAt,
              updatedAt: current.registration.updatedAt,
            }
          : null,
      };
    } catch (error) {
      return {
        configured: true,
        enabled: false,
        required: kernelRuntimeRequired,
        databaseUrl: redactedUrl(kernelDatabaseUrl),
        databaseSource: kernelDatabaseSource,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function enabled(): Promise<boolean> {
    return (await runtime()) !== null;
  }

  async function readApiResponse(req: Request): Promise<Response> {
    const current = await runtime();
    if (!current) {
      return deps.json(
        {
          error: kernelDatabaseUrl
            ? "Agent Kernel runtime is not available"
            : "Agent Kernel database URL is not configured",
          status: await status(),
        },
        { status: 503 },
      );
    }
    return current.readApi.handle(req);
  }

  function projectId(paths: ProjectRuntimeContext): string {
    return paths.project?.projectId ?? "pkmn-colosseum";
  }

  function sessionId(
    paths: ProjectRuntimeContext,
    input: Pick<DashboardKernelWorkflowEventInput, "sessionId" | "runId">,
  ): string {
    const explicit = stringValue(input.sessionId).trim();
    if (explicit) return explicit;
    try {
      const activeProjectSession = deps.activeProjectSessionUuid?.(paths.stateDir, projectId(paths));
      if (activeProjectSession) return activeProjectSession;
    } catch {
      // Fall back to run identity when canonical project-session state is unavailable.
    }
    const runId = stringValue(input.runId).trim();
    if (runId) return runId;
    try {
      const latest = deps.latestRunId(paths.stateDir);
      if (latest) return latest;
    } catch {
      // Some session-boundary operations can run before the orchestrator state DB exists.
    }
    return paths.project?.projectId ? `project:${paths.project.projectId}` : "dashboard-session";
  }

  async function submitWorkflowEvent(
    paths: ProjectRuntimeContext,
    input: DashboardKernelWorkflowEventInput,
  ): Promise<JsonObject | null> {
    try {
      const current = await runtime();
      if (!current) {
        const message = kernelDatabaseUrl
          ? "Agent Kernel runtime is not available"
          : "Agent Kernel database URL is not configured";
        if (kernelRuntimeRequired) throw new Error(message);
        return null;
      }
      const resolvedProjectId = projectId(paths);
      const resolvedSessionId = sessionId(paths, input);
      const result = await submitColosseumWorkflowTraceEvent({
        runtime: current,
        kind: input.kind,
        projectId: resolvedProjectId,
        sessionId: resolvedSessionId,
        operation: input.operation,
        status: input.status,
        prId: input.prId,
        workingDir: paths.repoRoot,
        detail: input.detail,
        metadata: {
          stateDir: paths.stateDir,
          graphDbPath: paths.graphDbPath,
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.metadata ?? {}),
        },
      });
      const rootContainerId = colosseumRootContainerId({
        projectId: resolvedProjectId,
        sessionId: resolvedSessionId,
      });
      await Promise.resolve(
        deps.recordProjectSessionKernelTrace?.(paths.stateDir, resolvedProjectId, resolvedSessionId, {
          activeContainerId: result.containerId,
          appSessionId: result.appSessionId,
          rootContainerId,
          traceUrl: `${kernelAppBaseUrl}/trace?projectId=${encodeURIComponent(resolvedProjectId)}&traceId=${encodeURIComponent(rootContainerId)}`,
        }),
      ).catch((error) => {
        deps.appendLog("stderr", `agent-kernel project-session trace attach failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return {
        appSessionId: result.appSessionId,
        containerId: result.containerId,
        eventId: result.event.eventId,
      };
    } catch (error) {
      deps.appendLog(
        "stderr",
        `agent-kernel workflow trace failed (${input.kind}/${input.operation}): ${error instanceof Error ? error.message : String(error)}`,
      );
      if (kernelRuntimeRequired) throw error;
      return null;
    }
  }

  async function startTraceTailer(): Promise<void> {
    const current = await runtime();
    if (!current) return;
    deps.appendLog("ui", `agent-kernel registered: ${current.config.kernelId}`);
    await current.startTraceTailer();
    const traceStatus = current.traceTailerStatus();
    deps.appendLog("ui", `agent-kernel tailer watching: ${traceStatus?.watchDir ?? current.config.piSessionsDir}`);
  }

  return {
    closeForTests,
    databaseUrl: () => kernelDatabaseUrl,
    enabled,
    kernelRuntimeRequired,
    projectId,
    readApiResponse,
    runtime,
    sessionId,
    startTraceTailer,
    status,
    submitWorkflowEvent,
  };
}
