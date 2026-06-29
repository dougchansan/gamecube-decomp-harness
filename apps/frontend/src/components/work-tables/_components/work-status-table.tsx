import { useState } from "react";
import { Button } from "@/components/primitives";
import { ActiveRows } from "@/components/work-tables/_components/active-rows";
import { PlaceholderRows } from "@/components/work-tables/_components/placeholder-rows";
import { EpochRows } from "@/components/work-tables/_components/queue-rows";
import { TabButton } from "@/components/work-tables/_components/tab-button";
import { workPageSize } from "@/components/work-tables/_lib/constants";
import type { WorkMode } from "@/components/work-tables/_lib/types";
import { num, type Dashboard } from "@/lib/format";

export function WorkStatusTable({ dashboard, mode, setMode }: { dashboard: Dashboard | null; mode: WorkMode; setMode: (mode: WorkMode) => void }) {
  const [page, setPage] = useState(0);
  const activeFiles = dashboard?.activeFiles || [];
  const epochFiles = (dashboard?.epochTargets || []).filter((target) => target.epochTargetStatus === "admitted");
  const allRows = mode === "epoch" ? epochFiles : activeFiles;
  const pages = Math.max(1, Math.ceil(allRows.length / workPageSize));
  const safePage = Math.min(page, pages - 1);
  const rows = allRows.slice(safePage * workPageSize, safePage * workPageSize + workPageSize);
  const emptyText = mode === "epoch" ? "No admitted epoch targets right now" : "No active claims right now";
  // Every work entry occupies a 64px unit (active: 44+20, queue/errors: 64), so
  // padding to 12 units keeps this table the height of 24 match rows.
  const placeholderCount = workPageSize - rows.length - (rows.length === 0 ? 1 : 0);

  function selectMode(nextMode: WorkMode) {
    setMode(nextMode);
    setPage(0);
  }

  return (
    <section className="h-full p-3">
      <div className="mb-2 flex h-7 items-center justify-between gap-3 overflow-visible">
        <div className="flex items-center gap-1.5 whitespace-nowrap" role="tablist" aria-label="Work status">
          <TabButton active={mode === "active"} onClick={() => selectMode("active")}>
            Active ({num(activeFiles.length)})
          </TabButton>
          <TabButton active={mode === "epoch"} onClick={() => selectMode("epoch")}>
            Epoch ({num(epochFiles.length)})
          </TabButton>
        </div>
        <div className="flex min-h-7 items-center gap-2">
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))} type="button">
            Prev
          </Button>
          <span className="min-w-12 text-center leading-7 text-dim">{safePage + 1}/{pages}</span>
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage >= pages - 1 || allRows.length === 0} onClick={() => setPage(safePage + 1)} type="button">
            Next
          </Button>
        </div>
      </div>
      <div className="overflow-auto rounded-none border border-line">
        <table className={mode === "active" ? "active-table" : ""}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="w-[92px] text-right">Fuzzy</th>
              <th
                className="w-32 text-right"
                title={
                  mode === "epoch"
                    ? "Epoch target status. The second line shows priority."
                    : "Elapsed worker claim time. The second line shows time left before timeout."
                }
              >
                {mode === "active" ? "Elapsed" : "Status"}
              </th>
            </tr>
          </thead>
          <tbody>
            {mode === "active" ? <ActiveRows rows={rows} /> : <EpochRows rows={rows} />}
            {rows.length === 0 ? (
              <tr className={mode === "active" ? "row-rhythm-main" : "row-rhythm-2"}>
                <td className="text-dim" colSpan={3}>{emptyText}</td>
              </tr>
            ) : null}
            {rows.length === 0 && mode === "active" ? (
              <tr className="row-rhythm-sub">
                <td colSpan={3} />
              </tr>
            ) : null}
            <PlaceholderRows columns={3} count={placeholderCount} rhythm={mode === "active" ? "active" : "queue"} startIndex={rows.length || 1} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
