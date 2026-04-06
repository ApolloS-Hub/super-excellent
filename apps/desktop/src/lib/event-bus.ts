type EventHandler = (event: Record<string, unknown>) => void;

const handlers: Set<EventHandler> = new Set();

export function onAgentEvent(handler: EventHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emitAgentEvent(event: Record<string, unknown>): void {
  for (const h of handlers) {
    try { h(event); } catch { /* ignore */ }
  }
}
