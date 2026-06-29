import { useEffect } from "react";
import type { UiConfig } from "@/lib/format";

export function useHotReload(config: UiConfig | null) {
  useEffect(() => {
    if (!config?.hotReload || typeof EventSource === "undefined") return;
    const events = new EventSource("/api/dev-events");
    let connected = false;
    events.addEventListener("ready", () => {
      connected = true;
    });
    events.addEventListener("reload", () => {
      window.location.reload();
    });
    events.addEventListener("error", () => {
      if (!connected) return;
    });
    return () => events.close();
  }, [config]);
}
