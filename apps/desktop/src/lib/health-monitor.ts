/**
 * AppHealthMonitor — In-app self-healing watchdog + /doctor diagnostics
 *
 * Two layers, both via the same check framework:
 *
 * 1. Install-time checks (sync, fast, safe to run every 60s):
 *    config, storage, conversations, memory, indexeddb.
 *    Auto-repair is permitted here.
 *
 * 2. Runtime checks (async, opt-in, surfaced via `runDoctorReport()`):
 *    API smoke test, MCP server health, markdown skill loader.
 *    These never auto-repair; they report only.
 */

import { emitAgentEvent } from "./event-bus";

export interface HealthCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  autoFixed?: boolean;
  /** "install" = static environment/config; "runtime" = live behavior (API, MCP, skills) */
  layer?: "install" | "runtime";
  /** Extra structured info for rendering (e.g. latency). */
  detail?: Record<string, unknown>;
}

export interface HealthReport {
  timestamp: number;
  checks: HealthCheckResult[];
  overallStatus: "healthy" | "degraded" | "critical";
  autoFixCount: number;
}

const CONFIG_KEY = "agent-config";
const BACKUP_CONFIG_KEY = "agent-config-backup";
const HEALTH_LOG_KEY = "health-monitor-log";
const CHECK_INTERVAL_MS = 60_000; // 60 seconds
const MAX_LOG_ENTRIES = 50;

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let lastReport: HealthReport | null = null;

// ═══════════ Individual Checks ═══════════

function checkConfig(): HealthCheckResult {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) {
      return { name: "config", status: "warn", message: "No config found (using defaults)" };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Config is not a valid object");
    }
    // Validate required fields
    const requiredFields = ["provider", "model"];
    const missing = requiredFields.filter(f => !(f in parsed));
    if (missing.length > 0) {
      // Auto-repair: add missing fields with defaults
      const defaults: Record<string, string> = {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      };
      for (const field of missing) {
        parsed[field] = defaults[field] ?? "";
      }
      localStorage.setItem(CONFIG_KEY, JSON.stringify(parsed));
      return {
        name: "config",
        status: "warn",
        message: `Auto-repaired missing fields: ${missing.join(", ")}`,
        autoFixed: true,
      };
    }
    return { name: "config", status: "ok", message: "Config valid" };
  } catch (err) {
    // Config is corrupted — attempt recovery
    try {
      const backup = localStorage.getItem(BACKUP_CONFIG_KEY);
      if (backup) {
        JSON.parse(backup); // Validate backup
        localStorage.setItem(CONFIG_KEY, backup);
        return {
          name: "config",
          status: "warn",
          message: "Config was corrupted, restored from backup",
          autoFixed: true,
        };
      }
    } catch { /* Backup also corrupted */ }

    // Last resort: reset to defaults
    const defaultConfig = {
      provider: "anthropic",
      apiKey: "",
      model: "claude-sonnet-4-6",
      language: "zh-CN",
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(defaultConfig));
    return {
      name: "config",
      status: "fail",
      message: "Config corrupted, reset to defaults",
      autoFixed: true,
    };
  }
}

function checkStorage(): HealthCheckResult {
  try {
    // Test write capability
    const testKey = "__health_check_test__";
    localStorage.setItem(testKey, "ok");
    const read = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);
    if (read !== "ok") {
      return { name: "storage", status: "fail", message: "localStorage read/write failed" };
    }

    // Check storage usage
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        totalSize += (localStorage.getItem(key) || "").length;
      }
    }
    const sizeMB = totalSize / (1024 * 1024);
    if (sizeMB > 4) {
      // Auto-cleanup: remove old event logs and temporary data
      const cleanupKeys = ["event-log", "old-stream-cache", "debug-log"];
      for (const key of cleanupKeys) {
        localStorage.removeItem(key);
      }
      return {
        name: "storage",
        status: "warn",
        message: `Storage usage high (${sizeMB.toFixed(1)}MB), cleaned up old data`,
        autoFixed: true,
      };
    }
    return { name: "storage", status: "ok", message: `${sizeMB.toFixed(1)}MB used` };
  } catch {
    return { name: "storage", status: "fail", message: "localStorage unavailable" };
  }
}

function checkConversations(): HealthCheckResult {
  try {
    const raw = localStorage.getItem("conversations");
    if (!raw) {
      return { name: "conversations", status: "ok", message: "No conversations stored" };
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Auto-repair: clear corrupted conversations
      localStorage.removeItem("conversations");
      return {
        name: "conversations",
        status: "warn",
        message: "Conversations data corrupted, cleared",
        autoFixed: true,
      };
    }
    // Validate each conversation has required fields
    let repaired = 0;
    for (const conv of parsed) {
      if (!conv.id) {
        conv.id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        repaired++;
      }
      if (!conv.title) {
        conv.title = "Untitled";
        repaired++;
      }
      if (!Array.isArray(conv.messages)) {
        conv.messages = [];
        repaired++;
      }
    }
    if (repaired > 0) {
      localStorage.setItem("conversations", JSON.stringify(parsed));
      return {
        name: "conversations",
        status: "warn",
        message: `Repaired ${repaired} conversation fields`,
        autoFixed: true,
      };
    }
    return { name: "conversations", status: "ok", message: `${parsed.length} conversations OK` };
  } catch {
    // Clear corrupted data
    localStorage.removeItem("conversations");
    return {
      name: "conversations",
      status: "fail",
      message: "Conversations data corrupted, cleared",
      autoFixed: true,
    };
  }
}

function checkMemoryIntegrity(): HealthCheckResult {
  const memoryKeys = ["user-memory", "mid-term-memory", "memory-store"];
  let issues = 0;
  for (const key of memoryKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.startsWith("{")) {
        JSON.parse(raw); // Validate JSON
      }
    } catch {
      localStorage.removeItem(key);
      issues++;
    }
  }
  if (issues > 0) {
    return {
      name: "memory",
      status: "warn",
      message: `Cleared ${issues} corrupted memory entries`,
      autoFixed: true,
    };
  }
  return { name: "memory", status: "ok", message: "Memory integrity OK" };
}

function checkIndexedDB(): HealthCheckResult {
  try {
    if (!window.indexedDB) {
      return { name: "indexeddb", status: "warn", message: "IndexedDB not available" };
    }
    return { name: "indexeddb", status: "ok", message: "IndexedDB available" };
  } catch {
    return { name: "indexeddb", status: "warn", message: "IndexedDB check failed" };
  }
}

// ═══════════ Run All Checks ═══════════

export function runHealthChecks(): HealthReport {
  const checks = [
    checkConfig(),
    checkStorage(),
    checkConversations(),
    checkMemoryIntegrity(),
    checkIndexedDB(),
  ];

  const failCount = checks.filter(c => c.status === "fail").length;
  const warnCount = checks.filter(c => c.status === "warn").length;
  const autoFixCount = checks.filter(c => c.autoFixed).length;

  let overallStatus: HealthReport["overallStatus"] = "healthy";
  if (failCount > 0) overallStatus = "critical";
  else if (warnCount > 0) overallStatus = "degraded";

  const report: HealthReport = {
    timestamp: Date.now(),
    checks,
    overallStatus,
    autoFixCount,
  };

  lastReport = report;

  // Log the report
  try {
    const logRaw = localStorage.getItem(HEALTH_LOG_KEY);
    const log: HealthReport[] = logRaw ? JSON.parse(logRaw) : [];
    log.push(report);
    // Keep only last N entries
    while (log.length > MAX_LOG_ENTRIES) log.shift();
    localStorage.setItem(HEALTH_LOG_KEY, JSON.stringify(log));
  } catch { /* skip logging if storage is full */ }

  // Emit events for auto-fixes
  if (autoFixCount > 0) {
    emitAgentEvent({
      type: "health_auto_repair",
      fixes: autoFixCount,
      details: checks.filter(c => c.autoFixed).map(c => c.message).join("; "),
    });
  }

  return report;
}

// ═══════════ Config Backup ═══════════

/**
 * Backup current config (call after successful config save)
 */
export function backupConfig(): void {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      JSON.parse(raw); // Validate first
      localStorage.setItem(BACKUP_CONFIG_KEY, raw);
    }
  } catch { /* skip if config is invalid */ }
}

/**
 * Emergency config reset — returns fresh default config
 */
export function emergencyReset(): Record<string, unknown> {
  const defaults = {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-6",
    language: "zh-CN",
    theme: "dark",
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(defaults));
  return defaults;
}

// ═══════════ Monitor Lifecycle ═══════════

export function startHealthMonitor(): void {
  if (monitorTimer) return;

  // Run initial check immediately
  runHealthChecks();

  // Schedule periodic checks
  monitorTimer = setInterval(() => {
    runHealthChecks();
  }, CHECK_INTERVAL_MS);
}

export function stopHealthMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

export function getLastReport(): HealthReport | null {
  return lastReport;
}

export function getHealthLog(): HealthReport[] {
  try {
    const raw = localStorage.getItem(HEALTH_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isMonitorRunning(): boolean {
  return monitorTimer !== null;
}

// ═══════════ Runtime checks (async, for /doctor) ═══════════

/**
 * Smoke-test the configured LLM provider with a minimal request.
 * Never auto-repairs. Returns a result that callers can render.
 */
export async function runtimeApiSmokeTest(): Promise<HealthCheckResult> {
  const started = Date.now();
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { name: "api-smoke", status: "warn", message: "No config — cannot run smoke test", layer: "runtime" };
    const cfg = JSON.parse(raw);
    if (!cfg.apiKey) {
      return { name: "api-smoke", status: "warn", message: "API key not set", layer: "runtime" };
    }

    const { validateApiKey } = await import("./agent-bridge");
    const result = await validateApiKey(cfg);
    const durationMs = Date.now() - started;
    if (result.valid) {
      return {
        name: "api-smoke",
        status: "ok",
        message: `Provider reachable in ${durationMs}ms`,
        layer: "runtime",
        detail: { latencyMs: durationMs, model: cfg.model, provider: cfg.provider },
      };
    }
    return {
      name: "api-smoke",
      status: "fail",
      message: result.error || `Smoke test failed after ${durationMs}ms`,
      layer: "runtime",
      detail: { latencyMs: durationMs },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "api-smoke", status: "fail", message: `Smoke test threw: ${msg}`, layer: "runtime" };
  }
}

/**
 * Probe MCP servers registered in the client. Non-destructive.
 */
export async function checkMcpServers(): Promise<HealthCheckResult> {
  try {
    const mod = await import("./mcp-client").catch(() => null);
    if (!mod || typeof mod.getServers !== "function") {
      return { name: "mcp", status: "ok", message: "No MCP client", layer: "runtime" };
    }
    const servers = mod.getServers();
    if (!Array.isArray(servers) || servers.length === 0) {
      return { name: "mcp", status: "ok", message: "No MCP servers configured", layer: "runtime" };
    }
    const connected = servers.filter((s: { status?: string }) => s.status === "connected").length;
    const total = servers.length;
    const status: HealthCheckResult["status"] = connected === total ? "ok" : connected > 0 ? "warn" : "fail";
    return {
      name: "mcp",
      status,
      message: `${connected}/${total} MCP servers connected`,
      layer: "runtime",
      detail: { connected, total, servers: servers.map((s: { name?: string; status?: string }) => ({ name: s.name, status: s.status })) },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "mcp", status: "warn", message: `MCP check failed: ${msg}`, layer: "runtime" };
  }
}

/**
 * Verify markdown skill loader — skills parsed, none in error state.
 */
export async function checkSkillLoader(): Promise<HealthCheckResult> {
  try {
    const mod = await import("./skills").catch(() => null);
    if (!mod) return { name: "skills", status: "ok", message: "No skills module", layer: "runtime" };

    const summaries = typeof mod.summarizeMarkdownSkills === "function" ? mod.summarizeMarkdownSkills() : [];
    const loaded = Array.isArray(summaries) ? summaries.length : 0;
    const missingDesc = Array.isArray(summaries)
      ? summaries.filter(s => !s.description || !s.name).length
      : 0;
    const status: HealthCheckResult["status"] = missingDesc > 0 ? "warn" : "ok";
    return {
      name: "skills",
      status,
      message: missingDesc > 0
        ? `${loaded} skills loaded, ${missingDesc} missing name/description`
        : `${loaded} skills loaded`,
      layer: "runtime",
      detail: { loaded, missingDesc },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "skills", status: "warn", message: `Skill loader check failed: ${msg}`, layer: "runtime" };
  }
}

// ═══════════ Doctor report (install + runtime) ═══════════

export interface DoctorReport extends HealthReport {
  install: HealthCheckResult[];
  runtime: HealthCheckResult[];
  summary: { ok: number; warn: number; fail: number };
}

/**
 * Full diagnostic: runs sync install checks, then parallel runtime checks.
 * Install-layer auto-repair still happens; runtime checks are read-only.
 */
export async function runDoctorReport(opts: { skipSmokeTest?: boolean } = {}): Promise<DoctorReport> {
  const installReport = runHealthChecks();
  const install = installReport.checks.map(c => ({ ...c, layer: "install" as const }));

  const runtimeChecks: Array<Promise<HealthCheckResult>> = [checkMcpServers(), checkSkillLoader()];
  if (!opts.skipSmokeTest) runtimeChecks.push(runtimeApiSmokeTest());
  const runtime = await Promise.all(runtimeChecks);

  const all = [...install, ...runtime];
  const summary = {
    ok: all.filter(c => c.status === "ok").length,
    warn: all.filter(c => c.status === "warn").length,
    fail: all.filter(c => c.status === "fail").length,
  };
  const overallStatus: HealthReport["overallStatus"] =
    summary.fail > 0 ? "critical" : summary.warn > 0 ? "degraded" : "healthy";

  return {
    timestamp: Date.now(),
    checks: all,
    overallStatus,
    autoFixCount: installReport.autoFixCount,
    install,
    runtime,
    summary,
  };
}

function iconFor(status: HealthCheckResult["status"]): string {
  return status === "ok" ? "✅" : status === "warn" ? "⚠️" : "❌";
}

/**
 * Render a doctor report as rich markdown (for /doctor slash command).
 */
export function renderDoctorReport(report: DoctorReport, opts: { zh?: boolean } = {}): string {
  const zh = opts.zh ?? false;
  const overallIcon = report.overallStatus === "healthy" ? "✅" : report.overallStatus === "degraded" ? "⚠️" : "❌";
  const lines: string[] = [
    `## 🩺 ${zh ? "诊断报告" : "Doctor Report"} ${overallIcon}`,
    "",
    `**${zh ? "整体状态" : "Overall"}**: \`${report.overallStatus}\` · **✅** ${report.summary.ok} · **⚠️** ${report.summary.warn} · **❌** ${report.summary.fail}${report.autoFixCount > 0 ? ` · 🔧 ${report.autoFixCount} ${zh ? "自动修复" : "auto-fixed"}` : ""}`,
    "",
    `### ${zh ? "安装层检查" : "Install-time checks"}`,
    "",
    `| ${zh ? "项目" : "Check"} | ${zh ? "状态" : "Status"} | ${zh ? "详情" : "Detail"} |`,
    "|------|------|------|",
  ];
  for (const c of report.install) {
    const fixed = c.autoFixed ? ` 🔧 ${zh ? "已修复" : "auto-fixed"}` : "";
    lines.push(`| ${c.name} | ${iconFor(c.status)} ${c.status} | ${c.message}${fixed} |`);
  }
  lines.push("", `### ${zh ? "运行时检查" : "Runtime checks"}`, "");
  lines.push(`| ${zh ? "项目" : "Check"} | ${zh ? "状态" : "Status"} | ${zh ? "详情" : "Detail"} |`);
  lines.push("|------|------|------|");
  for (const c of report.runtime) {
    const extra = c.detail?.latencyMs ? ` · ${c.detail.latencyMs}ms` : "";
    lines.push(`| ${c.name} | ${iconFor(c.status)} ${c.status} | ${c.message}${extra} |`);
  }

  if (report.summary.fail > 0 || report.summary.warn > 0) {
    lines.push("", `### ${zh ? "建议" : "Suggestions"}`, "");
    for (const c of report.checks) {
      if (c.status === "ok") continue;
      if (c.name === "config") lines.push(`- ${zh ? "打开设置页检查 provider / model / apiKey" : "Open Settings and verify provider / model / apiKey"}`);
      if (c.name === "storage") lines.push(`- ${zh ? "localStorage 使用过高，可清理旧对话" : "localStorage is full — prune old conversations"}`);
      if (c.name === "api-smoke") lines.push(`- ${zh ? "检查网络代理、API Key 和 base URL" : "Check network proxy, API key, and base URL"}`);
      if (c.name === "mcp") lines.push(`- ${zh ? "查看 MCP 配置并重新连接失联的服务" : "Review MCP config and reconnect any disconnected servers"}`);
      if (c.name === "skills") lines.push(`- ${zh ? "检查技能 markdown frontmatter 格式" : "Check skill markdown frontmatter formatting"}`);
    }
  }

  return lines.join("\n");
}
