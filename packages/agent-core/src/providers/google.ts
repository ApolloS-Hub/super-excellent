/**
 * Google Gemini Provider — native Gemini API
 * Uses @google/genai SDK for full Gemini feature support
 */
import { GoogleGenAI, type Content, type Part, type Tool, type FunctionDeclaration, type GenerateContentResponse } from "@google/genai";
import type { Provider, ProviderConfig, ChatMessage, ChatOptions, ChatResponse, ChatChunk, ToolDefinition } from "./types.js";

export class GoogleProvider implements Provider {
  private client: GoogleGenAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? this.config.model;
    const { contents, systemInstruction } = this.toGeminiMessages(messages, options?.systemPrompt);
    const tools = options?.tools?.length ? this.toGeminiTools(options.tools) : undefined;

    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: options?.maxTokens ?? 8192,
        temperature: options?.temperature ?? undefined,
        systemInstruction: systemInstruction || undefined,
        tools,
      },
    });

    return this.parseResponse(response);
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatChunk> {
    const model = options?.model ?? this.config.model;
    const { contents, systemInstruction } = this.toGeminiMessages(messages, options?.systemPrompt);
    const tools = options?.tools?.length ? this.toGeminiTools(options.tools) : undefined;

    const response = await this.client.models.generateContentStream({
      model,
      contents,
      config: {
        maxOutputTokens: options?.maxTokens ?? 8192,
        temperature: options?.temperature ?? undefined,
        systemInstruction: systemInstruction || undefined,
        tools,
      },
    });

    for await (const chunk of response) {
      if (!chunk.candidates?.[0]?.content?.parts) continue;

      for (const part of chunk.candidates[0].content.parts) {
        if (part.text) {
          yield { type: "text", text: part.text };
        }
        if (part.functionCall) {
          yield {
            type: "tool_use_start",
            toolCallId: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            toolName: part.functionCall.name,
          };
          yield {
            type: "tool_use_input",
            text: JSON.stringify(part.functionCall.args ?? {}),
          };
        }
      }

      if (chunk.candidates[0].finishReason) {
        yield { type: "stop" };
      }
    }
  }

  private toGeminiMessages(
    messages: ChatMessage[],
    systemPrompt?: string,
  ): { contents: Content[]; systemInstruction: string } {
    const contents: Content[] = [];
    let systemInstruction = systemPrompt ?? "";

    for (const m of messages) {
      if (m.role === "system") {
        // Gemini uses systemInstruction, not system messages
        systemInstruction += (systemInstruction ? "\n\n" : "") +
          (typeof m.content === "string" ? m.content : m.content.map(b => b.text ?? "").join(""));
        continue;
      }

      const parts: Part[] = [];
      if (typeof m.content === "string") {
        if (m.role === "tool") {
          // Tool results in Gemini use functionResponse
          parts.push({
            functionResponse: {
              name: m.tool_call_id ?? "unknown",
              response: { result: m.content },
            },
          });
        } else {
          parts.push({ text: m.content });
        }
      } else {
        for (const block of m.content) {
          if (block.type === "text" && block.text) {
            parts.push({ text: block.text });
          } else if (block.type === "tool_use" && block.name) {
            parts.push({
              functionCall: {
                name: block.name,
                args: (block.input as Record<string, unknown>) ?? {},
              },
            });
          } else if (block.type === "tool_result" && block.text) {
            parts.push({
              functionResponse: {
                name: block.name ?? "unknown",
                response: { result: block.text },
              },
            });
          }
        }
      }

      if (parts.length > 0) {
        const role = m.role === "assistant" ? "model" : "user";
        contents.push({ role, parts });
      }
    }

    return { contents, systemInstruction };
  }

  private toGeminiTools(tools: ToolDefinition[]): Tool[] {
    const functionDeclarations: FunctionDeclaration[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as FunctionDeclaration["parameters"],
    }));

    return [{ functionDeclarations }];
  }

  private parseResponse(response: GenerateContentResponse): ChatResponse {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: ChatResponse["toolCalls"] = [];
    let textContent = "";

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name ?? "",
          input: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        cacheReadTokens: response.usageMetadata?.cachedContentTokenCount ?? 0,
      },
      stopReason: candidate?.finishReason ?? "stop",
    };
  }
}
