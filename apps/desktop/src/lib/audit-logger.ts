/**
 * Audit Logger — append-only JSONL audit trail
 *
 * Inspired by Cowork's "审计日志 JSONL append-only" pattern.
 * Every significant operation gets a single-line JSON entry appended
 * to an in-memory ring buffer + localStorage persistence.
 *
 * Each entry: { ts, type, actor, target, detail, sessionId }
 * Can be tailed, filtered, diffed, replayed.
 */

export type AuditEventType =
  | "tool_execute"
  | "tool_result"
  | "permission_granted"
  | "permission_denied"
  | "file_write"
  | "file_read"
  | "file_delete"
  | "config_change"
  | "session_start"
  | "session_end"
  | "worker_dispatch"
  | "worker_complete"
  | "error"
  | "api_call"
  | "memory_write"
  | "skill_activated"
  | "export";

export interface AuditEntry {
  /** ISO timestamp */
  ts: string;
  /** Event type */
  type: AuditEventType;
  /** Who triggered it (user / secretary / worker-id / system) */
  actor: string;
  /** What was affected (tool name / file path / config key) */
  target: string;
  /** Short detail (truncated to 500 chars) */
  detail?: string;
  /** Current session ID */
  sessionId?: string;
  /** Duration in ms (for tool_execute, api_call) */
  durationMs?: number;
  /** Success or failure */
  ok?: boolean;
}

const STORAGE_KEY = "audit-log";
const MAX_ENTRIES = 2000;
const MAX_DETAIL_LEN = 500;

let buffer: AuditEntry[] = [];
let loaded = false;
let currentSessionId = `s_${Date.now().toString(36)}`;

function load(): void {
  if (loaded) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) buffer = parsed.slice(-MAX_ENTRIES);
    }
  } catch { /* corrupt */ }
  loaded = true;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_ENTRIES)));
  } catch { /* quota */ }
}

/**
 * Append one audit entry. Non-blocking, never throws.
 */
export function audit(
  type: AuditEventType,
  actor: string,
  target: string,
  detail?: string,
  extra?: Partial<Pick<AuditEntry, "durationMs" | "ok">>,
): void {
  load();
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    type,
    actor,
    target,
    detail: detail ? detail.slice(0, MAX_DETAIL_LEN) : undefined,
    sessionId: currentSessionId,
    ...extra,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  persist();
}

/**
 * Get recent N entries (newest last).
 */
export function tail(n: number = 50): AuditEntry[] {
  load();
  return buffer.slice(-n);
}

/**
 * Filter entries by type, actor, or target.
 */
export function query(filter: {
  type?: AuditEventType;
  actor?: string;
  target?: string;
  since?: string;
  limit?: number;
}): AuditEntry[] {
  load();
  let results = buffer;
  if (filter.type) results = results.filter(e => e.type === filter.type);
  if (filter.actor) results = results.filter(e => e.actor === filter.actor);
  if (filter.target) results = results.filter(e => e.target.includes(filter.target!));
  if (filter.since) {
    const cutoff = new Date(filter.since).getTime();
    results = results.filter(e => new Date(e.ts).getTime() >= cutoff);
  }
  return results.slice(-(filter.limit ?? 100));
}

/**
 * Export as JSONL string (one JSON per line).
 */
export function exportJsonl(): string {
  load();
  return buffer.map(e => JSON.stringify(e)).join("\n");
}

/**
 * Get summary stats for the current session.
 */
export function sessionStats(): {
  totalEvents: number;
  toolCalls: number;
  errors: number;
  permissionsDenied: number;
  filesModified: number;
} {
  load();
  const session = buffer.filter(e => e.sessionId === currentSessionId);
  return {
    totalEvents: session.length,
    toolCalls: session.filter(e => e.type === "tool_execute").length,
    errors: session.filter(e => e.type === "error").length,
    permissionsDenied: session.filter(e => e.type === "permission_denied").length,
    filesModified: session.filter(e => e.type === "file_write" || e.type === "file_delete").length,
  };
}

export function setSessionId(id: string): void {
  currentSessionId = id;
}

export function clearAuditLog(): void {
  buffer = [];
  persist();
}

export function getEntryCount(): number {
  load();
  return buffer.length;
}
