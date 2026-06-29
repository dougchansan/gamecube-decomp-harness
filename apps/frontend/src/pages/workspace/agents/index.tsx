import { useEffect, useState } from "react";
import { AgentCatalogViewer } from "@agent-kernel/viewer-ui";
import { fetchKernelAgents, type KernelAgentsPayload } from "@/lib/api";
import type { FormState } from "@/lib/format";

export function AgentsPage({ form }: { form: FormState }) {
  const [payload, setPayload] = useState<KernelAgentsPayload | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const agents = payload?.agents ?? [];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const nextPayload = await fetchKernelAgents(form);
        if (cancelled) return;
        setPayload(nextPayload);
        setSelectedAgentName((current) =>
          current && nextPayload.agents.some((agent) => agent.name === current)
            ? current
            : nextPayload.agents[0]?.name ?? null,
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [form.graphDbPath, form.projectId, form.repoRoot, form.stateDir, form.usePathOverrides]);

  return (
    <div className="kernel-reference-workspace min-h-0 flex-1 overflow-auto bg-background p-4 font-sans text-foreground">
      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {payload?.warnings.length ? (
        <div className="mb-4 rounded-lg border border-status-warning-border bg-status-warning-fill px-3.5 py-3 text-sm text-status-warning">
          {payload.warnings.join(" ")}
        </div>
      ) : null}
      <div className="h-[calc(100vh-2rem)] min-h-[620px] w-full">
        <AgentCatalogViewer
          agents={agents}
          selectedName={selectedAgentName}
          onSelectedNameChange={setSelectedAgentName}
          className="h-full"
          emptyState={loading ? "Loading agents" : undefined}
        />
      </div>
    </div>
  );
}
