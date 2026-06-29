import { duration, durationBetween, until } from "@/lib/format";

function elapsedSince(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return duration(Date.now() - date.getTime());
}

export function activeRuntime(startValue: unknown, ttlValue: unknown) {
  const elapsed = elapsedSince(startValue);
  const remaining = until(ttlValue);
  const max = durationBetween(startValue, ttlValue);
  let secondary = "timeout unknown";
  if (remaining !== "expired" && remaining !== "-") secondary = `${remaining} left`;
  else if (remaining === "expired") secondary = "expired";
  else if (max !== "-") secondary = "timeout set";
  return {
    primary: elapsed,
    secondary,
    title: `Elapsed: ${elapsed}; Remaining: ${secondary}; Timeout: ${max}`,
  };
}
