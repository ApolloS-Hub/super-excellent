/**
 * Kimi provider compatibility tests
 *
 * Covers: reasoning_content streaming, default baseURL, token-limit mapping,
 * and no-API-key degradation — all without real network calls.
 */
import { describe, it, expect } from "vitest";

// ─── Inline helpers extracted from agent-bridge logic ───────────────────────

/** Default Kimi base URL (same logic as agent-bridge.ts line 398/1460/1472) */
function resolveKimiBaseURL(baseURL?: string): string {
  return baseURL || "https://api.moonshot.cn/v1";
}

/** Model → token limit mapping (mirrors MODEL_TOKEN_LIMITS in agent-bridge) */
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "moonshot-v1-8k": 8000,
  "moonshot-v1-32k": 32000,
  "moonshot-v1-128k": 128000,
};

function getModelTokenLimit(model: string): number {
  const key = Object.keys(MODEL_TOKEN_LIMITS).find((k) =>
    model.toLowerCase().includes(k.toLowerCase()),
  );
  return key ? MODEL_TOKEN_LIMITS[key] : 128000;
}

/** Parse a single SSE chunk the way the compatible-stream parser does */
function parseStreamChunk(data: string) {
  const parsed = JSON.parse(data);
  const delta = parsed.choices?.[0]?.delta;
  const result: { text?: string; reasoning?: string } = {};
  if (delta?.content) result.text = delta.content;
  if (delta?.reasoning_content) result.reasoning = delta.reasoning_content;
  return result;
}

/** Validate provider config — mirrors validateApiKey early-return */
function validateConfig(config: { provider: string; apiKey: string; baseURL?: string }) {
  if (!config.apiKey) {
    return { valid: false, error: "API Key 不能为空" };
  }
  const baseURL =
    config.provider === "kimi"
      ? resolveKimiBaseURL(config.baseURL)
      : config.baseURL;
  return { valid: true, baseURL };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Kimi compat — reasoning_content streaming", () => {
  it("parses reasoning_content from a delta chunk", () => {
    const chunk = JSON.stringify({
      choices: [
        {
          delta: {
            reasoning_content: "Let me think step by step...",
          },
        },
      ],
    });
    const { reasoning, text } = parseStreamChunk(chunk);
    expect(reasoning).toBe("Let me think step by step...");
    expect(text).toBeUndefined();
  });

  it("parses regular content alongside reasoning_content", () => {
    const chunk = JSON.stringify({
      choices: [
        {
          delta: {
            content: "The answer is 42.",
            reasoning_content: "Thinking...",
          },
        },
      ],
    });
    const { text, reasoning } = parseStreamChunk(chunk);
    expect(text).toBe("The answer is 42.");
    expect(reasoning).toBe("Thinking...");
  });

  it("accumulates reasoning across multiple chunks", () => {
    const chunks = [
      { choices: [{ delta: { reasoning_content: "Step 1. " } }] },
      { choices: [{ delta: { reasoning_content: "Step 2. " } }] },
      { choices: [{ delta: { content: "Final answer." } }] },
    ];

    let reasoning = "";
    let text = "";
    for (const c of chunks) {
      const parsed = parseStreamChunk(JSON.stringify(c));
      if (parsed.reasoning) reasoning += parsed.reasoning;
      if (parsed.text) text += parsed.text;
    }

    expect(reasoning).toBe("Step 1. Step 2. ");
    expect(text).toBe("Final answer.");
  });

  it("handles chunk with empty choices gracefully", () => {
    const chunk = JSON.stringify({ choices: [] });
    const result = parseStreamChunk(chunk);
    expect(result.text).toBeUndefined();
    expect(result.reasoning).toBeUndefined();
  });
});

describe("Kimi compat — default baseURL", () => {
  it("uses https://api.moonshot.cn/v1 when no baseURL is provided", () => {
    expect(resolveKimiBaseURL()).toBe("https://api.moonshot.cn/v1");
    expect(resolveKimiBaseURL(undefined)).toBe("https://api.moonshot.cn/v1");
    expect(resolveKimiBaseURL("")).toBe("https://api.moonshot.cn/v1");
  });

  it("respects a custom baseURL when provided", () => {
    expect(resolveKimiBaseURL("https://custom.proxy/v1")).toBe(
      "https://custom.proxy/v1",
    );
  });
});

describe("Kimi compat — token limit mapping", () => {
  it("maps moonshot-v1-8k to 8000", () => {
    expect(getModelTokenLimit("moonshot-v1-8k")).toBe(8000);
  });

  it("maps moonshot-v1-32k to 32000", () => {
    expect(getModelTokenLimit("moonshot-v1-32k")).toBe(32000);
  });

  it("maps moonshot-v1-128k to 128000", () => {
    expect(getModelTokenLimit("moonshot-v1-128k")).toBe(128000);
  });

  it("returns default 128000 for unknown Kimi models", () => {
    expect(getModelTokenLimit("moonshot-v2-256k")).toBe(128000);
  });

  it("is case-insensitive", () => {
    expect(getModelTokenLimit("Moonshot-V1-32K")).toBe(32000);
  });
});

describe("Kimi compat — no API key degradation", () => {
  it("rejects with error when apiKey is empty", () => {
    const result = validateConfig({ provider: "kimi", apiKey: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("API Key");
  });

  it("returns valid with resolved baseURL when apiKey is present", () => {
    const result = validateConfig({ provider: "kimi", apiKey: "sk-test-key" });
    expect(result.valid).toBe(true);
    expect(result).toHaveProperty("baseURL", "https://api.moonshot.cn/v1");
  });

  it("non-kimi provider does not get moonshot URL", () => {
    const result = validateConfig({
      provider: "openai",
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
    });
    expect(result.valid).toBe(true);
    expect(result).toHaveProperty("baseURL", "https://api.openai.com/v1");
  });
});
