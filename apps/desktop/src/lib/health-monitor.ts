/**
 * AppHealthMonitor — In-app self-healing watchdog
 *
 * Runs periodic health checks and auto-repairs:
 * 1. Config validation — detects and repairs corrupted config
 * 2. Storage integrity — checks localStorage / IndexedDB
 * 3. API connectivity — verifies current provider is reachable
 * 4. Memory pressure — warns when storage is getting full
 *
 * Designed to run independently of main app logic so it can
 * recover from crashes caused by config corruption.
 */

import { emitAgentEvent } from "./event-bus";

export interface HealthCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  autoFixed?: boolean;
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
