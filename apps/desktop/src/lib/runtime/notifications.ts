/**
 * Notification Center — Agent-to-Agent Message Passing
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/notification-center.ts
 *
 * Manages an action-queue of notifications that agents can acknowledge,
 * snooze, or let expire. Supports TTL-based auto-pruning.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "info" | "warn" | "error" | "action-required";

export interface NotificationAck {
  itemId: string;
  ackedAt: string;
  note?: string;
  expiresAt?: string;
}

export interface AcksSnapshot {
  acks: NotificationAck[];
  updatedAt: string;
}

export interface QueueItem {
  itemId: string;
  code: string;
  source: string;
  sourceId: string;
  level: Severity;
  title: string;
  detail: string;
  acknowledged: boolean;
  ackedAt?: string;
  note?: string;
  ackExpiresAt?: string;
  createdAt: string;
}

export interface NotificationCenterSnapshot {
  generatedAt: string;
  queue: QueueItem[];
  counts: { total: number; acked: number; unacked: number };
}

export interface AcknowledgeInput {
  itemId: string;
  note?: string;
  ttlMinutes?: number;
  snoozeUntil?: string;
}

export interface AcknowledgeResult {
  ack: NotificationAck;
  updated: boolean;
}

export interface PruneResult {
  before: number;
  removed: number;
  after: number;
  removedItemIds: string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NotificationValidationError extends Error {
  readonly statusCode: number;
  readonly issues: string[];
  constructor(message: string, issues: string[] = [], statusCode = 400) {
    super(message);
    this.name = "NotificationValidationError";
    this.statusCode = statusCode;
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const acksByItem = new Map<string, NotificationAck>();
const queueItems: QueueItem[] = [];
let storeUpdatedAt = new Date(0).toISOString();

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

export function pushQueueItem(input: {
  code: string;
  source: string;
  sourceId: string;
  level: Severity;
  title: string;
  detail: string;
}): QueueItem {
  const itemId = `${input.code}:${input.source}:${input.sourceId}`;
  const now = new Date().toISOString();
  const existing = queueItems.find(q => q.itemId === itemId);
  if (existing) {
    existing.detail = input.detail;
    existing.level = input.level;
    return existing;
  }
  const item: QueueItem = {
    itemId,
    code: input.code,
    source: input.source,
    sourceId: input.sourceId,
    level: input.level,
    title: input.title,
    detail: input.detail,
    acknowledged: false,
    createdAt: now,
  };
  queueItems.push(item);
  return item;
}

export function buildNotificationCenter(): NotificationCenterSnapshot {
  const nowMs = Date.now();
  const queue = queueItems.map(item => {
    const ack = resolveActiveAck(acksByItem.get(item.itemId), nowMs);
    return {
      ...item,
      acknowledged: !!ack,
      ackedAt: ack?.ackedAt,
      note: ack?.note,
      ackExpiresAt: ack?.expiresAt,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    queue,
    counts: {
      total: queue.length,
      acked: queue.filter(i => i.acknowledged).length,
      unacked: queue.filter(i => !i.acknowledged).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Acknowledge
// ---------------------------------------------------------------------------

export function acknowledgeItem(input: AcknowledgeInput): AcknowledgeResult {
  const issues: string[] = [];
  const itemId = input.itemId?.trim();
  if (!itemId) issues.push("itemId must be a non-empty string");
  if (input.ttlMinutes !== undefined && input.snoozeUntil !== undefined) {
    issues.push("Provide either ttlMinutes or snoozeUntil, not both");
  }
  if (input.snoozeUntil !== undefined && Date.parse(input.snoozeUntil) <= Date.now()) {
    issues.push("snoozeUntil must be a future ISO timestamp");
  }
  if (issues.length > 0) {
    throw new NotificationValidationError("Invalid acknowledge payload.", issues);
  }

  const target = queueItems.find(i => i.itemId === itemId);
  if (!target) {
    throw new NotificationValidationError(
      `itemId '${itemId}' not found in the action queue.`,
      ["itemId"],
      404,
    );
  }

  const nowMs = Date.now();
  const now = new Date().toISOString();
  const expiresAt = resolveExpiry(input, nowMs);
  const ack: NotificationAck = { itemId, ackedAt: now, note: input.note, expiresAt };

  const isUpdate = acksByItem.has(itemId);
  acksByItem.set(itemId, ack);
  storeUpdatedAt = now;

  return { ack, updated: isUpdate };
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

export function pruneStaleAcks(nowMs = Date.now()): PruneResult {
  const removedIds: string[] = [];
  for (const [id, ack] of acksByItem) {
    if (isAckExpired(ack, nowMs)) {
      removedIds.push(id);
    }
  }
  for (const id of removedIds) acksByItem.delete(id);
  if (removedIds.length > 0) storeUpdatedAt = new Date(nowMs).toISOString();
  return {
    before: removedIds.length + acksByItem.size,
    removed: removedIds.length,
    after: acksByItem.size,
    removedItemIds: removedIds,
  };
}

// ---------------------------------------------------------------------------
// Snapshot / restore (for persistence)
// ---------------------------------------------------------------------------

export function exportAcksSnapshot(): AcksSnapshot {
  return {
    acks: [...acksByItem.values()].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    updatedAt: storeUpdatedAt,
  };
}

export function importAcksSnapshot(snapshot: AcksSnapshot): void {
  acksByItem.clear();
  for (const ack of snapshot.acks) {
    if (ack.itemId) acksByItem.set(ack.itemId, ack);
  }
  storeUpdatedAt = snapshot.updatedAt;
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function resetNotificationStore(): void {
  acksByItem.clear();
  queueItems.length = 0;
  storeUpdatedAt = new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveExpiry(input: AcknowledgeInput, nowMs: number): string | undefined {
  if (input.snoozeUntil) return input.snoozeUntil;
  if (typeof input.ttlMinutes === "number") {
    return new Date(nowMs + input.ttlMinutes * 60_000).toISOString();
  }
  return undefined;
}

function isAckExpired(ack: NotificationAck, nowMs: number): boolean {
  if (!ack.expiresAt) return false;
  const expiresMs = Date.parse(ack.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

function resolveActiveAck(
  ack: NotificationAck | undefined,
  nowMs: number,
): NotificationAck | undefined {
  if (!ack) return undefined;
  if (isAckExpired(ack, nowMs)) return undefined;
  return ack;
}
