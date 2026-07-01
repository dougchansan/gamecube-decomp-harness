import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Track A — Iterative Model-Escalation Scheduling.
 *
 * A ladder is an ordered (weak -> strong) list of model "rungs". A target starts on
 * rung 0 and is promoted one rung each time it comes back non-exact (a "timeout"),
 * until it is cracked (exact) or the ladder is exhausted. See select-rung.ts for the
 * pure selection logic and worker-cycle.ts for the hook points (A2/A3/A5).
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface RungBudget {
  /** -> runPiAgent timeoutMs (agentTimeoutSeconds * 1000). */
  agentTimeoutSeconds: number;
  /** -> claim hold (claimNextEpochTarget ttl). Enforcement deferred to A4. */
  ttlSeconds: number;
  /** Per-rung repair-loop cap. Enforcement deferred to A4. */
  maxAttempts: number;
}

export interface RungTargetFilter {
  minSize?: number;
  maxSize?: number;
  minFuzzy?: number;
  maxFuzzy?: number;
}

export interface LadderRung {
  /** -> runPiAgent.provider */
  provider: string;
  /** -> runPiAgent.model */
  model: string;
  /** -> runPiAgent.thinkingLevel */
  thinking: ThinkingLevel;
  budget: RungBudget;
  targetFilter?: RungTargetFilter;
}

export type LadderMode = "escalation" | "full-matrix" | "hybrid";

export interface LadderConfig {
  id: string;
  mode: LadderMode;
  /** full-matrix probability for a target when mode=hybrid (0..1). */
  hybridSampleRate?: number;
  rungs: LadderRung[];
}

function validateLadder(ladder: LadderConfig, source: string): LadderConfig {
  if (!ladder || typeof ladder !== "object") throw new Error(`Ladder ${source} is not an object`);
  if (!Array.isArray(ladder.rungs) || ladder.rungs.length === 0) {
    throw new Error(`Ladder ${source} must define a non-empty "rungs" array`);
  }
  if (ladder.mode !== "escalation" && ladder.mode !== "full-matrix" && ladder.mode !== "hybrid") {
    throw new Error(`Ladder ${source} has invalid mode "${String(ladder.mode)}"`);
  }
  ladder.rungs.forEach((rung, index) => {
    if (!rung.provider || !rung.model || !rung.thinking) {
      throw new Error(`Ladder ${source} rung ${index} must define provider/model/thinking`);
    }
    if (!rung.budget || typeof rung.budget.agentTimeoutSeconds !== "number") {
      throw new Error(`Ladder ${source} rung ${index} must define budget.agentTimeoutSeconds`);
    }
  });
  return ladder;
}

const ladderCache = new Map<string, LadderConfig>();

/**
 * Load and validate a ladder from disk, cached per absolute path so a worker
 * process reads/parses it only once.
 */
export function loadLadder(path: string): LadderConfig {
  const absolute = resolve(path);
  const cached = ladderCache.get(absolute);
  if (cached) return cached;
  const raw = readFileSync(absolute, "utf8");
  const parsed = validateLadder(JSON.parse(raw) as LadderConfig, absolute);
  ladderCache.set(absolute, parsed);
  return parsed;
}
