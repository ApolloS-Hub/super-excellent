import { describe, it, expect, beforeEach } from "vitest";
import {
  createQuerySession,
  transition,
  getQuerySession,
  endQuerySession,
  getSessionTimings,
} from "../../lib/query-transitions";

describe("QueryTransitions", () => {
  let sessionId: string;

  beforeEach(() => {
    const session = createQuerySession();
    sessionId = session.id;
  });

  it("creates a session in idle state", () => {
    const session = getQuerySession(sessionId);
    expect(session).not.toBeNull();
    expect(session!.phase).toBe("idle");
  });

  it("transitions through normal lifecycle", () => {
    transition(sessionId, "gathering_context");
    expect(getQuerySession(sessionId)!.phase).toBe("gathering_context");

    transition(sessionId, "calling_llm");
    expect(getQuerySession(sessionId)!.phase).toBe("calling_llm");
    expect(getQuerySession(sessionId)!.turnCount).toBe(1);

    transition(sessionId, "processing_response");
    transition(sessionId, "executing_tools");
    expect(getQuerySession(sessionId)!.toolCallCount).toBe(1);

    transition(sessionId, "calling_llm");
    expect(getQuerySession(sessionId)!.turnCount).toBe(2);

    transition(sessionId, "finalizing");
    transition(sessionId, "completed");
  });

  it("records transitions with timing", () => {
    transition(sessionId, "gathering_context");
    transition(sessionId, "calling_llm");

    const session = getQuerySession(sessionId)!;
    expect(session.transitions.length).toBe(2);
    expect(session.transitions[0].from).toBe("idle");
    expect(session.transitions[0].to).toBe("gathering_context");
    expect(session.transitions[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("endQuerySession marks completed", () => {
    transition(sessionId, "calling_llm");
    const session = endQuerySession(sessionId);
    expect(session!.phase).toBe("completed");
  });

  it("getSessionTimings aggregates time per phase", () => {
    transition(sessionId, "gathering_context");
    transition(sessionId, "calling_llm");
    transition(sessionId, "processing_response");

    const timings = getSessionTimings(sessionId);
    expect(timings).toHaveProperty("idle");
    expect(timings).toHaveProperty("gathering_context");
  });

  it("returns null for unknown session", () => {
    expect(getQuerySession("nonexistent")).toBeNull();
    expect(transition("nonexistent", "error")).toBeNull();
  });

  it("supports metadata on transitions", () => {
    transition(sessionId, "calling_llm", { model: "claude-sonnet-4-6" });
    const session = getQuerySession(sessionId)!;
    expect(session.transitions[0].metadata).toEqual({ model: "claude-sonnet-4-6" });
  });
});
