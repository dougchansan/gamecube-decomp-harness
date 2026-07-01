import { asArray, asObject, duration, numberValue, pct, text } from "@/lib/format";
import type { Dashboard } from "@/lib/format";

// Compact token count, e.g. 12345 -> "12.3k", 4_500_000 -> "4.5M".
function compactTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function modelLabel(row: JsonObjectLike): string {
  const provider = text(row.provider);
  const model = text(row.model);
  const thinking = text(row.thinkingLevel);
  const base = [provider, model].filter(Boolean).join(" / ") || "unknown";
  return thinking ? `${base} · ${thinking}` : base;
}

type JsonObjectLike = ReturnType<typeof asObject>;

interface TokenBreakdownRow {
  key: string;
  label: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function tokenBreakdown(sessions: JsonObjectLike[]): TokenBreakdownRow[] {
  const byModel = new Map<string, TokenBreakdownRow>();
  for (const session of sessions) {
    const provider = text(session.provider);
    const model = text(session.model);
    const key = `${provider}|${model}`;
    const input = numberValue(session.inputTokens, 0);
    const output = numberValue(session.outputTokens, 0);
    const existing = byModel.get(key) ?? {
      key,
      label: [provider, model].filter(Boolean).join(" / ") || "unknown",
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    existing.sessions += 1;
    existing.inputTokens += input;
    existing.outputTokens += output;
    existing.totalTokens += input + output;
    byModel.set(key, existing);
  }
  return [...byModel.values()].sort((left, right) => right.totalTokens - left.totalTokens);
}

/**
 * Telemetry (Track B): per-model benchmark. The leaderboard rolls up attempts /
 * exact-match rate / median tokens-to-crack / median wall-clock-to-crack per
 * model (crack medians populate once escalation writes the denormalized keys),
 * and the token breakdown sums per-invocation usage per model from pi_sessions.
 */
export function ModelBenchmarkPanel({ dashboard }: { dashboard: Dashboard | null }) {
  const leaderboard = asArray(asObject(dashboard?.modelBenchmark).leaderboard).map(asObject);
  const sessions = asArray(dashboard?.piSessions).map(asObject);
  const breakdown = tokenBreakdown(sessions);
  const hasData = leaderboard.length > 0 || breakdown.length > 0;

  return (
    <div className="overflow-hidden rounded-none border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Model benchmark</span>
        <span className="text-[10px] text-dim">{leaderboard.length} models · {sessions.length} sessions</span>
      </div>
      {!hasData ? (
        <div className="px-3 py-4 text-[11px] text-dim">No model telemetry recorded yet.</div>
      ) : (
        <div className="grid gap-0 min-[1180px]:grid-cols-2">
          <div className="overflow-auto border-b border-line p-3 min-[1180px]:border-r min-[1180px]:border-b-0">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Leaderboard</div>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="w-16 text-right">Att</th>
                  <th className="w-16 text-right">Exact</th>
                  <th className="w-20 text-right">Rate</th>
                  <th className="w-24 text-right" title="Median input+output tokens to first exact match">Med tok</th>
                  <th className="w-24 text-right" title="Median wall-clock to first exact match">Med time</th>
                  <th className="w-24 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr>
                    <td className="text-dim" colSpan={7}>No attempts recorded.</td>
                  </tr>
                ) : (
                  leaderboard.map((row, index) => {
                    const attempts = numberValue(row.attempts, 0);
                    const exacts = numberValue(row.exacts, 0);
                    const successRate = numberValue(row.successRate, 0) * 100;
                    const medTokens = optionalNumber(row.medianTokensToCrack);
                    const medTime = optionalNumber(row.medianTimeToCrackMs);
                    const totalTokens = numberValue(row.totalTokens, 0);
                    return (
                      <tr key={`${text(row.provider)}|${text(row.model)}|${text(row.thinkingLevel)}|${index}`}>
                        <td className="max-w-0">
                          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={modelLabel(row)}>
                            {modelLabel(row)}
                          </span>
                        </td>
                        <td className="w-16 text-right tabular-nums text-soft">{attempts}</td>
                        <td className={`w-16 text-right tabular-nums ${exacts > 0 ? "text-up" : "text-soft"}`}>{exacts}</td>
                        <td className={`w-20 text-right tabular-nums ${successRate > 0 ? "text-up" : "text-dim"}`}>{pct(successRate)}</td>
                        <td className="w-24 text-right tabular-nums text-dim">{medTokens === null ? "n/a" : compactTokens(medTokens)}</td>
                        <td className="w-24 text-right tabular-nums text-dim">{medTime === null ? "n/a" : duration(medTime)}</td>
                        <td className="w-24 text-right tabular-nums text-soft">{compactTokens(totalTokens)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-auto p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">Tokens per model</div>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="w-20 text-right">Sessions</th>
                  <th className="w-24 text-right">In</th>
                  <th className="w-24 text-right">Out</th>
                  <th className="w-24 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.length === 0 ? (
                  <tr>
                    <td className="text-dim" colSpan={5}>No token usage recorded.</td>
                  </tr>
                ) : (
                  breakdown.map((row) => (
                    <tr key={row.key}>
                      <td className="max-w-0">
                        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg" title={row.label}>
                          {row.label}
                        </span>
                      </td>
                      <td className="w-20 text-right tabular-nums text-soft">{row.sessions}</td>
                      <td className="w-24 text-right tabular-nums text-dim">{compactTokens(row.inputTokens)}</td>
                      <td className="w-24 text-right tabular-nums text-dim">{compactTokens(row.outputTokens)}</td>
                      <td className="w-24 text-right tabular-nums text-soft">{compactTokens(row.totalTokens)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
