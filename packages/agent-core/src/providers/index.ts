/**
 * Provider factory — creates the right provider based on config
 */
import type { Provider, ProviderConfig } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
    case "compatible":
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

export { AnthropicProvider } from "./anthropic.js";
export { OpenAIProvider } from "./openai.js";
export type { Provider, ProviderConfig } from "./types.js";
