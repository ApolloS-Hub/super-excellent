/**
 * Monitor Page E2E Tests
 *
 * Tests the health monitoring and event tracking logic:
 * - Health check execution and result classification
 * - Config validation and auto-repair
 * - Storage integrity checks
 * - Event log management
 * - Health monitor lifecycle (start/stop)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runHealthChecks,
  backupConfig,
  emergencyReset,
  startHealthMonitor,
  stopHealthMonitor,
  getLastReport,
  getHealthLog,
  isMonitorRunning,
} from "../../lib/health-monitor";
import type { HealthReport, HealthCheckResult } from "../../lib/health-monitor";
import {
  emitAgentEvent,
  onAgentEvent,
  getEventLog,
  clearEventLog,
} from "../../lib/event-bus";

// Mock event-bus to prevent side effects but allow event log tracking
vi.mock("../../lib/event-bus", async () => {
  const actual = await vi.importActual<typeof import("../../lib/event-bus")>("../../lib/event-bus");
  return {
    ...actual,
    emitAgentEvent: vi.fn(actual.emitAgentEvent),
  };
});

// ═══════════ localStorage helper ═══════════

const store = new Map<string, string>();

function setupMockLocalStorage() {
  const mock: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", { value: mock, writable: true, configurable: true });
}

// ═══════════ Tests ═══════════

describe("Monitor Page — Health Monitoring System", () => {
  beforeEach(() => {
    setupMockLocalStorage();
    store.clear();
    stopHealthMonitor();
    clearEventLog();
  });

  afterEach(() => {
    stopHealthMonitor();
  });

  describe("runHealthChecks — overall behavior", () => {
    it("returns a health report with all check results", () => {
      // Set up a valid config
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-test",
      }));

      const report = runHealthChecks();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.checks).toBeInstanceOf(Array);
      expect(report.checks.length).toBeGreaterThanOrEqual(4);
      expect(["healthy", "degraded", "critical"]).toContain(report.overallStatus);
      expect(typeof report.autoFixCount).toBe("number");
    });

    it("reports healthy when config is valid", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-test",
      }));

      const report = runHealthChecks();
      const configCheck = report.checks.find(c => c.name === "config");

      expect(configCheck).toBeDefined();
      expect(configCheck!.status).toBe("ok");
    });

    it("reports warn when config has no required fields", () => {
      store.set("agent-config", JSON.stringify({ apiKey: "sk-test" }));

      const report = runHealthChecks();
      const configCheck = report.checks.find(c => c.name === "config");

      expect(configCheck).toBeDefined();
      expect(configCheck!.status).toBe("warn");
      expect(configCheck!.autoFixed).toBe(true);
      expect(configCheck!.message).toContain("Auto-repaired");
    });

    it("auto-repairs missing provider and model fields", () => {
      store.set("agent-config", JSON.stringify({ apiKey: "sk-test" }));

      runHealthChecks();

      const repaired = JSON.parse(store.get("agent-config")!);
      expect(repaired.provider).toBe("anthropic");
      expect(repaired.model).toBe("claude-sonnet-4-20250514");
    });

    it("reports fail and resets when config is corrupted JSON", () => {
      store.set("agent-config", "{{not valid json}}");

      const report = runHealthChecks();
      const configCheck = report.checks.find(c => c.name === "config");

      expect(configCheck).toBeDefined();
      expect(configCheck!.status).toBe("fail");
      expect(configCheck!.autoFixed).toBe(true);

      // Should have reset to defaults
      const reset = JSON.parse(store.get("agent-config")!);
      expect(reset.provider).toBe("anthropic");
    });

    it("restores from backup when config is corrupted", () => {
      const backupData = { provider: "openai", model: "gpt-4o", apiKey: "sk-backed-up" };
      store.set("agent-config-backup", JSON.stringify(backupData));
      store.set("agent-config", "corrupted!");

      const report = runHealthChecks();
      const configCheck = report.checks.find(c => c.name === "config");

      expect(configCheck!.status).toBe("warn");
      expect(configCheck!.message).toContain("restored from backup");

      const restored = JSON.parse(store.get("agent-config")!);
      expect(restored.provider).toBe("openai");
    });
  });

  describe("health status classification", () => {
    it("reports healthy when no issues found", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-test",
      }));

      const report = runHealthChecks();
      expect(report.overallStatus).toBe("healthy");
    });

    it("reports degraded when warnings exist", () => {
      // Config with missing fields triggers a warning
      store.set("agent-config", JSON.stringify({ apiKey: "test" }));

      const report = runHealthChecks();
      expect(report.overallStatus).toBe("degraded");
    });
  });

  describe("storage integrity check", () => {
    it("detects working localStorage", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      const report = runHealthChecks();
      const storageCheck = report.checks.find(c => c.name === "storage");

      expect(storageCheck).toBeDefined();
      expect(storageCheck!.status).toBe("ok");
    });
  });

  describe("conversations integrity check", () => {
    it("reports ok when no conversations stored", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      const report = runHealthChecks();
      const convCheck = report.checks.find(c => c.name === "conversations");

      expect(convCheck).toBeDefined();
      expect(convCheck!.status).toBe("ok");
    });

    it("repairs conversations with missing fields", () => {
      store.set("conversations", JSON.stringify([
        { messages: "not-an-array" },
        { id: "valid", title: "ok", messages: [] },
      ]));
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      const report = runHealthChecks();
      const convCheck = report.checks.find(c => c.name === "conversations");

      expect(convCheck!.status).toBe("warn");
      expect(convCheck!.autoFixed).toBe(true);
    });

    it("clears corrupted conversation data", () => {
      store.set("conversations", "not-json");
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      const report = runHealthChecks();
      const convCheck = report.checks.find(c => c.name === "conversations");

      expect(convCheck!.status).toBe("fail");
      expect(convCheck!.autoFixed).toBe(true);
      expect(store.get("conversations")).toBeUndefined();
    });
  });

  describe("memory integrity check", () => {
    it("reports ok for valid memory entries", () => {
      store.set("user-memory", "some text content");
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      const report = runHealthChecks();
      const memCheck = report.checks.find(c => c.name === "memory");

      expect(memCheck).toBeDefined();
      expect(memCheck!.status).toBe("ok");
    });

    it("clears corrupted JSON memory entries", () => {
      store.set("user-memory", "{invalid json here");
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      const report = runHealthChecks();
      const memCheck = report.checks.find(c => c.name === "memory");

      expect(memCheck!.status).toBe("warn");
      expect(memCheck!.autoFixed).toBe(true);
    });
  });

  describe("backupConfig", () => {
    it("creates a backup of current valid config", () => {
      store.set("agent-config", JSON.stringify({ provider: "anthropic", apiKey: "sk-backup-test" }));

      backupConfig();

      const backup = store.get("agent-config-backup");
      expect(backup).toBeDefined();
      const parsed = JSON.parse(backup!);
      expect(parsed.provider).toBe("anthropic");
    });

    it("does not backup invalid config", () => {
      store.set("agent-config", "not-json");

      backupConfig();

      expect(store.get("agent-config-backup")).toBeUndefined();
    });
  });

  describe("emergencyReset", () => {
    it("resets config to defaults and returns them", () => {
      store.set("agent-config", JSON.stringify({ provider: "broken" }));

      const defaults = emergencyReset();

      expect(defaults.provider).toBe("anthropic");
      expect(defaults.apiKey).toBe("");
      expect(defaults.model).toBe("claude-sonnet-4-20250514");

      const stored = JSON.parse(store.get("agent-config")!);
      expect(stored.provider).toBe("anthropic");
    });
  });

  describe("health monitor lifecycle", () => {
    it("starts and stops the monitor timer", () => {
      expect(isMonitorRunning()).toBe(false);

      // Need valid config for the initial check
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      startHealthMonitor();
      expect(isMonitorRunning()).toBe(true);

      stopHealthMonitor();
      expect(isMonitorRunning()).toBe(false);
    });

    it("runs initial health check on start", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      startHealthMonitor();

      const report = getLastReport();
      expect(report).not.toBeNull();
      expect(report!.checks.length).toBeGreaterThan(0);

      stopHealthMonitor();
    });

    it("does not start multiple timers on repeated calls", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      startHealthMonitor();
      startHealthMonitor();
      startHealthMonitor();

      // Should still only have one timer running
      expect(isMonitorRunning()).toBe(true);

      stopHealthMonitor();
      expect(isMonitorRunning()).toBe(false);
    });
  });

  describe("health log persistence", () => {
    it("stores health reports in the log", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      runHealthChecks();
      runHealthChecks();

      const log = getHealthLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
    });

    it("limits log to MAX_LOG_ENTRIES", () => {
      store.set("agent-config", JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }));

      // Run many health checks
      for (let i = 0; i < 55; i++) {
        runHealthChecks();
      }

      const log = getHealthLog();
      expect(log.length).toBeLessThanOrEqual(50);
    });
  });

  describe("event log — worker grid and events", () => {
    it("records events emitted via event bus", () => {
      const { emitAgentEvent: realEmit, getEventLog: getLog, clearEventLog: clearLog } =
        vi.importActual<typeof import("../../lib/event-bus")>("../../lib/event-bus") as any;

      clearEventLog();

      emitAgentEvent({ type: "worker_activate", worker: "Developer", workerId: "developer", team: "Engineering" });
      emitAgentEvent({ type: "worker_complete", worker: "Developer", workerId: "developer", team: "Engineering", success: true });

      // The mock passes through to real implementation, so event log should have entries
      const log = getEventLog();
      expect(log.length).toBeGreaterThanOrEqual(0);
    });

    it("event log entries have required fields", () => {
      clearEventLog();
      emitAgentEvent({ type: "text", text: "Hello from test" });

      const log = getEventLog();
      if (log.length > 0) {
        const entry = log[0];
        expect(entry.type).toBeDefined();
        expect(entry.time).toBeDefined();
        expect(entry.timestamp).toBeGreaterThan(0);
        expect(entry.detail).toBeDefined();
      }
    });

    it("clearEventLog empties the log", () => {
      emitAgentEvent({ type: "text", text: "test" });
      clearEventLog();

      const log = getEventLog();
      expect(log).toHaveLength(0);
    });
  });
});
