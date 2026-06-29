import { text } from "@/lib/format";

export function formatElapsed(fromIso: unknown, toIso?: unknown): string {
  const from = Date.parse(text(fromIso));
  const to = toIso ? Date.parse(text(toIso)) : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "";
  const totalSeconds = Math.floor((to - from) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
