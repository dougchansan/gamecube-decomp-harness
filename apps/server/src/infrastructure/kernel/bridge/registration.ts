import {
  upsertKernelRegistration as defaultUpsertKernelRegistration,
  type KernelRegistration,
  type NewKernelRegistration,
} from "@agent-kernel/db";

import {
  createColosseumKernelBridgeConfig,
  type CreateColosseumKernelBridgeConfigInput,
  type ColosseumKernelBridgeConfig,
} from "./config.js";

export type KernelRegistrationUpsertPort = (
  db: unknown,
  data: NewKernelRegistration,
) => Promise<KernelRegistration>;

export function buildColosseumKernelRegistration(
  config: ColosseumKernelBridgeConfig = createColosseumKernelBridgeConfig(),
): NewKernelRegistration {
  return {
    kernelId: config.kernelId,
    displayName: config.displayName,
    workingDir: config.workingDir,
    piSessionsDir: config.piSessionsDir,
    appBaseUrl: config.appBaseUrl,
    appTraceUrlTemplate: config.appTraceUrlTemplate,
    genericTraceUrlTemplate: config.genericTraceUrlTemplate,
    markerConfig: config.markerConfig,
    metadata: config.metadata,
  };
}

export interface UpsertColosseumKernelRegistrationOptions {
  db: unknown;
  config?: CreateColosseumKernelBridgeConfigInput | ColosseumKernelBridgeConfig;
  upsert?: KernelRegistrationUpsertPort;
}

export async function upsertColosseumKernelRegistration({
  db,
  config,
  upsert = defaultUpsertKernelRegistration,
}: UpsertColosseumKernelRegistrationOptions): Promise<KernelRegistration> {
  const resolvedConfig = createColosseumKernelBridgeConfig(config);
  return upsert(db, buildColosseumKernelRegistration(resolvedConfig));
}
