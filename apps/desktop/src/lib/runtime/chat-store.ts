/**
 * Chat Store — 对话存储，支持多会话/房间
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/chat-store.ts
 * Rewritten as in-memory store (no filesystem dependencies)
 */

import type { ParticipantRole } from "./agent-dispatch";

export type RoomStage = "intake" | "discussion" | "assigned" | "executing" | "review" | "completed";
export type MessageKind = "chat" | "proposal" | "decision" | "handoff" | "status" | "result";

export interface RoomParticipant {
  participantId: string;
  role: ParticipantRole;
  label: string;
  active: boolean;
}

export interface HandoffRecord {
  handoffId: string;
  roomId: string;
  taskId: string;
  fromRole: ParticipantRole;
  toRole: ParticipantRole;
  note?: string;
  createdAt: string;
}

export interface ChatRoom {
  roomId: string;
  projectId: string;
  taskId: string;
  title: string;
  stage: RoomStage;
  ownerRole: ParticipantRole;
  assignedExecutor?: ParticipantRole;
  proposal?: string;
  decision?: string;
  doneWhen?: string;
  participants: RoomParticipant[];
  handoffs: HandoffRecord[];
  sessionKeys: string[];
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessagePayload {
  proposal?: string;
  decision?: string;
  executor?: ParticipantRole;
  doneWhen?: string;
  fromRole?: ParticipantRole;
  targetRole?: ParticipantRole;
  handoffId?: string;
  status?: string;
  taskStatus?: "todo" | "in_progress" | "blocked" | "done";
  reviewOutcome?: "approved" | "rejected";
  sessionKey?: string;
  sourceSessionKey?: string;
  sourceTool?: string;
}

export interface ChatMessage {
  roomId: string;
  messageId: string;
  kind: MessageKind;
  authorRole: ParticipantRole;
  authorLabel: string;
  participantId?: string;
  content: string;
  mentions: ParticipantRole[];
  sessionKey?: string;
  payload?: ChatMessagePayload;
  createdAt: string;
}

export interface CreateChatMessageInput {
  roomId: string;
  kind?: MessageKind;
  authorRole: ParticipantRole;
  authorLabel?: string;
  content: string;
  mentions?: ParticipantRole[];
  sessionKey?: string;
  payload?: ChatMessagePayload;
}

export interface CreateChatRoomInput {
  projectId: string;
  taskId: string;
  roomId?: string;
  title?: string;
  stage?: RoomStage;
  ownerRole?: ParticipantRole;
  assignedExecutor?: ParticipantRole;
  participants?: RoomParticipant[];
}

export class ChatStoreValidationError extends Error {
  readonly statusCode: number;
  readonly issues: string[];
  constructor(message: string, issues: string[] = [], statusCode = 400) {
    super(message);
    this.name = "ChatStoreValidationError";
    this.issues = issues;
    this.statusCode = statusCode;
  }
}

const DEFAULT_ROLES: ParticipantRole[] = ["human", "planner", "coder", "reviewer", "manager"];

function defaultParticipants(): RoomParticipant[] {
  const labels: Record<ParticipantRole, string> = {
    human: "Operator", planner: "Planner", coder: "Coder", reviewer: "Reviewer", manager: "Manager",
  };
  return DEFAULT_ROLES.map(role => ({
    participantId: role,
    role,
    label: labels[role],
    active: true,
  }));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let rooms: ChatRoom[] = [];
let messages: ChatMessage[] = [];
const changeListeners = new Set<() => void>();

export function onChatStoreChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function notifyChange(): void {
  for (const fn of changeListeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function listChatRooms(): ChatRoom[] {
  return [...rooms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getChatRoom(roomId: string): ChatRoom | undefined {
  return rooms.find(r => r.roomId === roomId.trim());
}

export function getChatRoomByTask(taskId: string, projectId?: string): ChatRoom | undefined {
  const tid = taskId.trim();
  const pid = projectId?.trim();
  return rooms.find(r => r.taskId === tid && (!pid || r.projectId === pid));
}

export function listChatMessages(roomId: string): ChatMessage[] {
  const rid = roomId.trim();
  return messages
    .filter(m => m.roomId === rid)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createChatRoom(input: CreateChatRoomInput): ChatRoom {
  const roomId = input.roomId?.trim() || `${input.projectId}:${input.taskId}`;
  if (rooms.some(r => r.roomId === roomId)) {
    throw new ChatStoreValidationError(`roomId '${roomId}' already exists.`, ["roomId"], 409);
  }
  if (getChatRoomByTask(input.taskId, input.projectId)) {
    throw new ChatStoreValidationError(
      `task '${input.projectId}:${input.taskId}' already has a room.`, ["taskId"], 409,
    );
  }

  const now = new Date().toISOString();
  const room: ChatRoom = {
    roomId,
    projectId: input.projectId,
    taskId: input.taskId,
    title: input.title ?? input.taskId,
    stage: input.stage ?? "intake",
    ownerRole: input.ownerRole ?? "human",
    assignedExecutor: input.assignedExecutor,
    participants: input.participants ?? defaultParticipants(),
    handoffs: [],
    sessionKeys: [],
    lastMessageAt: undefined,
    createdAt: now,
    updatedAt: now,
  };

  rooms.push(room);
  notifyChange();
  return room;
}

export function updateChatRoom(
  roomId: string,
  patch: Partial<Pick<ChatRoom, "stage" | "ownerRole" | "assignedExecutor" | "proposal" | "decision" | "doneWhen">>,
): ChatRoom {
  const room = getChatRoom(roomId);
  if (!room) throw new ChatStoreValidationError(`roomId '${roomId}' not found.`, [], 404);

  const now = new Date().toISOString();
  if (patch.stage !== undefined) room.stage = patch.stage;
  if (patch.ownerRole !== undefined) room.ownerRole = patch.ownerRole;
  if (patch.assignedExecutor !== undefined) room.assignedExecutor = patch.assignedExecutor;
  if (patch.proposal !== undefined) room.proposal = patch.proposal;
  if (patch.decision !== undefined) room.decision = patch.decision;
  if (patch.doneWhen !== undefined) room.doneWhen = patch.doneWhen;
  room.updatedAt = now;

  notifyChange();
  return room;
}

export function appendChatMessage(input: CreateChatMessageInput): ChatMessage {
  const room = getChatRoom(input.roomId);
  if (!room) throw new ChatStoreValidationError(`roomId '${input.roomId}' not found.`, ["roomId"], 404);

  const now = new Date().toISOString();
  const message: ChatMessage = {
    roomId: input.roomId,
    messageId: generateId(),
    kind: input.kind ?? "chat",
    authorRole: input.authorRole,
    authorLabel: input.authorLabel ?? input.authorRole,
    content: input.content,
    mentions: input.mentions ?? [],
    sessionKey: input.sessionKey,
    payload: input.payload,
    createdAt: now,
  };

  messages.push(message);
  room.lastMessageAt = now;
  room.updatedAt = now;

  if (message.payload?.proposal) room.proposal = message.payload.proposal;
  if (message.payload?.decision) room.decision = message.payload.decision;
  if (message.payload?.executor) room.assignedExecutor = message.payload.executor;
  if (message.payload?.doneWhen) room.doneWhen = message.payload.doneWhen;

  notifyChange();
  return message;
}

export function createHandoff(input: {
  roomId: string;
  fromRole: ParticipantRole;
  toRole: ParticipantRole;
  note?: string;
}): HandoffRecord {
  const room = getChatRoom(input.roomId);
  if (!room) throw new ChatStoreValidationError(`roomId '${input.roomId}' not found.`, ["roomId"], 404);

  const handoff: HandoffRecord = {
    handoffId: generateId(),
    roomId: input.roomId,
    taskId: room.taskId,
    fromRole: input.fromRole,
    toRole: input.toRole,
    note: input.note,
    createdAt: new Date().toISOString(),
  };

  room.handoffs.push(handoff);
  room.ownerRole = input.toRole;
  room.updatedAt = handoff.createdAt;

  notifyChange();
  return handoff;
}

export function deleteChatRoom(roomId: string, deleteMessages = false): { removedMessages: number } {
  const room = getChatRoom(roomId);
  if (!room) throw new ChatStoreValidationError(`roomId '${roomId}' not found.`, ["roomId"], 404);

  rooms = rooms.filter(r => r.roomId !== roomId);
  let removedMessages = 0;
  if (deleteMessages) {
    const before = messages.length;
    messages = messages.filter(m => m.roomId !== roomId);
    removedMessages = before - messages.length;
  }

  notifyChange();
  return { removedMessages };
}

export function resetChatStore(): void {
  rooms = [];
  messages = [];
  notifyChange();
}
