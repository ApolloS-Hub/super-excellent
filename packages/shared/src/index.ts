/**
 * Shared types for Super Excellent
 */

export interface AppConfig {
  provider: "anthropic" | "openai" | "compatible";
  apiKey: string;
  baseURL?: string;
  model: string;
  language: "zh-CN" | "en-US";
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
