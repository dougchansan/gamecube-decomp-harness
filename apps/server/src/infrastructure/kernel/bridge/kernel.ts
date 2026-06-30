import {
  createKernel,
  type KernelAgentManagerLike,
  type KernelConfig,
  type KernelInstance,
  type KernelSpawnAdapter,
} from "@agent-kernel/kernel";
import type { NewContainer } from "@agent-kernel/db";

import { COLOSSEUM_KERNEL_ID } from "./config.js";

export interface ColosseumKernelSpawnContext {
  appSessionId?: string;
  containerId?: string;
  containerLineage?: NewContainer[];
  phase?: string;
  workingDir?: string;
  metadata?: Record<string, unknown>;
}

export interface ColosseumKernelSpawnOptions {
  model?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export type ColosseumKernelSpawnAdapter<TResult = unknown> = KernelSpawnAdapter<
  ColosseumKernelSpawnContext,
  ColosseumKernelSpawnOptions,
  TResult
>;

export type CreateColosseumKernelOptions<
  TResult = unknown,
  TAgentManager extends KernelAgentManagerLike | undefined = undefined,
> = Omit<
  KernelConfig<
    ColosseumKernelSpawnContext,
    ColosseumKernelSpawnOptions,
    TResult,
    TAgentManager
  >,
  "id"
> & {
  id?: string;
};

export type ColosseumKernelInstance<
  TResult = unknown,
  TAgentManager extends KernelAgentManagerLike | undefined = undefined,
> = KernelInstance<
  ColosseumKernelSpawnContext,
  ColosseumKernelSpawnOptions,
  TResult,
  TAgentManager
>;

export function createColosseumKernel<
  TResult = unknown,
  TAgentManager extends KernelAgentManagerLike | undefined = undefined,
>(
  options: CreateColosseumKernelOptions<TResult, TAgentManager>,
): ColosseumKernelInstance<TResult, TAgentManager> {
  return createKernel({
    ...options,
    id: options.id ?? COLOSSEUM_KERNEL_ID,
  });
}
