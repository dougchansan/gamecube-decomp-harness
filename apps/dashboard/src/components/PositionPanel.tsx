import { asArray, asObject, text, type Dashboard } from "@decomp-orchestrator/ui-contract";

export function shortSha(value: unknown): string {
  const sha = text(value);
  return sha ? sha.slice(0, 8) : "-";
}

export function agoText(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface CampaignState {
  label: string;
  sub: string;
  tone: "up" | "warn" | "dim";
}

/**
 * The campaign-level operating state, derived from run status, process
 * liveness, and the upstream position: working, preparing PR, idle and
 * needing sync, or idle and synced at the last checkpoint.
 */
export function campaignState(dashboard: Dashboard | null): CampaignState {
  const run = asObject(dashboard?.status?.run);
  const runStatus = text(run.status);
  const proc = asObject(dashboard?.process);
  const activeLeases = Number(asObject(dashboard?.status).activeLeases || 0);
  const processLive = proc.running === true || asArray(proc.knownProcesses).map(asObject).some((item) => item.alive === true);
  const campaign = asObject(dashboard?.campaign);
  const behind = Number(campaign.behindBase);

  if (runStatus === "active") {
    return processLive
      ? { label: "Working", sub: `${activeLeases} active lease(s) — sync locked; handoff stops work first`, tone: "up" }
      : {
          label: "Working — stopped",
          sub: activeLeases > 0 ? `stopped with ${activeLeases} stale lease(s) — start work or prepare handoff` : "run is active but no workers; start work or prepare handoff",
          tone: "warn",
        };
  }
  if (runStatus === "paused") {
    return { label: "Preparing PR", sub: "intake paused — checkpoint, QA, and split plan", tone: "warn" };
  }
  if (Number.isFinite(behind) && behind > 0) {
    return { label: "Idle — needs sync", sub: `${behind} commit(s) behind upstream (as of last fetch)`, tone: "warn" };
  }
  return { label: "Idle — synced", sub: "at the last checkpoint; ready to init a run", tone: "up" };
}

export const stateToneClass: Record<CampaignState["tone"], string> = {
  up: "border-up/50 text-up",
  warn: "border-warn/50 text-warn",
  dim: "border-line2 text-dim",
};
