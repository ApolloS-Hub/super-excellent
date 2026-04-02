/**
 * Agent Bridge — connects the React frontend to agent-core
 * 
 * In Tauri, the agent runs in the Node.js sidecar process.
 * For now (dev mode), we run it directly in the renderer via Vite.
 * Production will use Tauri commands to talk to the Rust backend.
 */

export interface AgentConfig {
  provider: "anthropic" | "openai" | "compatible";
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  toolCalls?: Array<{ name: string; input: string }>;
  isStreaming?: boolean;
}

export interface AgentEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "result" | "error";
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  isError?: boolean;
}

type EventCallback = (event: AgentEvent) => void;

/**
 * Send a message to the agent and receive streaming events
 */
export async function sendMessage(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
): Promise<void> {
  // For MVP: direct API call from frontend
  // In production: this will go through Tauri command → Rust → Node sidecar
  
  if (!config.apiKey) {
    onEvent({ type: "error", text: "请先在设置中配置 API Key" });
    return;
  }

  try {
    if (config.provider === "anthropic") {
      await callAnthropic(message, config, onEvent);
    } else {
      await callOpenAI(message, config, onEvent);
    }
  } catch (error) {
    onEvent({
      type: "error",
      text: error instanceof Error ? error.message : String(error),
    });
  }
}

async function callAnthropic(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
): Promise<void> {
  const baseURL = config.baseURL || "https://api.anthropic.com";

  const response = await fetch(`${baseURL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model || "claude-sonnet-4-6",
      max_tokens: 4096,
      stream: true,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  await processSSEStream(response, onEvent);
}

async function callOpenAI(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
): Promise<void> {
  const baseURL = config.baseURL || "https://api.openai.com";

  const response = await fetch(`${baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o",
      max_tokens: 4096,
      stream: true,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  await processSSEStream(response, onEvent);
}

async function processSSEStream(
  response: Response,
  onEvent: EventCallback,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);

        // Anthropic format
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          fullText += parsed.delta.text;
          onEvent({ type: "text", text: parsed.delta.text });
        }

        // OpenAI format
        if (parsed.choices?.[0]?.delta?.content) {
          fullText += parsed.choices[0].delta.content;
          onEvent({ type: "text", text: parsed.choices[0].delta.content });
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  onEvent({ type: "result", text: fullText });
}

/**
 * Load config from localStorage
 */
export function loadConfig(): AgentConfig {
  try {
    const saved = localStorage.getItem("agent-config");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  
  return {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-6",
  };
}

/**
 * Save config to localStorage
 */
export function saveConfig(config: AgentConfig): void {
  localStorage.setItem("agent-config", JSON.stringify(config));
}
