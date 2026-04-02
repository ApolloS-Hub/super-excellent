/**
 * Anthropic Provider — Claude API with prompt caching support
 * Inspired by claude-code-haha's request lifecycle
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ProviderConfig, ChatMessage, ChatOptions, ChatResponse, ChatChunk, ToolDefinition } from "./types.js";

export class AnthropicProvider implements Provider {
  private client: Anthropic;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const { systemPrompt, tools, cacheControl } = this.buildRequestParams(messages, options);

    const response = await this.client.messages.create({
      model: options?.model ?? this.config.model,
      max_tokens: options?.maxTokens ?? 8192,
      system: systemPrompt ? [{ type: "text", text: systemPrompt, ...(cacheControl ? { cache_control: { type: "ephemeral" } } : {}) }] : undefined,
      messages: this.toAnthropicMessages(messages),
      tools: tools?.length ? this.toAnthropicTools(tools) : undefined,
      temperature: options?.temperature ?? undefined,
    } as Anthropic.MessageCreateParamsNonStreaming);

    return this.parseResponse(response);
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatChunk> {
    const { systemPrompt, tools, cacheControl } = this.buildRequestParams(messages, options);

    const stream = this.client.messages.stream({
      model: options?.model ?? this.config.model,
      max_tokens: options?.maxTokens ?? 8192,
      system: systemPrompt ? [{ type: "text", text: systemPrompt, ...(cacheControl ? { cache_control: { type: "ephemeral" } } : {}) }] : undefined,
      messages: this.toAnthropicMessages(messages),
      tools: tools?.length ? this.toAnthropicTools(tools) : undefined,
      temperature: options?.temperature ?? undefined,
    } as Anthropic.MessageCreateParamsStreaming);

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if ("text" in delta) {
          yield { type: "text", text: delta.text };
        } else if ("partial_json" in delta) {
          yield { type: "tool_use_input", text: delta.partial_json };
        }
      } else if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          yield { type: "tool_use_start", toolCallId: block.id, toolName: block.name };
        }
      } else if (event.type === "message_stop") {
        yield { type: "stop" };
      }
    }
  }

  private buildRequestParams(messages: ChatMessage[], options?: ChatOptions) {
    const systemMessages = messages.filter(m => m.role === "system");
    const joined = systemMessages.map(m => typeof m.content === "string" ? m.content : "").join("\n");
    const systemPrompt = options?.systemPrompt ?? (joined || undefined);
    const cacheControl = options?.cacheControl ?? true; // Enable by default for Anthropic
    return { systemPrompt, tools: options?.tools, cacheControl };
  }

  private toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    return messages
      .filter(m => m.role !== "system")
      .map(m => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [{
              type: "tool_result" as const,
              tool_use_id: m.tool_call_id ?? "",
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            }],
          };
        }
        return {
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        };
      });
  }

  private toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  private parseResponse(response: Anthropic.Message): ChatResponse {
    let text = "";
    const toolCalls: ChatResponse["toolCalls"] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: text,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens,
        cacheWriteTokens: (response.usage as unknown as Record<string, number>).cache_creation_input_tokens,
      },
      stopReason: response.stop_reason ?? "end_turn",
    };
  }
}
