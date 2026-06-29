import type { ProjectRuntimeContext } from "@server/core/project-registry";
import type { CliResult } from "@server/infrastructure/shell/ui-command-runner";

type JsonObject = Record<string, unknown>;

export interface SavePointRuntime {
  boundarySavePoint: (paths: ProjectRuntimeContext, trigger: string, label?: string) => Promise<JsonObject | null>;
  createSavePoint: (body: JsonObject) => Promise<JsonObject>;
  parseCliJsonOutput: (stdout: string) => JsonObject;
}

export interface SavePointRuntimeDeps {
  appendLog: (stream: "stdout" | "stderr" | "ui", text: string) => void;
  invalidateCampaignCache: () => void;
  outputTail: (textValue: string, maxLength?: number) => string;
  resolveDashboardProject: (input: JsonObject, options?: { useDefaultProject?: boolean }) => ProjectRuntimeContext;
  runCli: (command: string[], cwd?: string) => Promise<CliResult>;
  serverJobPath: string;
}

const SAVE_POINT_TRIGGERS = new Set(["manual", "init", "pause", "checkpoint", "qa", "ship", "sync", "fresh", "epoch"]);

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function serverJobPrefix(paths: ProjectRuntimeContext, serverJobPath: string): string[] {
  const command = ["bun", serverJobPath];
  if (paths.project) command.push("--project", paths.project.projectId);
  command.push("--repo-root", paths.repoRoot, "--state-dir", paths.stateDir);
  return command;
}

export function createSavePointRuntime(deps: SavePointRuntimeDeps): SavePointRuntime {
  function parseCliJsonOutput(stdout: string): JsonObject {
    const trimmed = stdout.trim();
    if (!trimmed) return {};
    try {
      return asObject(JSON.parse(trimmed));
    } catch {
      return {};
    }
  }

  async function boundarySavePoint(paths: ProjectRuntimeContext, trigger: string, label = ""): Promise<JsonObject | null> {
    try {
      const command = [...serverJobPrefix(paths, deps.serverJobPath), "save-point", "--trigger", trigger];
      if (label) command.push("--label", label);
      const result = await deps.runCli(command);
      deps.invalidateCampaignCache();
      if (result.exitCode !== 0) {
        deps.appendLog("stderr", `save-point (${trigger}) failed (${result.exitCode}): ${deps.outputTail(result.stderr || result.stdout, 800)}`);
        return null;
      }
      deps.appendLog("ui", `save-point (${trigger}) recorded`);
      return parseCliJsonOutput(result.stdout);
    } catch (error) {
      deps.appendLog("stderr", `save-point (${trigger}) failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function createSavePoint(body: JsonObject): Promise<JsonObject> {
    const paths = deps.resolveDashboardProject(body, { useDefaultProject: true });
    const trigger = stringValue(body.trigger, "manual");
    if (!SAVE_POINT_TRIGGERS.has(trigger)) throw new Error(`Unknown save-point trigger: ${trigger}`);
    const result = await boundarySavePoint(paths, trigger, stringValue(body.label));
    if (!result) throw new Error("save-point failed; see process logs");
    return result;
  }

  return {
    boundarySavePoint,
    createSavePoint,
    parseCliJsonOutput,
  };
}
