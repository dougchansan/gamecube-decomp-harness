export const DETAILS_RAIL_MIN_WIDTH = 400;
export const DETAILS_RAIL_MAX_WIDTH = 860;
const DETAILS_RAIL_DEFAULT_WIDTH = 600;

export function loadDetailsCollapsed(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("details")) return false;
    const stored = localStorage.getItem("detailsCollapsed");
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

export function saveDetailsCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem("detailsCollapsed", collapsed ? "1" : "0");
  } catch {
    // The rail still works if storage is unavailable.
  }
}

export function loadSidebarCollapsed(): boolean {
  try {
    const stored = localStorage.getItem("sidebarCollapsed");
    return stored === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
  } catch {
    // The rail still works if storage is unavailable.
  }
}

export function clampDetailsWidth(width: number): number {
  if (!Number.isFinite(width)) return DETAILS_RAIL_DEFAULT_WIDTH;
  return Math.min(DETAILS_RAIL_MAX_WIDTH, Math.max(DETAILS_RAIL_MIN_WIDTH, Math.round(width)));
}

export function loadDetailsWidth(): number {
  try {
    const stored = localStorage.getItem("detailsWidth");
    if (stored === null) return DETAILS_RAIL_DEFAULT_WIDTH;
    return clampDetailsWidth(Number(stored));
  } catch {
    return DETAILS_RAIL_DEFAULT_WIDTH;
  }
}

export function saveDetailsWidth(width: number) {
  try {
    localStorage.setItem("detailsWidth", String(width));
  } catch {
    // The rail still works if storage is unavailable.
  }
}
