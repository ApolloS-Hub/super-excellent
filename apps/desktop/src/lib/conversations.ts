/**
 * Conversation management — each conversation has isolated message context
 */
import type { ChatMessage } from "./agent-bridge";
import { loadAllConversations, saveConversation as saveDB, deleteConversationDB } from "./session-store";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  provider?: string;
  model?: string;
}

const MAX_CONVERSATIONS = 100;

export function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return "新对话";
  const text = firstUser.content.trim();
  return text.length > 30 ? text.slice(0, 30) + "..." : text;
}

export async function loadConversationsAsync(): Promise<Conversation[]> {
  try {
    const records = await loadAllConversations();
    return records as Conversation[];
  } catch {
    return [];
  }
}

export async function saveConversationsAsync(convs: Conversation[]): Promise<void> {
  const trimmed = convs.slice(0, MAX_CONVERSATIONS);
  for (const c of trimmed) {
    await saveDB(c as any);
  }
}

export function createConversation(): Conversation {
  return {
    id: generateId(),
    title: "新对话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

export function updateConversation(
  convs: Conversation[],
  id: string,
  messages: ChatMessage[],
): Conversation[] {
  const updated = convs.map(c => {
    if (c.id !== id) return c;
    const title = c.messages.length === 0 && messages.length > 0
      ? generateTitle(messages)
      : c.title;
    return { ...c, title, messages, updatedAt: Date.now() };
  });
  return updated.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteConversation(convs: Conversation[], id: string): Conversation[] {
  deleteConversationDB(id).catch(console.error);
  return convs.filter(c => c.id !== id);
}

export function renameConversation(convs: Conversation[], id: string, title: string): Conversation[] {
  const updated = convs.map(c => c.id === id ? { ...c, title } : c);
  const target = updated.find(c => c.id === id);
  if (target) saveDB(target as any).catch(console.error);
  return updated;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(ts).toLocaleDateString();
}

