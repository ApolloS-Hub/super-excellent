/** Agent event types for the event bus */
export type AgentEventType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "error"
  | "result"
  | "worker_activate"
  | "worker_complete"
  | "user_message"
  | "intent_analysis"
  | "worker_dispatch";

type EventHandler = (event: Record<string, unknown>) => void;

const handlers: Set<EventHandler> = new Set();

export function onAgentEvent(handler: EventHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emitAgentEvent(event: Record<string, unknown>): void {
  // Push to global event log
  pushEventLog(event);
  for (const h of handlers) {
    try { h(event); } catch { /* ignore */ }
  }
}

// ═══════════ Global Event Log (P0-4) ═══════════

export interface EventLogEntry {
  time: string;
  timestamp: number;
  type: string;
  detail: string;
  raw: Record<string, unknown>;
}

const MAX_EVENT_LOG = 100;
const _eventLog: EventLogEntry[] = [];

function pushEventLog(event: Record<string, unknown>): void {
  const now = new Date();
  const type = (event.type as string) || "unknown";
  let detail = "";

  switch (type) {
    case "text":
      detail = `${((event.text as string) || "").slice(0, 80)}`;
      break;
    case "thinking":
      detail = `💭 ${((event.text as string) || "").slice(0, 60)}`;
      break;
    case "tool_use":
      detail = `🔧 ${event.toolName}(${((event.toolInput as string) || "").slice(0, 60)})`;
      break;
    case "tool_result":
      detail = `✅ ${((event.toolOutput as string) || "").slice(0, 80)}`;
      break;
    case "error":
      detail = `❌ ${event.text}`;
      break;
    case "result":
      detail = "✓ 完成";
      break;
    case "worker_activate":
      detail = `🟢 ${event.worker} 开始工作`;
      break;
    case "worker_complete":
      detail = `⚪ ${event.worker} 完成`;
      break;
    case "user_message":
      detail = `💬 ${((event.text as string) || "").slice(0, 60)}`;
      break;
    case "intent_analysis":
      detail = `🧠 ${event.intentType}: ${((event.plan as string) || "").slice(0, 60)}`;
      break;
    case "worker_dispatch":
      detail = `🎯 派发给 ${event.worker}`;
      break;
    default:
      detail = JSON.stringify(event).slice(0, 100);
  }

  _eventLog.unshift({
    time: now.toLocaleTimeString(),
    timestamp: now.getTime(),
    type,
    detail,
    raw: event,
  });

  // Keep only the latest MAX_EVENT_LOG entries
  if (_eventLog.length > MAX_EVENT_LOG) {
    _eventLog.length = MAX_EVENT_LOG;
  }
}

/** Get a snapshot of the global event log (newest first) */
export function getEventLog(): EventLogEntry[] {
  return [..._eventLog];
}

/** Clear the global event log */
export function clearEventLog(): void {
  _eventLog.length = 0;
}
