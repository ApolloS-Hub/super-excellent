/**
 * Collaboration Hall — Multi-Agent Collaboration Orchestrator
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/collaboration-hall-orchestrator.ts
 *
 * Manages a "collaboration hall" where multiple Worker agents discuss
 * the same task. Supports discussion cycles, execution hand-offs,
 * review, and automatic participant queuing.
 */

import type { ParticipantRole } from "./agent-dispatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HallStage = "discussion" | "execution" | "review" | "blocked" | "completed";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type SemanticRole = "planner" | "coder" | "reviewer" | "manager" | "generalist";
export type MessageKind = "chat" | "task" | "proposal" | "decision" | "handoff" | "status" | "result" | "review" | "system";
type ResponseLang = "zh" | "en";

export interface HallParticipant {
  participantId: string;
  displayName: string;
  semanticRole: SemanticRole;
  active: boolean;
  aliases: string[];
  isHuman?: boolean;
}

export interface HallMessage {
  messageId: string;
  hallId: string;
  kind: MessageKind;
  authorParticipantId: string;
  authorLabel: string;
  authorSemanticRole?: SemanticRole;
  content: string;
  targetParticipantIds: string[];
  mentionTargets: MentionTarget[];
  projectId?: string;
  taskId?: string;
  taskCardId?: string;
  roomId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface MentionTarget {
  raw: string;
  participantId: string;
  displayName: string;
  semanticRole: SemanticRole;
}

export interface ExecutionItem {
  itemId: string;
  participantId: string;
  task: string;
  handoffToParticipantId?: string;
  handoffWhen?: string;
}

export interface DiscussionCycle {
  openedAt: string;
  expectedParticipantIds: string[];
  completedParticipantIds: string[];
}

export interface HallTaskCard {
  taskCardId: string;
  hallId: string;
  projectId: string;
  taskId: string;
  roomId?: string;
  title: string;
  description: string;
  stage: HallStage;
  status: TaskStatus;
  proposal?: string;
  decision?: string;
  doneWhen?: string;
  latestSummary?: string;
  createdByParticipantId: string;
  currentOwnerParticipantId?: string | null;
  currentOwnerLabel?: string | null;
  currentExecutionItem?: ExecutionItem | null;
  plannedExecutionOrder: string[];
  plannedExecutionItems: ExecutionItem[];
  mentionedParticipantIds: string[];
  requiresInputFrom: string[];
  blockers: string[];
  sessionKeys: string[];
  discussionCycle?: DiscussionCycle;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollaborationHall {
  hallId: string;
  participants: HallParticipant[];
  messageIds: string[];
  taskCardIds: string[];
  lastMessageId: string | null;
  latestMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HallSummary {
  totalMessages: number;
  totalTaskCards: number;
  activeTaskCards: number;
  latestMessageAt: string | null;
}

// ---------------------------------------------------------------------------
// Collaboration Hall — in-memory store
// ---------------------------------------------------------------------------

let hallStore: CollaborationHall | null = null;
const messageStore: HallMessage[] = [];
const taskCardStore: Map<string, HallTaskCard> = new Map();
let messageCounter = 0;
let taskCardCounter = 0;

export function getOrCreateHall(participants: HallParticipant[]): CollaborationHall {
  if (hallStore) return hallStore;
  const now = new Date().toISOString();
  hallStore = {
    hallId: "default",
    participants,
    messageIds: [],
    taskCardIds: [],
    lastMessageId: null,
    latestMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return hallStore;
}

export function getHall(): CollaborationHall | null {
  return hallStore;
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

export function appendMessage(input: {
  hallId: string;
  kind: MessageKind;
  authorParticipantId: string;
  authorLabel: string;
  authorSemanticRole?: SemanticRole;
  content: string;
  targetParticipantIds?: string[];
  mentionTargets?: MentionTarget[];
  projectId?: string;
  taskId?: string;
  taskCardId?: string;
  roomId?: string;
  payload?: Record<string, unknown>;
}): HallMessage {
  messageCounter += 1;
  const now = new Date().toISOString();
  const msg: HallMessage = {
    messageId: `msg-${messageCounter}-${Date.now()}`,
    hallId: input.hallId,
    kind: input.kind,
    authorParticipantId: input.authorParticipantId,
    authorLabel: input.authorLabel,
    authorSemanticRole: input.authorSemanticRole,
    content: input.content,
    targetParticipantIds: input.targetParticipantIds ?? [],
    mentionTargets: input.mentionTargets ?? [],
    projectId: input.projectId,
    taskId: input.taskId,
    taskCardId: input.taskCardId,
    roomId: input.roomId,
    payload: input.payload,
    createdAt: now,
  };
  messageStore.push(msg);
  if (hallStore) {
    hallStore.messageIds.push(msg.messageId);
    hallStore.lastMessageId = msg.messageId;
    hallStore.latestMessageAt = now;
    hallStore.updatedAt = now;
  }
  return msg;
}

export function listMessages(filter?: {
  hallId?: string;
  taskCardId?: string;
  limit?: number;
}): HallMessage[] {
  let result = messageStore;
  if (filter?.hallId) result = result.filter(m => m.hallId === filter.hallId);
  if (filter?.taskCardId) result = result.filter(m => m.taskCardId === filter.taskCardId);
  if (filter?.limit) result = result.slice(-filter.limit);
  return result;
}

// ---------------------------------------------------------------------------
// Task card operations
// ---------------------------------------------------------------------------

export function createTaskCard(input: {
  hallId: string;
  projectId: string;
  taskId: string;
  title: string;
  description: string;
  createdByParticipantId: string;
  roomId?: string;
}): HallTaskCard {
  taskCardCounter += 1;
  const now = new Date().toISOString();
  const card: HallTaskCard = {
    taskCardId: `tc-${taskCardCounter}-${Date.now()}`,
    hallId: input.hallId,
    projectId: input.projectId,
    taskId: input.taskId,
    roomId: input.roomId,
    title: input.title,
    description: input.description,
    stage: "discussion",
    status: "todo",
    createdByParticipantId: input.createdByParticipantId,
    currentOwnerParticipantId: null,
    currentOwnerLabel: null,
    currentExecutionItem: null,
    plannedExecutionOrder: [],
    plannedExecutionItems: [],
    mentionedParticipantIds: [],
    requiresInputFrom: [],
    blockers: [],
    sessionKeys: [],
    createdAt: now,
    updatedAt: now,
  };
  taskCardStore.set(card.taskCardId, card);
  if (hallStore) {
    hallStore.taskCardIds.push(card.taskCardId);
    hallStore.updatedAt = now;
  }
  return card;
}

export function getTaskCard(taskCardId: string): HallTaskCard | undefined {
  return taskCardStore.get(taskCardId);
}

export function updateTaskCard(
  taskCardId: string,
  patch: Partial<Omit<HallTaskCard, "taskCardId" | "hallId" | "createdAt">>,
): HallTaskCard | undefined {
  const card = taskCardStore.get(taskCardId);
  if (!card) return undefined;
  Object.assign(card, patch, { updatedAt: new Date().toISOString() });
  return card;
}

export function listTaskCards(hallId: string, includeArchived = false): HallTaskCard[] {
  return [...taskCardStore.values()].filter(c => {
    if (c.hallId !== hallId) return false;
    if (!includeArchived && c.archivedAt) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Discussion cycle helpers
// ---------------------------------------------------------------------------

export function openDiscussionCycle(
  card: HallTaskCard,
  triggerParticipantId: string,
  participants: HallParticipant[],
  queue?: string[],
): HallTaskCard {
  const expectedIds = queue ?? buildDiscussionQueue(participants);
  card.discussionCycle = {
    openedAt: new Date().toISOString(),
    expectedParticipantIds: expectedIds.filter(id => id !== triggerParticipantId),
    completedParticipantIds: [],
  };
  return card;
}

export function markSpeakerComplete(
  card: HallTaskCard,
  participantId: string,
): HallTaskCard {
  if (!card.discussionCycle) return card;
  if (!card.discussionCycle.completedParticipantIds.includes(participantId)) {
    card.discussionCycle.completedParticipantIds.push(participantId);
  }
  return card;
}

export function closeDiscussionCycle(card: HallTaskCard): HallTaskCard {
  if (card.discussionCycle) {
    card.discussionCycle.completedParticipantIds = [
      ...card.discussionCycle.expectedParticipantIds,
    ];
  }
  return card;
}

export function resolveNextSpeaker(
  card: HallTaskCard,
  participants: HallParticipant[],
): HallParticipant | undefined {
  if (!card.discussionCycle) return undefined;
  const completed = new Set(card.discussionCycle.completedParticipantIds);
  for (const pid of card.discussionCycle.expectedParticipantIds) {
    if (completed.has(pid)) continue;
    const p = findParticipant(participants, pid);
    if (p) return p;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Mention routing
// ---------------------------------------------------------------------------

export function resolveMentionTargets(
  content: string,
  participants: HallParticipant[],
): MentionTarget[] {
  const targets: MentionTarget[] = [];
  const seen = new Set<string>();
  for (const p of participants) {
    const candidates = [p.displayName, ...p.aliases];
    for (const name of candidates) {
      if (!name) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`@${escaped}(?=$|[\\s),.!?;:])`, "i");
      if (regex.test(content) && !seen.has(p.participantId)) {
        seen.add(p.participantId);
        targets.push({
          raw: `@${name}`,
          participantId: p.participantId,
          displayName: p.displayName,
          semanticRole: p.semanticRole,
        });
      }
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

export function assignExecution(
  card: HallTaskCard,
  ownerParticipantId: string,
  ownerLabel: string,
): HallTaskCard {
  card.stage = "execution";
  card.status = "in_progress";
  card.currentOwnerParticipantId = ownerParticipantId;
  card.currentOwnerLabel = ownerLabel;
  card.plannedExecutionOrder = card.plannedExecutionOrder.filter(
    id => id !== ownerParticipantId,
  );
  card.updatedAt = new Date().toISOString();
  return card;
}

export function completeExecution(
  card: HallTaskCard,
  outcome: "approved" | "rejected",
): HallTaskCard {
  if (outcome === "approved") {
    card.stage = "completed";
    card.status = "done";
    card.currentOwnerParticipantId = null;
    card.currentOwnerLabel = null;
    card.currentExecutionItem = null;
  } else {
    card.stage = "review";
    card.status = "in_progress";
  }
  card.updatedAt = new Date().toISOString();
  return card;
}

export function blockExecution(card: HallTaskCard): HallTaskCard {
  card.stage = "blocked";
  card.status = "blocked";
  card.updatedAt = new Date().toISOString();
  return card;
}

export function reopenToDiscussion(card: HallTaskCard): HallTaskCard {
  card.stage = "discussion";
  card.status = "todo";
  card.currentOwnerParticipantId = null;
  card.currentOwnerLabel = null;
  card.currentExecutionItem = null;
  card.updatedAt = new Date().toISOString();
  return card;
}

// ---------------------------------------------------------------------------
// Participant helpers
// ---------------------------------------------------------------------------

export function findParticipant(
  participants: HallParticipant[],
  participantId: string,
): HallParticipant | undefined {
  const normalized = participantId.trim().toLowerCase();
  return participants.find(p => {
    if (p.participantId === participantId) return true;
    if (p.displayName.trim().toLowerCase() === normalized) return true;
    return p.aliases.some(a => a.trim().toLowerCase() === normalized);
  });
}

export function pickByRole(
  participants: HallParticipant[],
  role: SemanticRole,
): HallParticipant | undefined {
  return participants.find(p => p.active && p.semanticRole === role);
}

export function buildDiscussionQueue(
  participants: HallParticipant[],
  roles: SemanticRole[] = ["planner", "coder", "reviewer", "manager"],
): string[] {
  const queue: string[] = [];
  for (const role of roles) {
    const p = pickByRole(participants, role);
    if (p && !queue.includes(p.participantId)) queue.push(p.participantId);
  }
  return queue;
}

export function recommendExecutor(
  participants: HallParticipant[],
  taskDescription: string,
): HallParticipant | undefined {
  const lower = taskDescription.toLowerCase();
  const isEngineering = /(build|fix|implement|debug|code|test|refactor)/i.test(lower);
  const preferredRoles: SemanticRole[] = isEngineering
    ? ["coder", "planner", "manager"]
    : ["planner", "coder", "generalist"];
  for (const role of preferredRoles) {
    const p = pickByRole(participants, role);
    if (p) return p;
  }
  return participants.find(p => p.active);
}

// ---------------------------------------------------------------------------
// Intent classification (for auto-promote message → task)
// ---------------------------------------------------------------------------

type OperatorIntent = "greeting" | "light_chat" | "discussion_request" | "task_request";

export function classifyOperatorIntent(content: string): OperatorIntent {
  const trimmed = content.trim();
  if (!trimmed) return "light_chat";
  if (isGreeting(trimmed)) return "greeting";

  const strongTask = [
    /\b(build|fix|implement|create|design|plan|make|ship|debug|investigate|review|prototype|brainstorm|research|analyze)\b/i,
    /(帮我|请帮|请你|麻烦|需要|我想|希望|制作|做一个|设计|策划|规划|分析|研究|实现|修|新增|创建|检查|排查|审核|产出|整理|写一个|准备|生成)/,
  ].some(p => p.test(trimmed));
  if (strongTask) return "task_request";

  const discussion = [
    /[?？]/,
    /\b(how|what|why|which|should|could|can|ideas?|advice|approach|direction|options?)\b/i,
    /(如何|怎么|为什么|是否|要不要|应该|可以怎么|思路|建议|方向|想法|比较|评估)/,
  ].some(p => p.test(trimmed));
  if (discussion) return "discussion_request";

  if (trimmed.length >= 18) return "discussion_request";
  return "light_chat";
}

function isGreeting(content: string): boolean {
  return ["hi", "hello", "hey", "yo", "你好", "您好", "嗨", "在吗", "有人吗"].includes(
    content.trim().toLowerCase(),
  );
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export function detectLanguage(source: string): ResponseLang {
  const cjk = (source.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk > 0 ? "zh" : "en";
}

// ---------------------------------------------------------------------------
// Hall summary builder
// ---------------------------------------------------------------------------

export function buildHallSummary(hall: CollaborationHall): HallSummary {
  const cards = listTaskCards(hall.hallId);
  return {
    totalMessages: hall.messageIds.length,
    totalTaskCards: cards.length,
    activeTaskCards: cards.filter(c => c.stage !== "completed").length,
    latestMessageAt: hall.latestMessageAt,
  };
}

// ---------------------------------------------------------------------------
// Role mapping helpers (for bridging with agent-dispatch)
// ---------------------------------------------------------------------------

export function toParticipantRole(role: SemanticRole): ParticipantRole {
  const map: Record<SemanticRole, ParticipantRole> = {
    planner: "planner",
    coder: "coder",
    reviewer: "reviewer",
    manager: "manager",
    generalist: "coder",
  };
  return map[role];
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function resetCollaborationStore(): void {
  hallStore = null;
  messageStore.length = 0;
  taskCardStore.clear();
  messageCounter = 0;
  taskCardCounter = 0;
}
