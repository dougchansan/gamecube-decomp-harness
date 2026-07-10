import type { LadderRung } from "@/lib/format";

// Compact horizontal escalation-ladder stepper: one segment per rung the run
// has actually used, the row's current rung highlighted, and the agent
// currently working it labeled. Renders nothing when the row has no rung yet
// (e.g. its first attempt hasn't been claimed/scored) or the run hasn't
// exercised any rungs.
export function LadderTrace({
  currentRung,
  latestModel,
  latestProvider,
  latestThinking,
  rungs,
}: {
  currentRung: number | null;
  latestModel: string | null;
  latestProvider: string | null;
  latestThinking: string | null;
  rungs: LadderRung[];
}) {
  if (currentRung === null || rungs.length === 0) return null;

  const activeRung = rungs.find((rung) => rung.level === currentRung) ?? null;
  const agentLabel = activeRung?.label ?? latestModel ?? `rung ${currentRung}`;
  const legend = rungs.map((rung) => `${rung.level}: ${rung.label}${rung.provider ? ` (${rung.provider})` : ""}`).join("\n");

  return (
    <div className="ladder-trace" title={`Escalation ladder\n${legend}`}>
      <div className="ladder-trace-dots" role="img" aria-label={`Escalation ladder, currently at rung ${currentRung} of ${rungs.length - 1}`}>
        {rungs.map((rung) => {
          const state = rung.level < currentRung ? "climbed" : rung.level === currentRung ? "active" : "pending";
          return (
            <span
              className={`ladder-dot ladder-dot-${state}`}
              key={rung.level}
              title={`rung ${rung.level}: ${rung.label}${rung.provider ? ` · ${rung.provider}` : ""}`}
            />
          );
        })}
      </div>
      <span
        className="ladder-trace-label"
        title={latestModel ? `${latestProvider ? `${latestProvider} / ` : ""}${latestModel}${latestThinking ? ` · ${latestThinking}` : ""}` : agentLabel}
      >
        {agentLabel}
      </span>
    </div>
  );
}
