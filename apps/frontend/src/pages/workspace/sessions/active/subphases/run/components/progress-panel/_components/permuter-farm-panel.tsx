import { asArray, asObject, duration, numberValue, score, text } from "@/lib/format";
import type { Dashboard } from "@/lib/format";

function scoreOrNa(value: unknown): string {
  return value === null || value === undefined ? "n/a" : score(value);
}

// Whole-system wall-draw estimate, e.g. 214 -> "214W". Sampled CPU util isn't
// always available (SSH hiccup, missing config), so 0/absent renders as "n/a".
function watts(value: unknown): string {
  const n = numberValue(value, 0);
  return n > 0 ? `${Math.round(n)}W` : "n/a";
}

function kwh(value: unknown): string {
  return numberValue(value, 0).toFixed(2);
}

function usd(value: unknown): string {
  return `$${numberValue(value, 0).toFixed(2)}`;
}

/**
 * Permuter-farm status. The permuter_status / permuter_farm_summary tables are
 * owned by a separate process; the read-model returns `available: false` when
 * they are missing, in which case this panel renders nothing.
 */
export function PermuterFarmPanel({ dashboard }: { dashboard: Dashboard | null }) {
  const permuter = asObject(dashboard?.permuterFarms);
  if (permuter.available !== true) return null;
  const farms = asArray(permuter.farms).map(asObject);
  const active = asArray(permuter.active).map(asObject);
  const functionCost = asArray(dashboard?.functionCost).map(asObject);

  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Permuter farms</span>
        <span className="text-[10px] text-dim">{farms.length} farms · {active.length} active</span>
      </div>
      {farms.length === 0 && active.length === 0 ? (
        <div className="px-3 py-4 text-[11px] text-dim">No permuter activity recorded yet.</div>
      ) : (
        <div className="grid gap-0 min-[1180px]:grid-cols-2">
          <div className="overflow-auto border-b border-line p-3 min-[1180px]:border-r min-[1180px]:border-b-0">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Farm summary</div>
            <table>
              <thead>
                <tr>
                  <th>Farm</th>
                  <th className="w-16 text-right">Wk</th>
                  <th className="w-16 text-right">Act</th>
                  <th className="w-16 text-right">Que</th>
                  <th className="w-16 text-right">Win</th>
                </tr>
              </thead>
              <tbody>
                {farms.length === 0 ? (
                  <tr>
                    <td className="text-dim" colSpan={5}>No farm summary rows.</td>
                  </tr>
                ) : (
                  farms.map((row) => (
                    <tr key={text(row.farm)}>
                      <td className="max-w-0">
                        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={text(row.farm)}>{text(row.farm) || "unknown"}</span>
                        <span className="mt-0.5 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-dim">
                          {"⚡"} {watts(row.currentWatts)} · {kwh(row.cumulativeKwh)} kWh · {usd(row.cumulativeCostUsd)}
                        </span>
                      </td>
                      <td className="w-16 text-right tabular-nums text-soft">{numberValue(row.workers, 0)}</td>
                      <td className="w-16 text-right tabular-nums text-soft">{numberValue(row.active, 0)}</td>
                      <td className="w-16 text-right tabular-nums text-dim">{numberValue(row.queued, 0)}</td>
                      <td className={`w-16 text-right tabular-nums ${numberValue(row.wins, 0) > 0 ? "text-up" : "text-dim"}`}>{numberValue(row.wins, 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-auto p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Active permutations</div>
            <table>
              <thead>
                <tr>
                  <th>Function</th>
                  <th className="w-20">Farm</th>
                  <th className="w-16 text-right">Elapsed</th>
                  <th className="w-20 text-right">Best</th>
                </tr>
              </thead>
              <tbody>
                {active.length === 0 ? (
                  <tr>
                    <td className="text-dim" colSpan={4}>No functions being permuted.</td>
                  </tr>
                ) : (
                  active.map((row, index) => (
                    <tr key={`${text(row.farm)}|${text(row.functionName)}|${index}`}>
                      <td className="max-w-0">
                        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={text(row.functionName)}>{text(row.functionName) || "unknown"}</span>
                      </td>
                      <td className="w-20">
                        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft" title={text(row.farm)}>{text(row.farm)}</span>
                      </td>
                      <td className="w-16 text-right tabular-nums text-dim">{duration(numberValue(row.permutationSeconds, 0) * 1000)}</td>
                      <td className="w-20 text-right tabular-nums text-soft">{scoreOrNa(row.bestScore)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {functionCost.length > 0 ? (
        <div className="overflow-auto border-t border-line p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Electricity cost per function</div>
          <table>
            <thead>
              <tr>
                <th>Function</th>
                <th className="w-20">Farm</th>
                <th className="w-16 text-right">Time</th>
                <th className="w-20 text-right">kWh</th>
                <th className="w-20 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {functionCost.map((row, index) => (
                <tr key={`${text(row.farm)}|${text(row.functionName)}|${index}`}>
                  <td className="max-w-0">
                    <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={text(row.functionName)}>{text(row.functionName) || "unknown"}</span>
                  </td>
                  <td className="w-20">
                    <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft" title={text(row.farm)}>{text(row.farm)}</span>
                  </td>
                  <td className="w-16 text-right tabular-nums text-dim">{duration(numberValue(row.permutationSeconds, 0) * 1000)}</td>
                  <td className="w-20 text-right tabular-nums text-soft">{kwh(row.kwh)}</td>
                  <td className="w-20 text-right tabular-nums text-soft">{usd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
