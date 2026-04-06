/**
 * Diagnostics Bundle — Collect System State for Debugging
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/diagnostics-bundle.ts
 *
 * Gathers runtime information, token presence, recent issues, and
 * connection status into a single inspectable bundle.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightStatus = "ok" | "degraded" | "down" | "unknown";

export interface DiagnosticsBundle {
  generatedAt: string;
  app: {
    name: string;
    version?: string;
  };
  runtime: {
    platform: string;
    userAgent: string;
    language: string;
    onLine: boolean;
    memoryMB?: number;
    cpuCores?: number;
  };
  connection: {
    overallStatus: InsightStatus;
    items: ConnectionItem[];
  };
  tokens: {
    redacted: true;
    entries: TokenPresence[];
  };
  recentIssues: IssueEntry[];
}

export interface ConnectionItem {
  key: string;
  status: InsightStatus;
  value: string;
  detail: string;
}

export interface TokenPresence {
  key: string;
  present: boolean;
  note: string;
}

export interface IssueEntry {
  timestamp: string;
  severity: "warn" | "error";
  action: string;
  source: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Issue log (in-memory)
// ---------------------------------------------------------------------------

const issueLogs: IssueEntry[] = [];
const MAX_ISSUES = 100;

export function recordIssue(input: {
  severity: "warn" | "error";
  action: string;
  source: string;
  detail: string;
}): IssueEntry {
  const entry: IssueEntry = { ...input, timestamp: new Date().toISOString() };
  issueLogs.push(entry);
  if (issueLogs.length > MAX_ISSUES) issueLogs.splice(0, issueLogs.length - MAX_ISSUES);
  return entry;
}

export function getRecentIssues(limit = 8): IssueEntry[] {
  return issueLogs
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Token registry
// ---------------------------------------------------------------------------

const tokenRegistry: TokenPresence[] = [];

export function registerToken(key: string, present: boolean, note: string): void {
  const existing = tokenRegistry.find(t => t.key === key);
  if (existing) {
    existing.present = present;
    existing.note = note;
  } else {
    tokenRegistry.push({ key, present, note });
  }
}

// ---------------------------------------------------------------------------
// Connection probes
// ---------------------------------------------------------------------------

const connectionProbes = new Map<string, ConnectionItem>();

export function reportConnectionStatus(item: ConnectionItem): void {
  connectionProbes.set(item.key, item);
}

function resolveOverallStatus(items: ConnectionItem[]): InsightStatus {
  if (items.length === 0) return "unknown";
  if (items.every(i => i.status === "ok")) return "ok";
  if (items.some(i => i.status === "down")) return "down";
  if (items.some(i => i.status === "degraded")) return "degraded";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Collect bundle
// ---------------------------------------------------------------------------

export function collectDiagnosticsBundle(options?: {
  appName?: string;
  appVersion?: string;
}): DiagnosticsBundle {
  const items = [...connectionProbes.values()];
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const perf = typeof performance !== "undefined" ? performance : undefined;

  let memoryMB: number | undefined;
  if (perf) {
    const mem = (perf as unknown as Record<string, unknown>)["memory"] as
      | { usedJSHeapSize?: number }
      | undefined;
    if (mem?.usedJSHeapSize) {
      memoryMB = Math.round(mem.usedJSHeapSize / (1024 * 1024));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: options?.appName ?? "super-excellent",
      version: options?.appVersion,
    },
    runtime: {
      platform: nav?.platform ?? "unknown",
      userAgent: nav?.userAgent ?? "unknown",
      language: nav?.language ?? "en",
      onLine: nav?.onLine ?? true,
      memoryMB,
      cpuCores: nav?.hardwareConcurrency,
    },
    connection: {
      overallStatus: resolveOverallStatus(items),
      items,
    },
    tokens: {
      redacted: true,
      entries: [...tokenRegistry],
    },
    recentIssues: getRecentIssues(),
  };
}

// ---------------------------------------------------------------------------
// Format text
// ---------------------------------------------------------------------------

export function formatDiagnosticsText(bundle: DiagnosticsBundle): string {
  const lines = [
    "Diagnostics Bundle",
    `Generated: ${bundle.generatedAt}`,
    "",
    "App",
    `- Name: ${bundle.app.name}`,
    `- Version: ${bundle.app.version ?? "unknown"}`,
    "",
    "Runtime",
    `- Platform: ${bundle.runtime.platform}`,
    `- Language: ${bundle.runtime.language}`,
    `- Online: ${bundle.runtime.onLine ? "yes" : "no"}`,
    `- Memory: ${bundle.runtime.memoryMB ? `${bundle.runtime.memoryMB} MB` : "unavailable"}`,
    `- CPU cores: ${bundle.runtime.cpuCores ?? "unknown"}`,
    "",
    "Connection",
    `- Overall: ${bundle.connection.overallStatus}`,
    ...bundle.connection.items.map(
      i => `- ${i.key}: ${i.status} | ${i.value} | ${i.detail}`,
    ),
    "",
    "Tokens (presence only)",
    ...bundle.tokens.entries.map(
      t => `- ${t.key}: ${t.present ? "present" : "missing"} (${t.note})`,
    ),
    "",
    "Recent issues",
  ];

  if (bundle.recentIssues.length === 0) {
    lines.push("- No recent issues.");
  } else {
    for (const issue of bundle.recentIssues) {
      lines.push(`- ${issue.timestamp} | ${issue.severity} | ${issue.action} (${issue.source}) | ${issue.detail}`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function resetDiagnosticsStore(): void {
  issueLogs.length = 0;
  tokenRegistry.length = 0;
  connectionProbes.clear();
}
