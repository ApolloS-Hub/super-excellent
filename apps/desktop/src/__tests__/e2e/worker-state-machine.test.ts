/**
 * Worker State Machine tests
 * Validates explicit state transitions and stale detection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  transitionWorker,
  reportProgress,
  getWorkerState,
  getAllActiveStates,
  clearAllStates,
  startStaleDetection,
  stopStaleDetection,
  setStaleNotifier,
  workerSpawning,
  workerThinking,
  workerToolRunning,
  workerCompleted,
  workerFailed,
} from "../../lib/worker-state-machine";

describe("Worker State Machine", () => {
  beforeEach(() => {
    clearAllStates();
    stopStaleDetection();
    setStaleNotifier(null);
  });

  afterEach(() => {
    stopStaleDetection();
    setStaleNotifier(null);
    clearAllStates();
  });

  describe("state transitions", () => {
    it("transitions through typical lifecycle", () => {
      workerSpawning("dev-1", "Developer");
      expect(getWorkerState("dev-1")?.state).toBe("spawning");

      workerThinking("dev-1", "Developer");
      expect(getWorkerState("dev-1")?.state).toBe("thinking");

      workerToolRunning("dev-1", "Developer", "bash");
      const s = getWorkerState("dev-1");
      expect(s?.state).toBe("tool_running");
      expect(s?.currentTool).toBe("bash");

      workerCompleted("dev-1", "Developer");
      expect(getWorkerState("dev-1")?.state).toBe("completed");
    });

    it("tracks multiple workers independently", () => {
      workerThinking("w1", "Worker 1");
      workerToolRunning("w2", "Worker 2", "web_search");

      expect(getAllActiveStates().length).toBe(2);
      expect(getWorkerState("w1")?.state).toBe("thinking");
      expect(getWorkerState("w2")?.currentTool).toBe("web_search");
    });

    it("cleans up terminal states", async () => {
      vi.useFakeTimers();
      workerCompleted("w1", "Worker 1");
      expect(getWorkerState("w1")).not.toBeNull();

      vi.advanceTimersByTime(30_001);
      expect(getWorkerState("w1")).toBeNull();
      vi.useRealTimers();
    });
  });

  describe("stale detection", () => {
    it("fires stale callback when worker has no progress for 10s", async () => {
      vi.useFakeTimers();
      const staleMessages: string[] = [];
      setStaleNotifier((msg) => staleMessages.push(msg));
      startStaleDetection();

      workerThinking("hung-worker", "HungWorker");
      expect(staleMessages.length).toBe(0);

      // Advance 15 seconds without any progress
      vi.advanceTimersByTime(15_000);

      expect(staleMessages.length).toBeGreaterThan(0);
      expect(staleMessages[0]).toContain("HungWorker");
      // Message is bilingual — zh uses "已用时", en uses "elapsed"
      expect(staleMessages[0]).toMatch(/已用时|elapsed/);

      stopStaleDetection();
      vi.useRealTimers();
    });

    it("does not fire stale for completed workers", async () => {
      vi.useFakeTimers();
      const staleMessages: string[] = [];
      setStaleNotifier((msg) => staleMessages.push(msg));
      startStaleDetection();

      workerCompleted("done-worker", "DoneWorker");
      vi.advanceTimersByTime(30_000);

      expect(staleMessages.length).toBe(0);
      stopStaleDetection();
      vi.useRealTimers();
    });

    it("resets stale timer when reportProgress is called", async () => {
      vi.useFakeTimers();
      const staleMessages: string[] = [];
      setStaleNotifier((msg) => staleMessages.push(msg));
      startStaleDetection();

      workerThinking("active-worker", "ActiveWorker");

      // Simulate progress every 5s
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(5_000);
        reportProgress("active-worker");
      }

      // Should not have fired stale since progress kept coming
      expect(staleMessages.length).toBe(0);

      stopStaleDetection();
      vi.useRealTimers();
    });

    it("fires stale on tool_running state too", async () => {
      vi.useFakeTimers();
      const staleMessages: string[] = [];
      setStaleNotifier((msg) => staleMessages.push(msg));
      startStaleDetection();

      workerToolRunning("tool-worker", "ToolWorker", "web_search");
      vi.advanceTimersByTime(15_000);

      expect(staleMessages.length).toBeGreaterThan(0);
      expect(staleMessages[0]).toContain("web_search");

      stopStaleDetection();
      vi.useRealTimers();
    });
  });
});
