export const COLOSSEUM_LIVE_PROCESS_NAME = "pkmn-colosseum-live";

export function canonicalProcessName(value: unknown): string {
  const raw = (typeof value === "string" ? value : COLOSSEUM_LIVE_PROCESS_NAME).trim() || COLOSSEUM_LIVE_PROCESS_NAME;
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || COLOSSEUM_LIVE_PROCESS_NAME;
}

export function dashboardManagedProcessName(): string {
  return COLOSSEUM_LIVE_PROCESS_NAME;
}
