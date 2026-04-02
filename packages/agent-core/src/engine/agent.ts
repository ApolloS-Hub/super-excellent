/**
 * Agent — High-level API for creating and running agents
 * 
 * Inspired by open-agent-sdk's createAgent() API.
 * Uses QueryEngine for the agentic loop, Provider for LLM calls,
 * and ToolExecutor for tool execution.
 */
import type { AgentOptions, AgentInstance, QueryResult, StreamEvent, Message } from "./types.js";
import { QueryEngine } from "./query-engine.js";
import { createProvider } from "../providers/index.js";
import { createToolExecutor, BUILTIN_TOOLS } from "../tools/index.js";
import type { PermissionMode } from "../tools/types.js";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. You can use tools to help accomplish tasks.
When you need to perform actions on the computer, use the available tools.
Be concise and direct in your responses.`;

export function createAgent(options: AgentOptions = {}): AgentInstance {
  const providerConfig = {
    type: (options.provider ?? "anthropic") as "anthropic" | "openai" | "compatible",
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseURL: options.baseURL,
    model: options.model ?? "claude-sonnet-4-6",
  };

  // Handle case where no API key is available (placeholder mode)
  const hasApiKey = Boolean(providerConfig.apiKey);

  const provider = hasApiKey ? createProvider(providerConfig) : null;
  const toolExecutor = createToolExecutor(
    BUILTIN_TOOLS,
    (options.permissionMode ?? "bypassPermissions") as PermissionMode,
  );

  const messages: Message[] = [];
  let engine: QueryEngine | null = null;
  let abortController = new AbortController();

  const initEngine = () => {
    if (!provider) return null;
    return new QueryEngine({
      provider,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools: toolExecutor.getDefinitions(),
      toolExecutor,
      maxTurns: options.maxTurns ?? 10,
      maxBudgetUsd: options.maxBudgetUsd,
      cacheControl: true,
    });
  };

  engine = initEngine();

  const prompt = async (text: string): Promise<QueryResult> => {
    if (!engine) {
      // Placeholder mode — no API key configured
      const placeholderResult: QueryResult = {
        text: `[No API key configured] Received: "${text}"`,
        messages: [],
        numTurns: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
      };
      messages.push({ role: "user", content: text });
      messages.push({ role: "assistant", content: placeholderResult.text });
      return placeholderResult;
    }

    let lastResult: QueryResult | null = null;
    for await (const event of engine.execute(text)) {
      if (event.type === "result" && event.result) {
        lastResult = event.result;
      }
    }

    if (lastResult) {
      messages.push({ role: "user", content: text });
      messages.push({ role: "assistant", content: lastResult.text });
    }

    return lastResult ?? {
      text: "No response generated",
      messages: [],
      numTurns: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
    };
  };

  async function* query(text: string): AsyncGenerator<StreamEvent> {
    if (!engine) {
      yield { type: "text", text: `[No API key configured] Received: "${text}"` };
      yield {
        type: "result",
        result: {
          text: `[No API key configured] Received: "${text}"`,
          messages: [],
          numTurns: 0,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          costUsd: 0,
        },
      };
      return;
    }

    for await (const event of engine.execute(text)) {
      yield event;
    }
  }

  return {
    prompt,
    query,
    getMessages: () => [...messages],
    clear: () => {
      messages.length = 0;
      engine?.clearHistory();
    },
    interrupt: () => {
      abortController?.abort();
    },
    setModel: (model: string) => {
      providerConfig.model = model;
      // Re-init engine with new model
      if (provider) {
        engine = initEngine();
      }
    },
    close: async () => {
      // Persist session (future: write to disk)
    },
  };
}
