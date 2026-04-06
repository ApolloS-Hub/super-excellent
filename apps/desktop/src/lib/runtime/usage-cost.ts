/**
 * Usage Cost — 使用量和费用统计
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/usage-cost.ts
 * Simplified: in-memory tracking without external data sources
 */

export interface UsageEvent {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface UsagePeriodSummary {
  key: "today" | "7d" | "30d";
  label: string;
  tokens: number;
  estimatedCost: number;
  requestCount: number;
  daysCovered: number;
  pace: { label: string; state: "rising" | "steady" | "cooling" | "unknown" };
}

export interface UsageBreakdownRow {
  key: string;
  label: string;
  tokens: number;
  estimatedCost: number;
  requests: number;
  sessions: number;
}

export interface UsageBudgetStatus {
  status: "ok" | "warn" | "over" | "not_connected";
  usedCost30d: number;
  limitCost30d?: number;
  burnRatePerDay?: number;
  message: string;
}

export interface UsageCostSnapshot {
  generatedAt: string;
  periods: UsagePeriodSummary[];
  breakdown: {
    byAgent: UsageBreakdownRow[];
    byModel: UsageBreakdownRow[];
    byProvider: UsageBreakdownRow[];
  };
  budget: UsageBudgetStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BUDGET_WARN_RATIO = 0.8;

let events: UsageEvent[] = [];
let budgetLimit: number | undefined;

export function recordUsage(event: UsageEvent): void {
  events.push(event);
}

export function setBudgetLimit(limit: number | undefined): void {
  budgetLimit = limit;
}

export function getBudgetLimit(): number | undefined {
  return budgetLimit;
}

export function buildUsageCostSnapshot(): UsageCostSnapshot {
  const now = Date.now();
  const todayIso = new Date(now).toISOString().slice(0, 10);

  const periods = buildPeriods(todayIso, now);
  const period30 = periods.find(p => p.key === "30d");
  const events30d = eventsWithinWindow(todayIso, 30);

  return {
    generatedAt: new Date().toISOString(),
    periods,
    breakdown: {
      byAgent: aggregate(events30d, e => e.agentId || "Unknown"),
      byModel: aggregate(events30d, e => e.model || "Unknown"),
      byProvider: aggregate(events30d, e => e.provider || inferProvider(e.model)),
    },
    budget: buildBudget(period30),
  };
}

export function getUsageEvents(): UsageEvent[] {
  return [...events];
}

export function clearUsageEvents(): void {
  events = [];
}

function buildPeriods(todayIso: string, _nowMs: number): UsagePeriodSummary[] {
  const windows: Array<{ key: "today" | "7d" | "30d"; days: number; label: string }> = [
    { key: "today", days: 1, label: "Today" },
    { key: "7d", days: 7, label: "Last 7 days" },
    { key: "30d", days: 30, label: "Last 30 days" },
  ];

  return windows.map(w => {
    const within = eventsWithinWindow(todayIso, w.days);
    const tokens = within.reduce((s, e) => s + e.tokensIn + e.tokensOut, 0);
    const cost = within.reduce((s, e) => s + e.cost, 0);
    const days = new Set(within.map(e => e.timestamp.slice(0, 10)));

    return {
      key: w.key,
      label: w.label,
      tokens,
      estimatedCost: cost,
      requestCount: within.length,
      daysCovered: days.size,
      pace: { label: "Steady", state: "steady" as const },
    };
  });
}

function eventsWithinWindow(todayIso: string, days: number): UsageEvent[] {
  const todayMs = Date.parse(`${todayIso}T00:00:00.000Z`);
  if (!Number.isFinite(todayMs)) return [];
  const lowerBound = todayMs - (days - 1) * DAY_MS;

  return events.filter(e => {
    const dayStr = e.timestamp.slice(0, 10);
    const dayMs = Date.parse(`${dayStr}T00:00:00.000Z`);
    return Number.isFinite(dayMs) && dayMs >= lowerBound && dayMs <= todayMs;
  });
}

function aggregate(
  evts: UsageEvent[],
  keySelector: (e: UsageEvent) => string,
): UsageBreakdownRow[] {
  const buckets = new Map<string, { row: UsageBreakdownRow; sessions: Set<string> }>();

  for (const e of evts) {
    const key = keySelector(e).trim() || "Unknown";
    const bucket = buckets.get(key) ?? {
      row: { key, label: key, tokens: 0, estimatedCost: 0, requests: 0, sessions: 0 },
      sessions: new Set<string>(),
    };
    bucket.row.tokens += e.tokensIn + e.tokensOut;
    bucket.row.estimatedCost += e.cost;
    bucket.row.requests += 1;
    bucket.sessions.add(e.sessionId);
    bucket.row.sessions = bucket.sessions.size;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map(b => b.row)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 12);
}

function buildBudget(period30?: UsagePeriodSummary): UsageBudgetStatus {
  const usedCost30d = period30?.estimatedCost ?? 0;

  if (budgetLimit === undefined) {
    return {
      status: "not_connected",
      usedCost30d,
      message: "No budget limit configured.",
    };
  }

  const ratio = budgetLimit > 0 ? usedCost30d / budgetLimit : 0;
  const burnRatePerDay = period30 && period30.daysCovered > 0
    ? usedCost30d / period30.daysCovered
    : undefined;

  if (ratio >= 1) {
    return {
      status: "over", usedCost30d, limitCost30d: budgetLimit,
      burnRatePerDay, message: "Burn rate exceeded monthly budget.",
    };
  }
  if (ratio >= BUDGET_WARN_RATIO) {
    return {
      status: "warn", usedCost30d, limitCost30d: budgetLimit,
      burnRatePerDay, message: "Burn rate is approaching the monthly budget.",
    };
  }
  return {
    status: "ok", usedCost30d, limitCost30d: budgetLimit,
    burnRatePerDay, message: "Burn rate is within monthly budget.",
  };
}

function inferProvider(model: string | undefined): string {
  if (!model) return "Unknown";
  const n = model.toLowerCase();
  if (n.includes("gpt") || n.includes("o1") || n.includes("o3")) return "OpenAI";
  if (n.includes("claude")) return "Anthropic";
  if (n.includes("gemini")) return "Google";
  if (n.includes("deepseek")) return "DeepSeek";
  if (n.includes("moonshot") || n.includes("kimi")) return "Moonshot";
  return "Unknown";
}
