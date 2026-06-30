import { useState } from "react";
import { Button } from "@/components/primitives";
import { PlaceholderRows } from "./placeholder-rows";
import { TabButton } from "./tab-button";
import { improvedPageSize } from "../_lib/constants";
import {
  confirmedImprovementRows,
  confirmedMatchRows,
  confirmedRows,
  deltaColumnLabel,
  deltaColumnTitle,
  improvedEmptyText,
  reportRows,
  rowDelta,
  rowDeltaClass,
  rowDeltaTitle,
  rowItem,
  rowPath,
  rowScore,
  tentativeImprovementRows,
  tentativeMatchRows,
  tentativeRows,
} from "../_lib/improvements";
import type { ImprovedMode, ImprovedResultMode, WorkTablesProps } from "../_lib/types";
import { num, type Dashboard } from "@/lib/format";

interface ImprovedTableProps {
  dashboard: Dashboard | null;
  mode: ImprovedMode;
  page: number;
  setMode: (mode: ImprovedMode) => void;
  setPage: WorkTablesProps["setImprovedPage"];
}

export function ImprovedTable({ dashboard, mode, page, setMode, setPage }: ImprovedTableProps) {
  const [resultMode, setResultMode] = useState<ImprovedResultMode>("matches");
  const rows = reportRows(dashboard, mode, resultMode);
  const pages = Math.max(1, Math.ceil(rows.length / improvedPageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * improvedPageSize, safePage * improvedPageSize + improvedPageSize);
  const placeholderCount = improvedPageSize - visible.length - (visible.length === 0 ? 1 : 0);
  const matchCount = mode === "confirmed" ? confirmedMatchRows(dashboard).length : tentativeMatchRows(dashboard).length;
  const improvementCount = mode === "confirmed" ? confirmedImprovementRows(dashboard).length : tentativeImprovementRows(dashboard).length;

  function selectMode(nextMode: ImprovedMode) {
    setMode(nextMode);
    setPage(0);
  }

  function selectResultMode(nextMode: ImprovedResultMode) {
    setResultMode(nextMode);
    setPage(0);
  }

  return (
    <section className="h-full border-b border-line p-3 min-[1180px]:border-r min-[1180px]:border-b-0">
      <div className="mb-2 grid gap-2 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-start">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Confirmed and tentative worker results">
            <TabButton active={mode === "confirmed"} onClick={() => selectMode("confirmed")}>
              Confirmed ({num(confirmedRows(dashboard).length)})
            </TabButton>
            <TabButton active={mode === "tentative"} onClick={() => selectMode("tentative")}>
              Tentative ({num(tentativeRows(dashboard).length)})
            </TabButton>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={`${mode === "confirmed" ? "Confirmed" : "Tentative"} matches and improvements`}>
            <TabButton active={resultMode === "matches"} onClick={() => selectResultMode("matches")}>
              Matches ({num(matchCount)})
            </TabButton>
            <TabButton active={resultMode === "improvements"} onClick={() => selectResultMode("improvements")}>
              Improvements ({num(improvementCount)})
            </TabButton>
          </div>
        </div>
        <div className="flex min-h-7 items-center justify-end gap-2">
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">
            Prev
          </Button>
          <span className="min-w-12 text-center leading-7 text-dim">{safePage + 1}/{pages}</span>
          <Button className="min-w-12 px-2 py-0.5" disabled={safePage >= pages - 1 || rows.length === 0} onClick={() => setPage((current) => current + 1)} type="button">
            Next
          </Button>
        </div>
      </div>
      <div className="overflow-auto rounded-none border border-line">
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th className="w-[210px] text-left">Item</th>
              <th className="w-24 text-right">Score</th>
              <th className="w-24 text-right" title={deltaColumnTitle(mode)}>{deltaColumnLabel(mode)}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry, index) => (
              <tr className="row-rhythm-1" key={`${rowPath(entry)}-${rowItem(entry)}-${index}`}>
                <td className="text-path" title={rowPath(entry)}>{rowPath(entry)}</td>
                <td title={rowItem(entry)}>{rowItem(entry)}</td>
                <td className="text-right">{rowScore(entry)}</td>
                <td className={`text-right ${rowDeltaClass(entry)}`} title={rowDeltaTitle(entry)}>{rowDelta(entry)}</td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr className="row-rhythm-1">
                <td className="text-dim" colSpan={4}>{improvedEmptyText(dashboard, mode, resultMode)}</td>
              </tr>
            ) : null}
            <PlaceholderRows columns={4} count={placeholderCount} rhythm="match" />
          </tbody>
        </table>
      </div>
    </section>
  );
}
