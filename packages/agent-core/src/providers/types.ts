export interface ProviderConfig {
  type: "anthropic" | "openai" | "google" | "compatible";
  apiKey: string;
  baseURL?: string;
  model: string;
  /** Custom headers */
  headers?: Record<string, string>;
}

export interface Provider {
  /** Send a chat completion request */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  /** Stream a chat completion */
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatChunk>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
  tool_call_id?: string;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  /** Enable prompt caching for system prompt */
  cacheControl?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  stopReason: string;
}

export interface ChatChunk {
  type: "text" | "tool_use_start" | "tool_use_input" | "stop";
  text?: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
