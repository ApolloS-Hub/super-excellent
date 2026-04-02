export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError?: boolean;
}

export interface AgentOptions {
  /** LLM model identifier */
  model?: string;
  /** API key */
  apiKey?: string;
  /** Custom API endpoint */
  baseURL?: string;
  /** Provider type: "anthropic" | "openai" | "compatible" */
  provider?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Maximum agentic turns */
  maxTurns?: number;
  /** Working directory */
  cwd?: string;
  /** Permission mode */
  permissionMode?: "default" | "acceptEdits" | "dontAsk" | "bypassPermissions" | "plan";
  /** Token budget */
  maxBudgetUsd?: number;
}

export interface QueryResult {
  text: string;
  messages: Message[];
  numTurns: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  costUsd: number;
}

export interface AgentInstance {
  /** Send a prompt and get a blocking result */
  prompt(text: string): Promise<QueryResult>;
  /** Send a prompt with streaming */
  query(text: string): AsyncGenerator<StreamEvent>;
  /** Get conversation history */
  getMessages(): Message[];
  /** Reset session */
  clear(): void;
  /** Abort current query */
  interrupt(): void;
  /** Change model */
  setModel(model: string): void;
  /** Close and persist */
  close(): Promise<void>;
}

export interface StreamEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "result" | "error";
  text?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  result?: QueryResult;
  error?: string;
}
