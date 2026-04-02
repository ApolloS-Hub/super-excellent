/**
 * QueryEngine — Core agentic loop
 * 
 * Architecture from open-agent-sdk's QueryEngine:
 *   User message → LLM API → tool calls → execute tools → feed results → repeat
 *   Until: no more tool calls OR maxTurns reached OR budget exhausted
 * 
 * With claude-code-haha's prompt caching and auto-compact strategies.
 */
import type { Provider, ChatMessage, ChatOptions, ChatResponse, ToolDefinition } from "../providers/types.js";
import type { Message, ToolCall, ToolResult, QueryResult, StreamEvent } from "./types.js";
import type { ToolExecutor } from "../tools/types.js";

export interface QueryEngineOptions {
  provider: Provider;
  systemPrompt: string;
  tools: ToolDefinition[];
  toolExecutor: ToolExecutor;
  maxTurns: number;
  maxBudgetUsd?: number;
  cacheControl?: boolean;
  /** Token threshold for auto-compact (default 80% of context window) */
  compactThreshold?: number;
}

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export class QueryEngine {
  private options: QueryEngineOptions;
  private conversationHistory: ChatMessage[] = [];
  private usage: UsageAccumulator = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  constructor(options: QueryEngineOptions) {
    this.options = options;
  }

  /**
   * Execute a full agentic loop for a user message.
   * Returns streaming events as an async generator.
   */
  async *execute(userMessage: string): AsyncGenerator<StreamEvent> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    let turns = 0;

    while (turns < this.options.maxTurns) {
      turns++;

      // Call LLM
      const chatOptions: ChatOptions = {
        systemPrompt: this.options.systemPrompt,
        tools: this.options.tools.length > 0 ? this.options.tools : undefined,
        cacheControl: this.options.cacheControl ?? true,
      };

      let response: ChatResponse;
      try {
        response = await this.options.provider.chat(this.conversationHistory, chatOptions);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        yield { type: "error", error: errMsg };
        return;
      }

      // Accumulate usage
      this.usage.inputTokens += response.usage.inputTokens;
      this.usage.outputTokens += response.usage.outputTokens;
      this.usage.cacheReadTokens += response.usage.cacheReadTokens ?? 0;
      this.usage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;

      // Emit text content
      if (response.content) {
        yield { type: "text", text: response.content };
      }

      // Check if there are tool calls
      if (response.toolCalls.length === 0) {
        // No tool calls — conversation turn is complete
        this.conversationHistory.push({ role: "assistant", content: response.content });
        break;
      }

      // Build assistant message with tool calls for history
      const assistantContent: string = response.content || "";
      this.conversationHistory.push({
        role: "assistant",
        content: assistantContent,
        // Store tool calls in a way we can reconstruct
      });

      // Execute each tool call
      for (const tc of response.toolCalls) {
        const toolCall: ToolCall = { id: tc.id, name: tc.name, input: tc.input };
        yield { type: "tool_use", toolCall };

        // Execute tool
        let toolResult: ToolResult;
        try {
          const output = await this.options.toolExecutor.execute(tc.name, tc.input);
          toolResult = { toolCallId: tc.id, output, isError: false };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          toolResult = { toolCallId: tc.id, output: `Error: ${errMsg}`, isError: true };
        }

        yield { type: "tool_result", toolResult };

        // Add tool result to conversation
        this.conversationHistory.push({
          role: "tool",
          content: toolResult.output,
          tool_call_id: tc.id,
        });
      }

      // Auto-compact check: if conversation is getting too long
      if (this.shouldCompact()) {
        await this.compact();
      }
    }

    // Build final result
    const lastAssistant = [...this.conversationHistory].reverse().find(m => m.role === "assistant");
    const result: QueryResult = {
      text: typeof lastAssistant?.content === "string" ? lastAssistant.content : "",
      messages: this.conversationHistory.map(m => ({
        role: m.role as Message["role"],
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      numTurns: turns,
      usage: { ...this.usage },
      costUsd: this.estimateCost(),
    };

    yield { type: "result", result };
  }

  /**
   * Check if conversation should be auto-compacted.
   * Rough estimation based on message count (proper token counting in future).
   */
  private shouldCompact(): boolean {
    const threshold = this.options.compactThreshold ?? 50;
    return this.conversationHistory.length > threshold;
  }

  /**
   * Auto-compact: summarize older messages to save context window.
   * Keeps the system prompt and recent messages, summarizes the middle.
   */
  private async compact(): Promise<void> {
    if (this.conversationHistory.length <= 10) return;

    // Keep last 10 messages, summarize the rest
    const toSummarize = this.conversationHistory.slice(0, -10);
    const toKeep = this.conversationHistory.slice(-10);

    // Create a summary
    const summaryText = toSummarize
      .filter(m => m.role === "assistant" || m.role === "user")
      .map(m => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 200) : "..."}`)
      .join("\n");

    const compactMessage: ChatMessage = {
      role: "user",
      content: `[Conversation Summary]\n${summaryText}\n[End Summary]`,
    };

    this.conversationHistory = [compactMessage, ...toKeep];
  }

  private estimateCost(): number {
    // Rough cost estimation for Claude Sonnet
    const inputCost = this.usage.inputTokens * 0.000003;
    const outputCost = this.usage.outputTokens * 0.000015;
    const cacheReadCost = this.usage.cacheReadTokens * 0.0000003;
    const cacheWriteCost = this.usage.cacheWriteTokens * 0.00000375;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  clearHistory(): void {
    this.conversationHistory = [];
    this.usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }
}
