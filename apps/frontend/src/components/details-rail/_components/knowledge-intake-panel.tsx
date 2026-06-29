import type { ReactNode } from "react";

import { asArray, asObject, ago, num, text, type RunDetails } from "@/lib/format";

function lessonKindLabel(kind: string): string {
  if (kind === "worker_lesson") return "worker";
  if (kind === "pr_lesson") return "pr";
  if (kind === "source_update_proposal") return "proposal";
  return kind || "lesson";
}

function Callout({ children, tone }: { children: ReactNode; tone: "ok" | "warn" }) {
  return (
    <div className={`rounded-none border p-2 text-xs leading-5 ${tone === "ok" ? "border-line bg-inset text-soft" : "border-warn/40 bg-warn/5 text-warn"}`}>
      {children}
    </div>
  );
}

export function KnowledgeIntakePanel({ runDetails }: { runDetails: RunDetails | null }) {
  const intake = asObject(runDetails?.knowledgeIntake);
  const curatorRuns = asArray(intake.curatorRuns).map(asObject);
  const lessons = asArray(intake.recentLessons).map(asObject);
  const mergedPrs = asArray(intake.mergedPrUpdates).map(asObject);
  const sessions = asArray(runDetails?.sessions).map(asObject);
  const workerStates = asArray(runDetails?.workerStates).map(asObject);

  const lastWorkerStateAt = workerStates.reduce((latest, workerState) => {
    const at = text(workerState.createdAt);
    return at > latest ? at : latest;
  }, "");
  const lastIntakeAt = [
    ...sessions.filter((session) => text(session.role) === "knowledge-curator").map((session) => text(session.createdAt)),
    ...curatorRuns.map((run) => text(run.startedAt)),
  ].reduce((latest, at) => (at > latest ? at : latest), "");
  const intakeStale = Boolean(lastWorkerStateAt) && (!lastIntakeAt || lastIntakeAt < lastWorkerStateAt);

  return (
    <div className="grid gap-2">
      {lastWorkerStateAt ? (
        intakeStale ? (
          <Callout tone="warn">
            No knowledge intake recorded since the last worker state ({ago(lastWorkerStateAt)}). Run sync / kg-curate so the curator folds this run&apos;s learnings into the knowledge base.
          </Callout>
        ) : (
          <Callout tone="ok">
            Knowledge intake is current: latest curator activity {ago(lastIntakeAt)}, latest worker state {ago(lastWorkerStateAt)}.
          </Callout>
        )
      ) : null}

      <div className="border border-line bg-card">
        <div className="border-b border-line bg-raised px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-fg">Curator agent runs</div>
        <div className="grid gap-0.5 p-1.5">
          {curatorRuns.map((run) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-1 py-0.5 text-xs" key={text(run.id)} title={text(run.outputPath) || text(run.dir)}>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft">{text(run.id)}</span>
              <span className="whitespace-nowrap text-[11px] text-dim">{ago(run.startedAt)}</span>
            </div>
          ))}
          {curatorRuns.length === 0 ? <div className="px-1 py-0.5 text-xs text-dim">No curator agent runs recorded in this state dir</div> : null}
        </div>
      </div>

      <div className="border border-line bg-card">
        <div className="border-b border-line bg-raised px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-fg">Merged PR intake</div>
        <div className="grid gap-0.5 p-1.5">
          {mergedPrs.map((row) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-1 py-0.5 text-xs" key={`pr-${text(row.pr)}`}>
              <span className="min-w-0 text-soft">
                PR #{num(row.pr)} <span className="text-faint">{num(row.touchedFiles)} file{Number(row.touchedFiles) === 1 ? "" : "s"}</span>
              </span>
              <span className="whitespace-nowrap text-[11px] text-dim" title={`merged ${text(row.mergedAt)} / indexed ${text(row.indexedAt)}`}>
                indexed {ago(row.indexedAt)}
              </span>
            </div>
          ))}
          {mergedPrs.length === 0 ? <div className="px-1 py-0.5 text-xs text-dim">No merged PRs ingested into the graph yet</div> : null}
        </div>
      </div>

      <div className="border border-line bg-card">
        <div className="border-b border-line bg-raised px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-fg">Curated lessons</div>
        <div className="grid gap-0.5 p-1.5">
          {lessons.map((lesson) => (
            <div className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-2 px-1 py-0.5 text-xs" key={text(lesson.id)} title={`${text(lesson.title)}\n${text(lesson.sourcePath)}\nstatus: ${text(lesson.status)} / confidence ${text(lesson.confidence)}`}>
              <span className={`text-[10px] font-semibold uppercase ${text(lesson.status) === "accepted" ? "text-up" : "text-dim"}`}>{lessonKindLabel(text(lesson.kind))}</span>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft">{text(lesson.title, text(lesson.id))}</span>
            </div>
          ))}
          {lessons.length === 0 ? <div className="px-1 py-0.5 text-xs text-dim">No curated lessons in the enrichment log yet</div> : null}
        </div>
      </div>
    </div>
  );
}
