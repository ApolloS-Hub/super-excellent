/**
 * Event Bus tests — pub/sub + circular log + error resilience
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  onAgentEvent,
  emitAgentEvent,
  getEventLog,
  clearEventLog,
} from "../../lib/event-bus";

beforeEach(() => {
  clearEventLog();
});

describe("event-bus: pub/sub", () => {
  it("delivers events to subscribed handlers", () => {
    const handler = vi.fn();
    const unsub = onAgentEvent(handler);
    emitAgentEvent({ type: "text", text: "hello" });
    expect(handler).toHaveBeenCalledWith({ type: "text", text: "hello" });
    unsub();
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsub = onAgentEvent(handler);
    unsub();
    emitAgentEvent({ type: "text", text: "after unsub" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to multiple handlers", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const u1 = onAgentEvent(h1);
    const u2 = onAgentEvent(h2);
    emitAgentEvent({ type: "result" });
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
    u1(); u2();
  });
});

describe("event-bus: error resilience", () => {
  it("a thrown handler does NOT crash the event loop for other handlers", () => {
    const h1 = vi.fn(() => { throw new Error("bad subscriber"); });
    const h2 = vi.fn();
    const u1 = onAgentEvent(h1);
    const u2 = onAgentEvent(h2);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    emitAgentEvent({ type: "error" });
    expect(h2).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    u1(); u2();
  });
});

describe("event-bus: circular event log", () => {
  it("pushes each emitted event to the log", () => {
    emitAgentEvent({ type: "text", text: "a" });
    emitAgentEvent({ type: "text", text: "b" });
    const log = getEventLog();
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log[0].type).toBe("text");
  });

  it("newest events appear first", () => {
    emitAgentEvent({ type: "text", text: "first" });
    emitAgentEvent({ type: "text", text: "second" });
    const log = getEventLog();
    expect(log[0].detail).toContain("second");
    expect(log[1].detail).toContain("first");
  });

  it("caps the log at max entries (100)", () => {
    for (let i = 0; i < 150; i++) emitAgentEvent({ type: "text", text: `msg-${i}` });
    expect(getEventLog().length).toBe(100);
  });

  it("formats different event types into human-readable detail", () => {
    emitAgentEvent({ type: "tool_use", toolName: "bash", toolInput: "ls" });
    emitAgentEvent({ type: "worker_activate", worker: "developer" });
    emitAgentEvent({ type: "error", text: "something broke" });
    const log = getEventLog();
    const detailByType = new Map(log.map(e => [e.type, e.detail]));
    expect(detailByType.get("tool_use")).toContain("bash");
    expect(detailByType.get("worker_activate")).toContain("developer");
    expect(detailByType.get("error")).toContain("something broke");
  });

  it("detail formatting does not contain legacy emoji", () => {
    emitAgentEvent({ type: "tool_use", toolName: "x", toolInput: "y" });
    emitAgentEvent({ type: "worker_complete", worker: "w" });
    emitAgentEvent({ type: "thinking", text: "thought" });
    const log = getEventLog();
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const entry of log) {
      expect(entry.detail).not.toMatch(emojiPattern);
    }
  });

  it("clearEventLog empties the log", () => {
    emitAgentEvent({ type: "text" });
    emitAgentEvent({ type: "text" });
    clearEventLog();
    expect(getEventLog().length).toBe(0);
  });

  it("each log entry has time, timestamp, type, detail, raw", () => {
    emitAgentEvent({ type: "text", text: "hi" });
    const entry = getEventLog()[0];
    expect(entry).toHaveProperty("time");
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("type");
    expect(entry).toHaveProperty("detail");
    expect(entry).toHaveProperty("raw");
    expect(typeof entry.timestamp).toBe("number");
  });
});
