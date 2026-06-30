import { ensureKernelObservabilitySchema } from "@agent-kernel/db";
import * as schema from "@agent-kernel/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export const DEFAULT_AGENT_KERNEL_DATABASE_URL =
  "postgres://agent_kernel:agent_kernel@127.0.0.1:55432/agent_kernel";

export interface OpenColosseumKernelDatabaseOptions {
  databaseUrl?: string | null;
  maxConnections?: number;
  suppressNotices?: boolean;
}

export interface ColosseumKernelDatabaseHandle {
  db: unknown;
  databaseUrl: string | null;
  close: () => Promise<void>;
}

export function colosseumKernelDatabaseUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    env.ORCH_AGENT_KERNEL_DATABASE_URL ??
    env.AGENT_KERNEL_DATABASE_URL ??
    null
  );
}

export function colosseumKernelRuntimeRequiredFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return /^(1|true|yes)$/i.test(env.ORCH_AGENT_KERNEL_REQUIRED ?? "");
}

export async function openColosseumKernelDatabase(
  options: OpenColosseumKernelDatabaseOptions = {},
): Promise<ColosseumKernelDatabaseHandle> {
  const databaseUrl = options.databaseUrl ?? colosseumKernelDatabaseUrlFromEnv();
  if (!databaseUrl) {
    throw new Error(
      "Agent Kernel database URL is not configured; set ORCH_AGENT_KERNEL_DATABASE_URL or AGENT_KERNEL_DATABASE_URL.",
    );
  }

  const queryClient = postgres(databaseUrl, {
    max: options.maxConnections ?? 5,
    onnotice: options.suppressNotices === false ? undefined : () => {},
  });
  const db = drizzle(queryClient, { schema });

  return {
    db,
    databaseUrl,
    close: () => queryClient.end({ timeout: 1 }),
  };
}

export { ensureKernelObservabilitySchema };
