/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Dashboard, FormState } from "@/lib/format";
import { activeSessionFocus } from "@/pages/workspace/sessions/_lib/sessionRoute";
import { deriveSessionView } from "./model";

const form = {
  projectId: "pkmn-colosseum",
  processName: "pkmn-colosseum-live",
  usePathOverrides: false,
} as unknown as FormState;

describe("workspace session view", () => {
  test("keeps canonical preparing sessions as concrete active session targets", () => {
    const dashboard = {
      projectSession: {
        id: "project-session:c850",
        sessionUuid: "c850",
        status: "active",
        phase: "preparing",
        activeSubphase: "baseline",
        gates: {},
        blockers: [],
        phases: {
          preparing: { status: "active", subphase: "baseline" },
          running: {},
          pr: {},
          complete: {},
        },
      },
      status: { run: {} },
      process: {},
      campaign: { head: {} },
      handoff: {},
      prs: {},
    } as unknown as Dashboard;

    const view = deriveSessionView(dashboard, null, form);

    expect(view.mode).toBe("none");
    expect(view.activeSessionId).toBe("c850");
    expect(view.activeSessionLabel).toBe("Session c850");
    expect(view.recommendedSub).toBe("prepare");
    expect(view.newSessionBlocked).toBe(true);
    expect(view.newSessionReasons).toContain("canonical session is preparing / baseline");
    expect(activeSessionFocus(view)).toBe("c850");
  });

  test("uses the active route only when no concrete active session exists", () => {
    expect(activeSessionFocus({ activeSessionId: "", mode: "none" })).toBe("active");
  });

  test("derives prepare sync summaries from canonical and legacy worktree fields", () => {
    const dashboard = {
      projectSession: {
        id: "project-session:c850",
        sessionUuid: "c850",
        status: "active",
        phase: "preparing",
        activeSubphase: "sync_intake",
        gates: {},
        blockers: [],
        phases: {
          preparing: {
            status: "active",
            subphase: "sync_intake",
            sync: {
              status: "complete",
              beforeRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              afterRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              mergedPrs: [2731, "2732"],
              mainWorktreePath: "/repo/projects/pkmn-colosseum/worktrees/upstream-current",
              sessionWorktreePath: "/repo/projects/pkmn-colosseum/worktrees/sessions/c850/current",
            },
          },
          running: {},
          pr: {},
          complete: {},
        },
      },
      status: { run: {} },
      process: {},
      campaign: { head: {} },
      handoff: {},
      prs: {},
    } as unknown as Dashboard;

    const view = deriveSessionView(dashboard, null, form);

    expect(view.prepareState.syncDone).toBe(true);
    expect(view.prepareState.headShortSha).toBe("bbbbbbbbbb");
    expect(view.prepareState.upstreamChanged).toBe(true);
    expect(view.prepareState.mergedPrs).toEqual([2731, 2732]);
    expect(view.prepareState.pendingIntakePrCount).toBe(2);
    expect(view.prepareState.upstreamWorktreePath).toBe("/repo/projects/pkmn-colosseum/worktrees/upstream-current");
    expect(view.prepareState.sessionCurrentWorktreePath).toBe("/repo/projects/pkmn-colosseum/worktrees/sessions/c850/current");
  });

  test("keeps PR index debt separate from git movement after resync", () => {
    const dashboard = {
      projectSession: {
        id: "project-session:c850",
        sessionUuid: "c850",
        status: "active",
        phase: "preparing",
        activeSubphase: "sync_intake",
        gates: {},
        blockers: [],
        phases: {
          preparing: {
            status: "active",
            subphase: "sync_intake",
            sync: {
              status: "complete",
              beforeRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              afterRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              mergedPrs: [],
              prIndexDebt: {
                status: "available",
                knownMergedPrs: 2518,
                agentIndexedMergedPrs: 2461,
                pendingMergedAgentPrs: 57,
                pendingAgentPrs: 63,
              },
            },
          },
          running: {},
          pr: {},
          complete: {},
        },
      },
      status: { run: {} },
      process: {},
      campaign: { head: {} },
      handoff: {},
      prs: {},
    } as unknown as Dashboard;

    const view = deriveSessionView(dashboard, null, form);

    expect(view.prepareState.syncDone).toBe(true);
    expect(view.prepareState.upstreamChanged).toBe(false);
    expect(view.prepareState.mergedPrs).toEqual([]);
    expect(view.prepareState.prIndexDebtKnown).toBe(true);
    expect(view.prepareState.pendingMergedPrIndexCount).toBe(57);
    expect(view.prepareState.pendingPrIndexCount).toBe(63);
    expect(view.prepareState.pendingIntakePrCount).toBe(63);
  });

  test("derives prepare intake item counts for retryable PR intake", () => {
    const dashboard = {
      projectSession: {
        id: "project-session:c850",
        sessionUuid: "c850",
        status: "active",
        phase: "preparing",
        activeSubphase: "processing_prs",
        gates: {},
        blockers: [],
        phases: {
          preparing: {
            status: "active",
            subphase: "processing_prs",
            sync: { status: "complete", mergedPrs: [] },
            intake: {
              status: "failed",
              itemCounts: {
                pending: 2,
                running: 1,
                complete: 4,
                failed: 3,
                retryable: 3,
                total: 10,
              },
            },
          },
          running: {},
          pr: {},
          complete: {},
        },
      },
      status: { run: {} },
      process: {},
      campaign: { head: {} },
      handoff: {},
      prs: {},
    } as unknown as Dashboard;

    const view = deriveSessionView(dashboard, null, form);

    expect(view.prepareState.pendingIntakePrCount).toBe(2);
    expect(view.prepareState.runningIntakeItemCount).toBe(1);
    expect(view.prepareState.completedIntakeItemCount).toBe(4);
    expect(view.prepareState.failedIntakeItemCount).toBe(3);
    expect(view.prepareState.retryableIntakeItemCount).toBe(3);
    expect(view.prepareState.totalIntakeItemCount).toBe(10);
  });
});
