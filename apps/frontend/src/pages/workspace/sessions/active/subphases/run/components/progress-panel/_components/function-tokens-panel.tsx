import { useState } from "react";
import { asArray, asObject, numberValue, text } from "@/lib/format";
import type { Dashboard } from "@/lib/format";

type SortKey = "tokens" | "cost";

// Compact token count, e.g. 12345 -> "12.3k", 4_500_000 -> "4.5M".
function compactTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function usd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}

function modelLabel(row: ReturnType<typeof asObject>): string {
  return [text(row.provider), text(row.model)].filter(Boolean).join(" / ") || "unknown";
}

/**
 * Per-function token/cost for the active run: pi_sessions rolled up onto the
 * epoch target they worked on. Sortable by total tokens or cost.
 */
export function FunctionTokensPanel({ dashboard }: { dashboard: Dashboard | null }) {
  const [sortKey, setSortKey] = useState<SortKey>("tokens");
  const rows = asArray(dashboard?.functionTokens).map(asObject);
  const sorted = [...rows].sort((left, right) =>
    sortKey === "cost"
      ? numberValue(right.costUsd, 0) - numberValue(left.costUsd, 0)
      : numberValue(right.totalTokens, 0) - numberValue(left.totalTokens, 0),
  );
  const totalTokens = rows.reduce((sum, row) => sum + numberValue(row.totalTokens, 0), 0);

  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Tokens per function</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-dim">{rows.length} fns · {compactTokens(totalTokens)} tok</span>
          <div className="flex items-center gap-1" role="tablist">
            {(["tokens", "cost"] as SortKey[]).map((key) => (
              <button
                aria-selected={sortKey === key}
                className={`min-h-6 border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${sortKey === key ? "border-line2 bg-raised text-fg" : "border-line bg-card text-dim hover:border-line2 hover:text-soft"}`}
                key={key}
                onClick={() => setSortKey(key)}
                role="tab"
                type="button"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-auto p-3">
        <table>
          <thead>
            <tr>
              <th>Function</th>
              <th className="w-40">Provider / model</th>
              <th className="w-16 text-right">Sess</th>
              <th className="w-24 text-right">Tokens</th>
              <th className="w-20 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="text-dim" colSpan={5}>No per-function token usage recorded yet.</td>
              </tr>
            ) : (
              sorted.map((row) => {
                const symbol = text(row.symbol) || "unknown";
                const sourcePath = text(row.sourcePath);
                return (
                  <tr key={text(row.epochTargetId) || symbol}>
                    <td className="max-w-0">
                      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={symbol}>{symbol}</span>
                      {sourcePath ? <span className="mt-0.5 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-dim" title={sourcePath}>{sourcePath}</span> : null}
                    </td>
                    <td className="w-40">
                      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft" title={modelLabel(row)}>{modelLabel(row)}</span>
                    </td>
                    <td className="w-16 text-right tabular-nums text-dim">{numberValue(row.sessions, 0)}</td>
                    <td className="w-24 text-right tabular-nums text-soft">{compactTokens(numberValue(row.totalTokens, 0))}</td>
                    <td className="w-20 text-right tabular-nums text-dim">{usd(numberValue(row.costUsd, 0))}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
