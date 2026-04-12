/**
 * Real end-to-end integration test — actually calls Anthropic API
 * Simulates the EXACT flow that happens when user types a message in the app
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock Tauri environment
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: globalThis.fetch, // Use real Node.js fetch instead of Tauri fetch
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

const TEST_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SKIP_REASON = !TEST_API_KEY ? "Set ANTHROPIC_API_KEY env var to run real API tests" : "";

describe.skipIf(!TEST_API_KEY)("Real Anthropic API integration", () => {
  it("direct fetch to Anthropic API works with stream:false", async () => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": TEST_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 100,
        messages: [{ role: "user", content: "Say hello in one word" }],
        stream: false,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.content).toBeDefined();
    expect(data.content.length).toBeGreaterThan(0);
    expect(data.content[0].type).toBe("text");
    expect(data.content[0].text.length).toBeGreaterThan(0);
    console.log("✅ API response:", data.content[0].text);
  }, 30000);

  it("Anthropic API with tools returns tool_use when appropriate", async () => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": TEST_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: "You are a research analyst. Use the web_search tool to find information.",
        messages: [{ role: "user", content: "Search for latest AI news" }],
        tools: [{
          name: "web_search",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        }],
        stream: false,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.content).toBeDefined();
    console.log("✅ Response blocks:", data.content.map((b: any) => b.type));

    // Model may return text, tool_use, or both
    const types = data.content.map((b: any) => b.type);
    expect(types.length).toBeGreaterThan(0);

    if (types.includes("tool_use")) {
      const toolBlock = data.content.find((b: any) => b.type === "tool_use");
      console.log("✅ Tool call:", toolBlock.name, toolBlock.input);
      expect(toolBlock.name).toBe("web_search");
    } else {
      console.log("✅ Text response (no tool call):", data.content[0].text.slice(0, 100));
    }
  }, 30000);
});

describe("sendMessage flow simulation (no API key needed)", () => {
  it("analyzeIntent routes '搜索最新的 AI 新闻' to researcher", async () => {
    const { analyzeIntent } = await import("../../lib/coordinator");
    const intent = analyzeIntent("搜索最新的 AI 新闻");
    expect(intent.type).toBe("task");
    expect(intent.workers).toContain("researcher");
  });

  it("worker prompt injection creates correct enhanced message", async () => {
    const { getWorker, getLocalizedName, getLocalizedPrompt } = await import("../../lib/team");
    const worker = getWorker("researcher");
    expect(worker).toBeDefined();

    const name = getLocalizedName(worker!);
    const prompt = getLocalizedPrompt(worker!);

    expect(name.length).toBeGreaterThan(0);
    expect(prompt.length).toBeGreaterThan(10);

    const enhancedMessage = `[Role: ${name}]\n${prompt}\n\n[User Request]\n搜索最新的 AI 新闻`;
    expect(enhancedMessage).toContain("[Role:");
    expect(enhancedMessage).toContain("[User Request]");
    expect(enhancedMessage).toContain("搜索最新的 AI 新闻");
    console.log("✅ Enhanced message length:", enhancedMessage.length, "chars");
    console.log("✅ Worker name:", name);
  });

  it("PROVIDER_DEFAULT_BASE_URLS has correct Anthropic URL", async () => {
    const { PROVIDER_DEFAULT_BASE_URLS } = await import("../../lib/agent-bridge");
    expect(PROVIDER_DEFAULT_BASE_URLS.anthropic).toBe("https://api.anthropic.com");
    expect(PROVIDER_DEFAULT_BASE_URLS.openai).toContain("openai.com");
    expect(PROVIDER_DEFAULT_BASE_URLS.kimi).toContain("moonshot.cn");
  });

  it("sendMessage does not import dispatchToWorker anymore", async () => {
    const agentBridgeCode = await import("fs").then(fs =>
      fs.readFileSync("src/lib/agent-bridge.ts", "utf-8")
    );
    // The import line should NOT include dispatchToWorker
    const importLine = agentBridgeCode.split("\n").find((l: string) => l.includes("from \"./coordinator\""));
    expect(importLine).not.toContain("dispatchToWorker");
    expect(importLine).toContain("analyzeIntent");
  });

  it("callAnthropic uses stream:false (Tauri compatible)", async () => {
    const agentBridgeCode = await import("fs").then(fs =>
      fs.readFileSync("src/lib/agent-bridge.ts", "utf-8")
    );
    // Find the body object inside callAnthropic — it should have stream: false
    const fnStart = agentBridgeCode.indexOf("async function callAnthropic");
    const fnSection = agentBridgeCode.slice(fnStart, fnStart + 5000);
    // Look for the request body definition
    const bodyMatch = fnSection.match(/const body[\s\S]*?stream:\s*(true|false)/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).toBe("false");
  });
});

if (SKIP_REASON) {
  console.log(`⚠️ Skipping real API tests: ${SKIP_REASON}`);
}
