import { useState } from "react";
import { RefreshCw } from "@/icons";

import { Button } from "@/components/primitives";
import { asArray, asObject, ago, num, text, type JsonObject } from "@/lib/format";

import { KnowledgeIntakePanel } from "./knowledge-intake-panel";
import { RailDetails } from "./rail-details";
import type { RunDetailsControls } from "../_lib/types";

const agentRoleOrder = ["worker", "integration-resolver", "knowledge-curator", "pr-indexer", "pr-splitter", "pr-reviewer", "pr-fixer", "reconcile", "qa-repair"];
const agentSessionsPerRole = 8;

function sessionStatusTone(status: string): string {
  if (status === "succeeded") return "text-up";
  if (status === "failed") return "text-down";
  return "text-dim";
}

function AgentSessionGroup({ role, sessions, claimSymbols }: { role: string; sessions: JsonObject[]; claimSymbols: Map<string, string> }) {
  const [showAll, setShowAll] = useState(false);
  const succeeded = sessions.filter((session) => text(session.status) === "succeeded").length;
  const failed = sessions.filter((session) => text(session.status) === "failed").length;
  const visible = showAll ? sessions : sessions.slice(0, agentSessionsPerRole);
  return (
    <div className="border border-line bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-line bg-raised px-2.5 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg">{role.replace(/-/g, " ")}</span>
        <span className="text-[11px] text-dim">
          {num(sessions.length)} session{sessions.length === 1 ? "" : "s"}
          {succeeded > 0 ? <span className="ml-1.5 text-up">{num(succeeded)} ok</span> : null}
          {failed > 0 ? <span className="ml-1.5 text-down">{num(failed)} failed</span> : null}
        </span>
      </div>
      <div className="grid gap-0.5 p-1.5">
        {visible.map((session) => {
          const symbol = claimSymbols.get(text(session.claimId)) ?? "";
          return (
            <div
              className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-2 px-1 py-0.5 text-xs"
              key={text(session.id)}
              title={text(session.outputPath) || text(session.sessionFile)}
            >
              <span className={`font-semibold ${sessionStatusTone(text(session.status))}`}>{text(session.status, "-").replace(/_/g, " ")}</span>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft">
                {symbol || text(session.model, "-")}
                {symbol ? <span className="ml-1.5 text-faint">{text(session.model)}</span> : null}
              </span>
              <span className="whitespace-nowrap text-[11px] text-dim" title={text(session.createdAt)}>{ago(session.createdAt)}</span>
            </div>
          );
        })}
        {sessions.length > agentSessionsPerRole ? (
          <button className="px-1 py-0.5 text-left text-[11px] text-dim hover:text-soft" onClick={() => setShowAll(!showAll)} type="button">
            {showAll ? "Show fewer" : `Show all ${num(sessions.length)}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AgentsTab({ loadRunDetails, loadingRunDetails, runDetails }: RunDetailsControls) {
  const sessions = asArray(runDetails?.sessions).map(asObject);
  const claims = asArray(runDetails?.targetClaims).map(asObject);
  const claimSymbols = new Map(claims.map((claim) => [text(claim.id), text(claim.symbol)]));
  const grouped = new Map<string, JsonObject[]>();
  for (const session of sessions) {
    const role = text(session.role, "unknown");
    grouped.set(role, [...(grouped.get(role) ?? []), session]);
  }
  const roles = [...agentRoleOrder.filter((role) => grouped.has(role)), ...[...grouped.keys()].filter((role) => !agentRoleOrder.includes(role))];

  if (!runDetails) {
    return <div className="p-3 text-dim">{loadingRunDetails ? "Loading agent sessions..." : "No run details loaded yet"}</div>;
  }

  return (
    <>
      <RailDetails open summary="Agent Sessions">
        <div className="grid gap-2">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <span className="text-dim">{num(sessions.length)} sessions across {num(roles.length)} role{roles.length === 1 ? "" : "s"}</span>
            <Button className="min-h-6 px-2 py-0.5" icon={<RefreshCw size={13} />} onClick={loadRunDetails} type="button">
              {loadingRunDetails ? "Loading" : "Refresh"}
            </Button>
          </div>
          {roles.map((role) => (
            <AgentSessionGroup key={role} claimSymbols={claimSymbols} role={role} sessions={grouped.get(role) ?? []} />
          ))}
          {roles.length === 0 ? <div className="text-dim">No agent sessions recorded for this run</div> : null}
        </div>
      </RailDetails>
      <RailDetails open summary="Knowledge Intake">
        <KnowledgeIntakePanel runDetails={runDetails} />
      </RailDetails>
    </>
  );
}
