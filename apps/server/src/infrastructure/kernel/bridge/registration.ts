import {
  upsertKernelRegistration as defaultUpsertKernelRegistration,
  type KernelRegistration,
  type NewKernelRegistration,
} from "@agent-kernel/db";

import {
  createMeleeKernelBridgeConfig,
  type CreateMeleeKernelBridgeConfigInput,
  type MeleeKernelBridgeConfig,
} from "./config.js";

export type KernelRegistrationUpsertPort = (
  db: unknown,
  data: NewKernelRegistration,
) => Promise<KernelRegistration>;

export function buildMeleeKernelRegistration(
  config: MeleeKernelBridgeConfig = createMeleeKernelBridgeConfig(),
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

export interface UpsertMeleeKernelRegistrationOptions {
  db: unknown;
  config?: CreateMeleeKernelBridgeConfigInput | MeleeKernelBridgeConfig;
  upsert?: KernelRegistrationUpsertPort;
}

export async function upsertMeleeKernelRegistration({
  db,
  config,
  upsert = defaultUpsertKernelRegistration,
}: UpsertMeleeKernelRegistrationOptions): Promise<KernelRegistration> {
  const resolvedConfig = createMeleeKernelBridgeConfig(config);
  return upsert(db, buildMeleeKernelRegistration(resolvedConfig));
}
