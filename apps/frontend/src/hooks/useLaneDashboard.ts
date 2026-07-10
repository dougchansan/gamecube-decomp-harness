import { useEffect, useRef, useState } from "react";
import { fetchDashboard } from "../lib/api";
import type { Dashboard, FormState } from "../lib/api-types";

interface UseLaneDashboardOptions {
  /** Only polls while true (e.g. the Run tab is open and a non-default lane is selected). */
  enabled: boolean;
  form: Pick<FormState, "projectId" | "usePathOverrides" | "repoRoot" | "stateDir" | "graphDbPath">;
  intervalMs: number;
  /** The run to scope the dashboard to; null/empty disables polling. */
  runId: string | null;
}

/**
 * A lightweight polling fetch of `/api/dashboard?runId=...` scoped to one
 * lane. Deliberately separate from useDashboardStream's SSE connection (which
 * drives the app's primary, unscoped dashboard used for session-lifecycle
 * actions) so switching lanes in the run view can never change which run
 * "start/stop/checkpoint/complete" actions target.
 */
export function useLaneDashboard({ enabled, form, intervalMs, runId }: UseLaneDashboardOptions) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (!enabled || !runId) {
      setDashboard(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await fetchDashboard(form, runId);
        if (!cancelled) setDashboard(snapshot);
      } catch {
        // Best-effort secondary view: keep the last good snapshot on a transient failure.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    timerRef.current = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, runId, intervalMs, form.projectId, form.usePathOverrides, form.repoRoot, form.stateDir, form.graphDbPath]);

  return { dashboard, loading };
}
