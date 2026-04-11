/**
 * Agent Bridge mock — provides deterministic implementations
 * for testing without real API calls.
 */
import { vi } from "vitest";
import type { AgentConfig, AgentEvent } from "../../lib/agent-bridge";

type EventCallback = (event: AgentEvent) => void;

/** Default config returned by loadConfig */
export const DEFAULT_CONFIG: AgentConfig = {
  provider: "anthropic",
  apiKey: "sk-test-key-mock-12345",
  model: "claude-sonnet-4-20250514",
  baseURL: "https://api.anthropic.com",
  enableTools: true,
};

/**
 * sendMessage — async noop that fires an onEvent callback with a text response
 */
export const sendMessage = vi.fn(
  async (
    message: string,
    _config: AgentConfig,
    onEvent: EventCallback,
  ): Promise<void> => {
    // Simulate thinking event
    onEvent({ type: "thinking", text: "Processing your request..." });

    // Simulate text response event
    onEvent({
      type: "text",
      text: `Mock response to: "${message.slice(0, 50)}"`,
    });

    // Simulate result event
    onEvent({ type: "result", text: "Done" });
  },
);

/**
 * loadConfig — returns default config from localStorage or fallback
 */
export const loadConfig = vi.fn((): AgentConfig => {
  try {
    const raw = localStorage.getItem("agent-config");
    if (raw) return JSON.parse(raw) as AgentConfig;
  } catch {
    // Ignore parse errors, return default
  }
  return { ...DEFAULT_CONFIG };
});

/**
 * saveConfig — stores config to localStorage
 */
export const saveConfig = vi.fn((config: AgentConfig): void => {
  localStorage.setItem("agent-config", JSON.stringify(config));
});

/**
 * validateApiKey — always returns true in test
 */
export const validateApiKey = vi.fn(
  async (_provider: string, _apiKey: string): Promise<boolean> => {
    return true;
  },
);

/**
 * abortGeneration — noop
 */
export const abortGeneration = vi.fn((): void => {
  // Nothing to abort in test
});
