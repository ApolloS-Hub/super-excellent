/**
 * Query Transitions — explicit state machine for the conversation turn loop
 *
 * Inspired by cc-haha's query/transitions.ts.
 * Models the turn lifecycle as a state machine with typed transitions:
 *
 *   idle → gathering_context → calling_llm → processing_response
 *        → executing_tools → calling_llm (loop) → finalizing → idle
 *
 * Each transition emits an event and records timing metadata.
 */

import { emitAgentEvent } from "./event-bus";

export type QueryPhase =
  | "idle"
  | "gathering_context"   // Building system prompt, memory, tools
  | "calling_llm"         // Waiting for provider API response
  | "processing_response" // Parsing response, extracting tool calls
  | "executing_tools"     // Running tool calls
  | "finalizing"          // Building final output, running stop hooks
  | "completed"
  | "error";

export interface QueryTransition {
  from: QueryPhase;
  to: QueryPhase;
  timestamp: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface QuerySession {
  id: string;
  phase: QueryPhase;
  startedAt: number;
  phaseEnteredAt: number;
  transitions: QueryTransition[];
  turnCount: number;
  toolCallCount: number;
}

const sessions = new Map<string, QuerySession>();

export function createQuerySession(id?: string): QuerySession {
  const session: QuerySession = {
    id: id ?? `qs_${Date.now().toString(36)}`,
    phase: "idle",
    startedAt: Date.now(),
    phaseEnteredAt: Date.now(),
    transitions: [],
    turnCount: 0,
    toolCallCount: 0,
  };
  sessions.set(session.id, session);
  return session;
}

export function transition(
  sessionId: string,
  to: QueryPhase,
  metadata?: Record<string, unknown>,
): QueryTransition | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = Date.now();
  const t: QueryTransition = {
    from: session.phase,
    to,
    timestamp: now,
    durationMs: now - session.phaseEnteredAt,
    metadata,
  };

  session.transitions.push(t);
  session.phase = to;
  session.phaseEnteredAt = now;

  if (to === "calling_llm") session.turnCount++;
  if (to === "executing_tools") session.toolCallCount++;

  emitAgentEvent({
    type: "query_phase_change",
    sessionId,
    from: t.from,
    to: t.to,
    durationMs: t.durationMs,
    turnCount: session.turnCount,
  });

  return t;
}

export function getQuerySession(sessionId: string): QuerySession | null {
  return sessions.get(sessionId) ?? null;
}

export function endQuerySession(sessionId: string): QuerySession | null {
  const session = sessions.get(sessionId);
  if (session) {
    transition(sessionId, "completed");
    setTimeout(() => sessions.delete(sessionId), 60_000);
  }
  return session ?? null;
}

export function getSessionTimings(sessionId: string): Record<QueryPhase, number> {
  const session = sessions.get(sessionId);
  const totals: Record<string, number> = {};
  if (!session) return totals as Record<QueryPhase, number>;

  for (const t of session.transitions) {
    totals[t.from] = (totals[t.from] ?? 0) + t.durationMs;
  }
  return totals as Record<QueryPhase, number>;
}
