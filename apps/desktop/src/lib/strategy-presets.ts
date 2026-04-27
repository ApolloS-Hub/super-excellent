/**
 * Strategy Presets + Stagnation Detection — Evolver-inspired
 *
 * Strategy presets control the secretary's "mood" — how aggressive vs
 * conservative it is on quality checks, retries, and worker selection.
 *
 * Stagnation detection tracks repeated failures per worker and escalates
 * (switch worker or degrade gracefully) instead of blind retries.
 */
import { emitAgentEvent } from "./event-bus";

// ═══════════ Strategy Presets ═══════════

export type StrategyPreset = "balanced" | "innovate" | "harden" | "repair";

export interface StrategyConfig {
  preset: StrategyPreset;
  qualityGateThreshold: number;  // 0-1, below this score → retry
  maxRetries: number;            // quality-gate retry attempts
  skipOptionalSteps: boolean;    // scenario-engine optional steps
  preferSeniorWorkers: boolean;  // prefer architect/reviewer over junior roles
  creativityBias: number;        // 0-1, higher = more novel approaches
}

const PRESETS: Record<StrategyPreset, StrategyConfig> = {
  balanced: {
    preset: "balanced",
    qualityGateThreshold: 0.6,
    maxRetries: 1,
    skipOptionalSteps: false,
    preferSeniorWorkers: false,
    creativityBias: 0.5,
  },
  innovate: {
    preset: "innovate",
    qualityGateThreshold: 0.4,  // more lenient — allow creative output through
    maxRetries: 0,               // don't retry; accept first attempt
    skipOptionalSteps: true,     // move fast, skip review steps
    preferSeniorWorkers: false,
    creativityBias: 0.8,
  },
  harden: {
    preset: "harden",
    qualityGateThreshold: 0.75, // stricter quality bar
    maxRetries: 2,               // retry twice
    skipOptionalSteps: false,
    preferSeniorWorkers: true,   // prefer experienced reviewers
    creativityBias: 0.3,
  },
  repair: {
    preset: "repair",
    qualityGateThreshold: 0.5,
    maxRetries: 2,
    skipOptionalSteps: true,     // skip non-essential steps to focus on fix
    preferSeniorWorkers: true,
    creativityBias: 0.1,        // conservative, proven approaches only
  },
};

const STORAGE_KEY = "strategy-preset";
let _current: StrategyConfig = { ...PRESETS.balanced };

export function getStrategy(): StrategyConfig {
  return { ..._current };
}

export function setStrategy(preset: StrategyPreset): StrategyConfig {
  _current = { ...PRESETS[preset] };
  try { localStorage.setItem(STORAGE_KEY, preset); } catch {}
  emitAgentEvent({ type: "intent_analysis", intentType: "strategy_change", text: `Strategy preset changed to: ${preset}` });
  return { ..._current };
}

export function loadStrategy(): StrategyConfig {
  _current = { ...PRESETS.balanced }; // always start from default
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as StrategyPreset | null;
    if (saved && PRESETS[saved]) _current = { ...PRESETS[saved] };
  } catch {}
  return { ..._current };
}

export function getPresetNames(): StrategyPreset[] {
  return ["balanced", "innovate", "harden", "repair"];
}

export function getPresetDescription(preset: StrategyPreset): string {
  const DESC: Record<StrategyPreset, string> = {
    balanced: "Default — 50/50 balance between quality and speed",
    innovate: "Creative mode — lenient quality, skip reviews, move fast",
    harden: "Strict mode — high quality bar, double retries, senior workers preferred",
    repair: "Fix mode — conservative approaches, skip non-essential steps, focus on resolution",
  };
  return DESC[preset];
}

// ═══════════ Stagnation Detection ═══════════

interface FailureRecord {
  workerId: string;
  count: number;
  lastFailedAt: number;
  lastCheckId: string;
}

const _failures = new Map<string, FailureRecord>();
const STAGNATION_THRESHOLD = 3;
const STAGNATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function recordFailure(workerId: string, checkId: string): void {
  const existing = _failures.get(workerId);
  const now = Date.now();
  if (existing && (now - existing.lastFailedAt) < STAGNATION_WINDOW_MS) {
    existing.count++;
    existing.lastFailedAt = now;
    existing.lastCheckId = checkId;
  } else {
    _failures.set(workerId, { workerId, count: 1, lastFailedAt: now, lastCheckId: checkId });
  }
}

export function isStagnant(workerId: string): boolean {
  const record = _failures.get(workerId);
  if (!record) return false;
  const isRecent = (Date.now() - record.lastFailedAt) < STAGNATION_WINDOW_MS;
  return isRecent && record.count >= STAGNATION_THRESHOLD;
}

export function getFailureCount(workerId: string): number {
  const record = _failures.get(workerId);
  if (!record) return 0;
  if ((Date.now() - record.lastFailedAt) >= STAGNATION_WINDOW_MS) return 0;
  return record.count;
}

export function clearFailures(workerId: string): void {
  _failures.delete(workerId);
}

export function clearAllFailures(): void {
  _failures.clear();
}

/**
 * Suggest an alternative worker when the current one is stagnant.
 * Falls back through a role affinity map.
 */
const WORKER_FALLBACKS: Record<string, string[]> = {
  developer: ["frontend", "architect"],
  frontend: ["developer", "ux_designer"],
  writer: ["content_ops", "product"],
  product: ["project_manager", "researcher"],
  architect: ["developer", "security"],
  code_reviewer: ["architect", "security"],
  tester: ["developer", "code_reviewer"],
  researcher: ["data_analyst", "writer"],
  project_manager: ["ops_director", "product"],
  ops_director: ["project_manager", "financial_analyst"],
};

export function suggestAlternativeWorker(stagnantWorkerId: string): string | null {
  const fallbacks = WORKER_FALLBACKS[stagnantWorkerId];
  if (!fallbacks) return null;
  // Return first non-stagnant fallback
  for (const alt of fallbacks) {
    if (!isStagnant(alt)) return alt;
  }
  return null;
}

// ═══════════ Init ═══════════

export function initStrategy(): void {
  loadStrategy();
}
