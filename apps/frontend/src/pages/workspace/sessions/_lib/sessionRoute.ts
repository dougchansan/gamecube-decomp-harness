import type { SessionFocus } from "@/routing";
import type { SessionView } from "@/pages/workspace/_lib/types";

export function activeSessionFocus(view: Pick<SessionView, "activeSessionId" | "mode">): SessionFocus {
  return view.activeSessionId || "active";
}
