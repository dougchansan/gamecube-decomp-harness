import {
  createKernel,
  type KernelAgentManagerLike,
  type KernelConfig,
  type KernelInstance,
  type KernelSpawnAdapter,
} from "@agent-kernel/kernel";
import type { NewContainer } from "@agent-kernel/db";

import { MELEE_KERNEL_ID } from "./config.js";

export interface MeleeKernelSpawnContext {
  appSessionId?: string;
  containerId?: string;
  containerLineage?: NewContainer[];
  phase?: string;
  workingDir?: string;
  metadata?: Record<string, unknown>;
}

export interface MeleeKernelSpawnOptions {
  model?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export type MeleeKernelSpawnAdapter<TResult = unknown> = KernelSpawnAdapter<
  MeleeKernelSpawnContext,
  MeleeKernelSpawnOptions,
  TResult
>;

export type CreateMeleeKernelOptions<
  TResult = unknown,
  TAgentManager extends KernelAgentManagerLike | undefined = undefined,
> = Omit<
  KernelConfig<
    MeleeKernelSpawnContext,
    MeleeKernelSpawnOptions,
    TResult,
    TAgentManager
  >,
  "id"
> & {
  id?: string;
};

export type MeleeKernelInstance<
  TResult = unknown,
  TAgentManager extends KernelAgentManagerLike | undefined = undefined,
> = KernelInstance<
  MeleeKernelSpawnContext,
  MeleeKernelSpawnOptions,
  TResult,
  TAgentManager
>;

export function createMeleeKernel<
  TResult = unknown,
  TAgentManager extends KernelAgentManagerLike | undefined = undefined,
>(
  options: CreateMeleeKernelOptions<TResult, TAgentManager>,
): MeleeKernelInstance<TResult, TAgentManager> {
  return createKernel({
    ...options,
    id: options.id ?? MELEE_KERNEL_ID,
  });
}
