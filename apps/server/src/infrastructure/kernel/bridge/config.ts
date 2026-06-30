import { resolve } from "node:path";

import type { NewKernelRegistration } from "@agent-kernel/db";

export const COLOSSEUM_KERNEL_ID = "pkmn-colosseum-decomp-orchestrator";
export const COLOSSEUM_KERNEL_DISPLAY_NAME = "Pokemon Colosseum Decomp Orchestrator";
export const COLOSSEUM_DASHBOARD_PROCESS_NAME = "pkmn-colosseum-live";

export const COLOSSEUM_KERNEL_MARKER_CONFIG = Object.freeze({
  sessionBinding: "agent-kernel:session-binding",
  lifecycle: "agent-kernel:pi-lifecycle",
  subagentLink: "agent-kernel:subagent-link",
} satisfies NewKernelRegistration["markerConfig"]);

export const DEFAULT_PI_SESSIONS_DIR_NAME = ".pi-sessions";
export const DEFAULT_TAILER_CURSOR_PATH = ".decomp-orchestrator-state/agent-kernel-tailer-cursors.json";

export interface ColosseumKernelBridgeConfig {
  kernelId: string;
  displayName: string;
  processName: string;
  workingDir: string;
  piSessionsDir: string;
  cursorSnapshotPath: string;
  markerConfig: NewKernelRegistration["markerConfig"];
  appBaseUrl?: string | null;
  appTraceUrlTemplate?: string | null;
  genericTraceUrlTemplate?: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateColosseumKernelBridgeConfigInput {
  kernelId?: string;
  displayName?: string;
  processName?: string;
  workingDir?: string;
  piSessionsDir?: string;
  cursorSnapshotPath?: string;
  markerConfig?: Partial<NewKernelRegistration["markerConfig"]>;
  appBaseUrl?: string | null;
  appTraceUrlTemplate?: string | null;
  genericTraceUrlTemplate?: string | null;
  metadata?: Record<string, unknown>;
}

export function createColosseumKernelBridgeConfig(
  input: CreateColosseumKernelBridgeConfigInput = {},
): ColosseumKernelBridgeConfig {
  const workingDir = input.workingDir ?? process.cwd();
  const piSessionsDir = input.piSessionsDir ?? resolve(workingDir, DEFAULT_PI_SESSIONS_DIR_NAME);
  const cursorSnapshotPath =
    input.cursorSnapshotPath ?? resolve(workingDir, DEFAULT_TAILER_CURSOR_PATH);

  return {
    kernelId: input.kernelId ?? COLOSSEUM_KERNEL_ID,
    displayName: input.displayName ?? COLOSSEUM_KERNEL_DISPLAY_NAME,
    processName: input.processName ?? COLOSSEUM_DASHBOARD_PROCESS_NAME,
    workingDir,
    piSessionsDir,
    cursorSnapshotPath,
    markerConfig: {
      ...COLOSSEUM_KERNEL_MARKER_CONFIG,
      ...input.markerConfig,
    },
    appBaseUrl: input.appBaseUrl ?? null,
    appTraceUrlTemplate: input.appTraceUrlTemplate ?? null,
    genericTraceUrlTemplate: input.genericTraceUrlTemplate ?? null,
    metadata: {
      processName: input.processName ?? COLOSSEUM_DASHBOARD_PROCESS_NAME,
      ...input.metadata,
    },
  };
}
