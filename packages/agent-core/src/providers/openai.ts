/**
 * OpenAI Provider — GPT / compatible endpoints
 */
import OpenAI from "openai";
import type { Provider, ProviderConfig, ChatMessage, ChatOptions, ChatResponse, ChatChunk, ToolDefinition } from "./types.js";

export class OpenAIProvider implements Provider {
  private client: OpenAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const tools = options?.tools?.length ? this.toOpenAITools(options.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.config.model,
      max_tokens: options?.maxTokens ?? 8192,
      messages: this.toOpenAIMessages(messages, options?.systemPrompt),
      tools,
      temperature: options?.temperature ?? undefined,
    });

    return this.parseResponse(response);
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatChunk> {
    const tools = options?.tools?.length ? this.toOpenAITools(options.tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model: options?.model ?? this.config.model,
      max_tokens: options?.maxTokens ?? 8192,
      messages: this.toOpenAIMessages(messages, options?.systemPrompt),
      tools,
      temperature: options?.temperature ?? undefined,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: "text", text: delta.content };
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            yield { type: "tool_use_start", toolCallId: tc.id, toolName: tc.function?.name };
          }
          if (tc.function?.arguments) {
            yield { type: "tool_use_input", text: tc.function.arguments };
          }
        }
      }
      if (chunk.choices[0]?.finish_reason) {
        yield { type: "stop" };
      }
    }
  }

  private toOpenAIMessages(messages: ChatMessage[], systemPrompt?: string): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const m of messages) {
      if (m.role === "system" && systemPrompt) continue; // Already added
      if (m.role === "tool") {
        result.push({
          role: "tool",
          tool_call_id: m.tool_call_id ?? "",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      } else {
        result.push({
          role: m.role as "system" | "user" | "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        } as OpenAI.ChatCompletionMessageParam);
      }
    }

    return result;
  }

  private toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private parseResponse(response: OpenAI.ChatCompletion): ChatResponse {
    const choice = response.choices[0];
    const toolCalls: ChatResponse["toolCalls"] = [];

    if (choice?.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
    }

    return {
      content: choice?.message.content ?? "",
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      stopReason: choice?.finish_reason ?? "stop",
    };
  }
}
