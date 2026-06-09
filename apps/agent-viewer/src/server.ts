import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  directorPrompt,
  knowledgeCuratorPrompt,
  prReviewPrompt,
  targetPacketTarget,
  workerPacket,
  workerPrompt,
} from "@decomp-orchestrator/agents";
import { stableJson } from "@decomp-orchestrator/agents/runtime";
import { listProjects, projectToSummary, resolveProject, type ProjectSummary, type ResolvedProject } from "@decomp-orchestrator/core";
import { activeLeasesForRun, activeWorkerCount, getLatestRun, nextUnhandledEvent, openState, queueStatsSnapshot } from "@decomp-orchestrator/core/state";
import type { BoardSnapshot, PiPromptBundle, RunProjectMetadata, RunRecord } from "@decomp-orchestrator/core/types";
import { loadKnowledgeBoardSnapshot } from "@decomp-orchestrator/knowledge";
import type { PromptPreviewAgentId, PromptPreviewSource, PromptPreviewStats } from "@decomp-orchestrator/ui-contract";

type JsonObject = Record<string, unknown>;

interface PromptProjectContext {
  project: ResolvedProject | null;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
  usePathOverrides: boolean;
}

interface PromptLease {
  leaseId: string;
  queueId: string;
  workerId: string;
  targetId: string;
  target: Record<string, unknown>;
  writeSet: string[];
  ttl: string;
  selectionSource?: string;
}

const packageRoot = resolve(import.meta.dir, "../../..");
const defaultRepoRoot = packageRoot;
const defaultStateDir = resolve(packageRoot, ".decomp-orchestrator-state");
const builtStaticRoot = resolve(packageRoot, "apps/agent-viewer/dist");
const port = Number(Bun.env.AGENT_VIEWER_PORT ?? Bun.env.PROMPT_VIEWER_PORT ?? Bun.env.ORCH_PROMPT_VIEWER_PORT ?? 8797);
const promptPreviewAgents: PromptPreviewAgentId[] = ["director", "worker", "pr-review", "knowledge-curator"];

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true";
}

function readJsonObject(path: string): JsonObject {
  try {
    if (!path || !existsSync(path)) return {};
    return asObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function text(data: string, init: ResponseInit = {}): Response {
  return new Response(data, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function promptPreviewAgent(value: unknown): PromptPreviewAgentId {
  const agent = stringValue(value, "worker");
  return promptPreviewAgents.includes(agent as PromptPreviewAgentId) ? (agent as PromptPreviewAgentId) : "worker";
}

function promptPreviewSource(value: unknown): PromptPreviewSource {
  return stringValue(value, "latest") === "sample" ? "sample" : "latest";
}

function availableProjects(): ProjectSummary[] {
  try {
    return listProjects({ orchestratorRoot: packageRoot });
  } catch {
    return [];
  }
}

function defaultProject(): ResolvedProject | null {
  try {
    return resolveProject({ orchestratorRoot: packageRoot, useDefaultProject: true });
  } catch {
    return null;
  }
}

function projectDefaults(project: ResolvedProject | null): JsonObject | null {
  if (!project) return null;
  return {
    processName: project.processName,
    baseRef: project.baseRef,
    graphDbPath: project.graphDbPath,
    validation: project.validation,
    dashboard: project.dashboard,
    pr: project.pr,
  };
}

function resolvePromptProject(input: JsonObject, options: { useDefaultProject?: boolean } = {}): PromptProjectContext {
  const projectId = stringValue(input.projectId).trim();
  const usePathOverrides = boolValue(input.usePathOverrides);
  if (projectId || options.useDefaultProject) {
    try {
      const project = resolveProject({
        orchestratorRoot: packageRoot,
        projectId: projectId || undefined,
        useDefaultProject: !projectId && options.useDefaultProject === true,
        explicitOverrides: usePathOverrides
          ? {
              repoRoot: stringValue(input.repoRoot) || undefined,
              stateDir: stringValue(input.stateDir) || undefined,
              graphDb: stringValue(input.graphDbPath, stringValue(input.graphDb)) || undefined,
            }
          : undefined,
      });
      return {
        project,
        repoRoot: project.repoRoot,
        stateDir: project.stateDir,
        graphDbPath: project.graphDbPath,
        usePathOverrides,
      };
    } catch (error) {
      if (projectId) throw error;
    }
  }

  return {
    project: null,
    repoRoot: resolve(stringValue(input.repoRoot, defaultRepoRoot)),
    stateDir: resolve(stringValue(input.stateDir, defaultStateDir)),
    graphDbPath: resolve(stringValue(input.graphDbPath, stringValue(input.graphDb, "")) || resolve(defaultStateDir, "knowledge-graph.sqlite")),
    usePathOverrides: true,
  };
}

function requestPaths(url: URL, options: { useDefaultProject?: boolean } = {}): PromptProjectContext {
  return resolvePromptProject(
    {
      projectId: url.searchParams.get("projectId") ?? "",
      repoRoot: url.searchParams.get("repoRoot") ?? "",
      stateDir: url.searchParams.get("stateDir") ?? "",
      graphDbPath: url.searchParams.get("graphDbPath") ?? url.searchParams.get("graphDb") ?? "",
      usePathOverrides: url.searchParams.get("usePathOverrides") ?? "",
    },
    options,
  );
}

function projectMetadataForPrompt(paths: PromptProjectContext): RunProjectMetadata | undefined {
  if (!paths.project) return undefined;
  return {
    projectId: paths.project.projectId,
    projectKind: paths.project.kind,
    repoRoot: paths.repoRoot,
    stateDir: paths.stateDir,
    graphDbPath: paths.graphDbPath,
    descriptorPath: paths.project.descriptorPath,
    localOverridePath: paths.project.localOverridePath,
  };
}

function sampleRun(project?: RunProjectMetadata): RunRecord {
  return {
    id: "agent-viewer-sample-run",
    goalKind: "matched_code_percent",
    goalValue: 100,
    desiredWorkers: 4,
    status: "active",
    createdAt: new Date().toISOString(),
    project,
  };
}

function sampleBoardSnapshot(paths: PromptProjectContext): BoardSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    reportPath: resolve(paths.repoRoot, "build/GALE01/report.json"),
    objdiffPath: resolve(paths.repoRoot, "objdiff.json"),
    measures: {
      fuzzy_match_percent: 82.4,
      matched_code_percent: 61.7,
      complete_code_percent: 54.2,
      matched_functions_percent: 70.1,
      complete_units: 128,
      total_units: 412,
    },
    candidates: [
      {
        unit: "GALE01:ftDemo",
        symbol: "ftDemo_Update",
        sourcePath: "src/melee/ft/chara/ftDemo.c",
        size: 184,
        fuzzy: 96.42,
        priority: 900_000,
        reason: "agent viewer sample target with nearby source-shape evidence",
      },
      {
        unit: "GALE01:grExample",
        symbol: "grExample_801C0000",
        sourcePath: "src/melee/gr/grExample.c",
        size: 96,
        fuzzy: 89.12,
        priority: 820_000,
        reason: "agent viewer sample follow-up target",
      },
    ],
  };
}

function promptStats(prompt: string): PromptPreviewStats {
  const unresolved = new Set<string>();
  for (const match of prompt.matchAll(/\{\{\s*[A-Z0-9_]+\s*\}\}|\{(?:pr_context_json|curator_context_json)\}/g)) {
    unresolved.add(match[0] ?? "");
  }
  return {
    characters: prompt.length,
    lines: prompt ? prompt.split(/\r\n|\r|\n/).length : 0,
    words: prompt.match(/\S+/g)?.length ?? 0,
    unresolvedPlaceholders: [...unresolved].filter(Boolean).sort(),
  };
}

function latestRunForPrompt(stateDir: string, warnings: string[]): RunRecord | null {
  const store = openState(stateDir);
  try {
    return getLatestRun(store);
  } catch (error) {
    warnings.push(`Unable to read latest run from state: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    store.db.close();
  }
}

function liveBoardSnapshotForPrompt(paths: PromptProjectContext, limit: number, warnings: string[]): BoardSnapshot {
  try {
    return loadKnowledgeBoardSnapshot(paths.repoRoot, limit, { graphDbPath: paths.graphDbPath });
  } catch (error) {
    warnings.push(`Unable to load live board snapshot; using sample board: ${error instanceof Error ? error.message : String(error)}`);
    return sampleBoardSnapshot(paths);
  }
}

function latestInitialSnapshot(stateDir: string, runId: string): JsonObject {
  return readJsonObject(resolve(stateDir, "runs", runId, "snapshots", "initial_board.json"));
}

function measuresFromSnapshot(snapshot: JsonObject): JsonObject {
  return asObject(snapshot.measures);
}

function firstQueuedTarget(stateDir: string, runId: string): JsonObject | null {
  const store = openState(stateDir);
  try {
    const row = store.db
      .query(
        `
          SELECT
            queue.id AS queue_id,
            targets.id AS target_id,
            targets.unit,
            targets.symbol,
            targets.source_path,
            targets.size,
            targets.fuzzy,
            targets.priority,
            targets.reason
          FROM queue
          JOIN targets ON targets.id = queue.target_id
          WHERE queue.run_id = ?
            AND queue.status = 'queued'
          ORDER BY queue.priority DESC, queue.created_at ASC
          LIMIT 1
        `,
      )
      .get(runId) as JsonObject | undefined;
    return row ?? null;
  } finally {
    store.db.close();
  }
}

function directorPromptPreview(
  paths: PromptProjectContext,
  requestedSource: PromptPreviewSource,
  warnings: string[],
): { bundle: PiPromptBundle; context: JsonObject; contextSource: PromptPreviewSource } {
  const project = projectMetadataForPrompt(paths);
  const liveRun = requestedSource === "latest" ? latestRunForPrompt(paths.stateDir, warnings) : null;
  const contextSource: PromptPreviewSource = liveRun ? "latest" : "sample";
  if (requestedSource === "latest" && !liveRun) warnings.push("No latest run is available; rendered the director prompt with sample run state.");
  const run = liveRun ?? sampleRun(project);
  const candidateWindow = paths.project?.dashboard.candidateWindow ?? Math.max(32, run.desiredWorkers * 8);
  const snapshot = contextSource === "latest" ? liveBoardSnapshotForPrompt(paths, candidateWindow, warnings) : sampleBoardSnapshot(paths);
  let event: JsonObject = {
    id: "agent-viewer-sample-event",
    event_type: "pool_below_target",
    producer: "agent-viewer",
    payload_json: JSON.stringify({ reason: "sample director wake event" }),
    created_at: new Date().toISOString(),
  };
  let activeWorkers = 0;
  let queuePressure: JsonObject | null = null;

  if (contextSource === "latest") {
    const store = openState(paths.stateDir);
    try {
      const nextEvent = nextUnhandledEvent(store, run.id);
      if (nextEvent) event = asObject(nextEvent);
      activeWorkers = activeWorkerCount(store, run.id);
      const stats = queueStatsSnapshot(store, run.id);
      queuePressure = {
        candidate_limit: paths.project?.dashboard.candidateLimit ?? Math.max(32, run.desiredWorkers * 2),
        candidate_window: candidateWindow,
        queue_target_size: paths.project?.dashboard.queueTargetSize ?? Math.max(32, run.desiredWorkers * 2),
        queued_targets: stats.queuedTargets,
        schedulable_targets: stats.schedulableTargets,
        blocked_queued_targets: stats.blockedQueuedTargets,
        active_workers: stats.activeWorkers,
        unhandled_events: stats.unhandledEvents,
      };
    } catch (error) {
      warnings.push(`Unable to read live director queue/event state: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      store.db.close();
    }
  } else {
    queuePressure = {
      candidate_limit: 16,
      candidate_window: 32,
      queue_target_size: 16,
      queued_targets: 6,
      schedulable_targets: 6,
      blocked_queued_targets: 0,
      active_workers: 0,
      unhandled_events: 1,
    };
  }

  const initialBoardPath = resolve(paths.stateDir, "runs", run.id, "snapshots", "initial_board.json");
  const options = {
    run,
    snapshot,
    event,
    activeWorkers,
    repoRoot: paths.repoRoot,
    stateDir: paths.stateDir,
    project,
    initialBoardPath,
    queuePressure: queuePressure ?? undefined,
  };
  return {
    bundle: directorPrompt(options),
    context: {
      options,
      selectedSnapshotCandidates: snapshot.candidates.slice(0, 12),
    },
    contextSource,
  };
}

function sampleWorkerLease(): PromptLease {
  const sourcePath = "src/melee/ft/chara/ftDemo.c";
  const target = {
    target_id: "agent-viewer-sample-target",
    unit: "GALE01:ftDemo",
    symbol: "ftDemo_Update",
    source_path: sourcePath,
    size: 184,
    fuzzy: 96.42,
    priority: 900_000,
    reason: "agent viewer sample worker lease",
  };
  return {
    leaseId: "agent-viewer-sample-lease",
    queueId: "agent-viewer-sample-queue",
    workerId: "agent-viewer-worker",
    targetId: String(target.target_id),
    target,
    writeSet: [sourcePath],
    ttl: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    selectionSource: "sample_target",
  };
}

function liveWorkerLeaseForPrompt(paths: PromptProjectContext, run: RunRecord, warnings: string[]): PromptLease {
  const store = openState(paths.stateDir);
  try {
    const activeLease = activeLeasesForRun(store, run.id)[0];
    if (activeLease) return { ...activeLease, selectionSource: "active_lease" };
  } catch (error) {
    warnings.push(`Unable to read active worker leases: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    store.db.close();
  }

  try {
    const queued = firstQueuedTarget(paths.stateDir, run.id);
    if (queued) {
      const sourcePath = stringValue(queued.source_path);
      const target = {
        target_id: stringValue(queued.target_id, "agent-viewer-queued-target"),
        unit: stringValue(queued.unit),
        symbol: stringValue(queued.symbol),
        source_path: sourcePath,
        size: numberValue(queued.size),
        fuzzy: numberValue(queued.fuzzy),
        priority: numberValue(queued.priority),
        reason: stringValue(queued.reason),
      };
      warnings.push("No active worker lease found; rendered the worker prompt with the first queued target as a synthetic lease.");
      return {
        leaseId: "agent-viewer-synthetic-lease",
        queueId: stringValue(queued.queue_id, "agent-viewer-synthetic-queue"),
        workerId: "agent-viewer-worker",
        targetId: stringValue(queued.target_id, "agent-viewer-queued-target"),
        target,
        writeSet: sourcePath ? [sourcePath] : [],
        ttl: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        selectionSource: "queued_target",
      };
    }
  } catch (error) {
    warnings.push(`Unable to read queued worker targets: ${error instanceof Error ? error.message : String(error)}`);
  }

  warnings.push("No active or queued worker target found; rendered the worker prompt with a sample target packet.");
  return sampleWorkerLease();
}

function workerPromptPreview(
  paths: PromptProjectContext,
  requestedSource: PromptPreviewSource,
  warnings: string[],
): { bundle: PiPromptBundle; context: JsonObject; contextSource: PromptPreviewSource } {
  const project = projectMetadataForPrompt(paths);
  const liveRun = requestedSource === "latest" ? latestRunForPrompt(paths.stateDir, warnings) : null;
  const contextSource: PromptPreviewSource = liveRun ? "latest" : "sample";
  if (requestedSource === "latest" && !liveRun) warnings.push("No latest run is available; rendered the worker prompt with sample run and target state.");
  const run = liveRun ?? sampleRun(project);
  const lease = contextSource === "latest" ? liveWorkerLeaseForPrompt(paths, run, warnings) : sampleWorkerLease();
  const initialSnapshot = contextSource === "latest" ? latestInitialSnapshot(paths.stateDir, run.id) : {};
  const baselineMeasures = Object.keys(initialSnapshot).length ? measuresFromSnapshot(initialSnapshot) : sampleBoardSnapshot(paths).measures;
  const target = targetPacketTarget(lease.target);
  const packet = workerPacket({
    run,
    leased: lease,
    target,
    baselineMeasures,
    knowledgeContext: {
      status: "prompt_viewer",
      source: lease.selectionSource ?? contextSource,
      note: "Rendered for prompt inspection; live worker runners may add richer graph context before launch.",
    },
  });
  const initialBoardPath = resolve(paths.stateDir, "runs", run.id, "snapshots", "initial_board.json");
  const workerLogDir = resolve(paths.stateDir, "runs", run.id, "worker_logs", lease.leaseId);
  const options = {
    packet,
    repoRoot: paths.repoRoot,
    stateDir: paths.stateDir,
    project,
    initialBoardPath,
    workerLogDir,
  };
  return {
    bundle: workerPrompt(options),
    context: {
      options,
      leaseSelectionSource: lease.selectionSource ?? contextSource,
      baselineMeasures,
    },
    contextSource,
  };
}

function prReviewPromptPreview(
  paths: PromptProjectContext,
  requestedSource: PromptPreviewSource,
  warnings: string[],
): { bundle: PiPromptBundle; context: JsonObject; contextSource: PromptPreviewSource } {
  if (requestedSource === "latest") warnings.push("The agent viewer does not keep a single current PR-review context; rendered a deterministic sample PR context.");
  const prContext = {
    source: "agent-viewer-sample",
    project: projectMetadataForPrompt(paths) ?? null,
    pr: {
      number: 0,
      title: "Agent viewer sample PR review",
      author: "agent-viewer",
      base_ref: paths.project?.baseRef ?? "origin/master",
      changed_files: ["src/melee/ft/chara/ftDemo.c"],
    },
    local_slice_paths: {
      pr_dump: resolve(paths.repoRoot, "knowledge/sources/past_prs/data/sample_pr.json"),
      patch: resolve(paths.repoRoot, "knowledge/sources/past_prs/data/sample_pr.diff"),
    },
    review_focus: ["extract reusable source-shape facts", "preserve evidence paths", "avoid promoting speculative lessons"],
  };
  return {
    bundle: prReviewPrompt({ prContext }),
    context: { prContext },
    contextSource: "sample",
  };
}

function knowledgeCuratorPromptPreview(
  paths: PromptProjectContext,
  requestedSource: PromptPreviewSource,
  warnings: string[],
): { bundle: PiPromptBundle; context: JsonObject; contextSource: PromptPreviewSource } {
  if (requestedSource === "latest") warnings.push("The agent viewer does not keep a single current curator batch context; rendered a deterministic sample curator context.");
  const curatorContext = {
    source: "agent-viewer-sample",
    project: projectMetadataForPrompt(paths) ?? null,
    graph_db_path: paths.graphDbPath,
    candidate_records: [
      {
        id: "agent-viewer-record-1",
        kind: "worker_fact",
        source_path: "src/melee/ft/chara/ftDemo.c",
        lesson: "Prefer existing JObj/header inlines when assert line numbers identify them.",
        evidence: ["worker_report.json", "runner_validation/final_summary.json"],
        confidence: "sample",
      },
    ],
    requested_decisions: ["promote_safe_records", "leave source-specific updates as proposals"],
  };
  return {
    bundle: knowledgeCuratorPrompt({ curatorContext }),
    context: { curatorContext },
    contextSource: "sample",
  };
}

function renderPromptPreview(paths: PromptProjectContext, agent: PromptPreviewAgentId, requestedSource: PromptPreviewSource): JsonObject {
  const warnings: string[] = [];
  const rendered =
    agent === "director"
      ? directorPromptPreview(paths, requestedSource, warnings)
      : agent === "worker"
        ? workerPromptPreview(paths, requestedSource, warnings)
        : agent === "pr-review"
          ? prReviewPromptPreview(paths, requestedSource, warnings)
          : knowledgeCuratorPromptPreview(paths, requestedSource, warnings);
  const { bundle, context, contextSource } = rendered;
  return {
    agent,
    requestedSource,
    contextSource,
    generatedAt: new Date().toISOString(),
    project: paths.project ? projectToSummary(paths.project) : null,
    repoRoot: paths.repoRoot,
    stateDir: paths.stateDir,
    graphDbPath: paths.graphDbPath,
    systemPrompt: bundle.systemPrompt,
    userPrompt: bundle.userPrompt,
    systemTemplatePath: bundle.systemTemplatePath,
    userTemplatePath: bundle.userTemplatePath,
    systemStats: promptStats(bundle.systemPrompt),
    userStats: promptStats(bundle.userPrompt),
    context: {
      ...context,
      renderedContextJson: stableJson(context),
    },
    warnings,
  };
}

async function handleApi(_req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/config") {
    const selectedProject = defaultProject();
    const projects = availableProjects();
    return json({
      packageRoot,
      defaultRepoRoot: selectedProject?.repoRoot ?? defaultRepoRoot,
      defaultStateDir: selectedProject?.stateDir ?? defaultStateDir,
      defaultGraphDbPath: selectedProject?.graphDbPath ?? resolve(defaultStateDir, "knowledge-graph.sqlite"),
      defaultProjectId: selectedProject?.projectId ?? "",
      selectedProject: selectedProject ? projectToSummary(selectedProject) : null,
      availableProjects: projects,
      projectDefaults: projectDefaults(selectedProject),
      port,
      hotReload: false,
      dashboardStreamIntervalMs: 0,
    });
  }
  if (url.pathname === "/api/agents/render" || url.pathname === "/api/prompts/render") {
    const paths = requestPaths(url, { useDefaultProject: true });
    return json(renderPromptPreview(paths, promptPreviewAgent(url.searchParams.get("agent")), promptPreviewSource(url.searchParams.get("source"))));
  }
  return json({ error: "not found" }, { status: 404 });
}

function staticResponse(pathname: string): Response {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const path = resolve(builtStaticRoot, file);
  if (!path.startsWith(builtStaticRoot)) return text("Not found", { status: 404 });
  if (!existsSync(path)) {
    const fallback = resolve(builtStaticRoot, "index.html");
    if (existsSync(fallback)) return new Response(Bun.file(fallback));
    return text("Agent viewer has not been built. Run `bun run agent-viewer:build` first.", { status: 404 });
  }
  return new Response(Bun.file(path));
}

export async function fetchAgentViewerServer(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, url);
    return staticResponse(url.pathname);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export function serveAgentViewerServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    fetch: fetchAgentViewerServer,
  });
  console.log(`agent viewer listening on http://localhost:${port}`);
  return server;
}

if (import.meta.main) serveAgentViewerServer();
