import { describe, it, expect } from "vitest";
import { analyzeIntent } from "../../lib/coordinator";
import { PROVIDER_DEFAULT_BASE_URLS } from "../../lib/agent-bridge";

describe("Worker dispatch URL resolution (root cause of hang bug)", () => {
  it("Anthropic provider resolves to api.anthropic.com, NOT api.openai.com", () => {
    const config = { provider: "anthropic", baseURL: "" };
    const rawBaseURL = config.baseURL || PROVIDER_DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
    const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
    const apiUrl = baseURL + "/v1/messages";
    
    expect(apiUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(apiUrl).not.toContain("openai");
  });

  it("OpenAI provider resolves to api.openai.com", () => {
    const config = { provider: "openai", baseURL: "" };
    const rawBaseURL = config.baseURL || PROVIDER_DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
    const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
    const apiUrl = baseURL + "/v1/chat/completions";
    
    expect(apiUrl).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("Kimi provider resolves to api.moonshot.cn", () => {
    const config = { provider: "kimi", baseURL: "" };
    const rawBaseURL = config.baseURL || PROVIDER_DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
    const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
    
    expect(baseURL).toContain("moonshot");
  });

  it("Custom baseURL overrides provider default", () => {
    const config = { provider: "anthropic", baseURL: "https://my-proxy.com/v1" };
    const rawBaseURL = config.baseURL || PROVIDER_DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
    const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
    
    expect(baseURL).toBe("https://my-proxy.com");
  });

  it("搜索最新的 AI 新闻 routes to researcher worker", () => {
    const intent = analyzeIntent("搜索最新的 AI 新闻");
    expect(intent.type).toBe("task");
    expect(intent.workers).toContain("researcher");
  });
});
