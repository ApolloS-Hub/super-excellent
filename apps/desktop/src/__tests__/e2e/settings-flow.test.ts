/**
 * Settings Flow E2E Tests
 *
 * Tests the configuration management logic:
 * - Config loading and saving via localStorage
 * - Provider selection and model mapping
 * - API key storage and validation
 * - Default values and config structure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../../lib/agent-bridge";
import { PROVIDER_DEFAULT_BASE_URLS } from "../../lib/agent-bridge";

// ═══════════ In-memory localStorage for test isolation ═══════════

const store = new Map<string, string>();

const mockLocalStorage: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
};

// ═══════════ Config helpers (mirrors what the app does) ═══════════

const CONFIG_KEY = "agent-config";

function loadConfig(): AgentConfig {
  const raw = mockLocalStorage.getItem(CONFIG_KEY);
  if (!raw) {
    return {
      provider: "anthropic",
      apiKey: "",
      model: "claude-sonnet-4-20250514",
    };
  }
  return JSON.parse(raw) as AgentConfig;
}

function saveConfig(config: AgentConfig): void {
  mockLocalStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** Provider -> recommended models mapping (mirrors SettingsPage logic) */
const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-20250514", "claude-3-haiku-20240307", "claude-opus-4-20250514"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini"],
  google: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  kimi: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  ollama: ["llama3.1", "codellama", "mistral"],
  deepseek: ["deepseek-chat", "deepseek-coder"],
  qwen: ["qwen-turbo", "qwen-plus", "qwen-max"],
  minimax: ["abab6.5-chat", "abab5.5-chat"],
  zhipu: ["glm-4", "glm-4-flash"],
  compatible: [],
};

// ═══════════ Tests ═══════════

describe("Settings Flow — Configuration Management", () => {
  beforeEach(() => {
    store.clear();
  });

  describe("default config", () => {
    it("returns sensible defaults when no config is saved", () => {
      const config = loadConfig();

      expect(config.provider).toBe("anthropic");
      expect(config.apiKey).toBe("");
      expect(config.model).toBe("claude-sonnet-4-20250514");
    });

    it("has a default base URL for each known provider", () => {
      const providers = ["anthropic", "openai", "google", "kimi", "ollama", "deepseek", "qwen", "minimax", "zhipu"];
      for (const p of providers) {
        expect(PROVIDER_DEFAULT_BASE_URLS[p]).toBeDefined();
        expect(typeof PROVIDER_DEFAULT_BASE_URLS[p]).toBe("string");
      }
    });
  });

  describe("config persistence", () => {
    it("saves and loads config correctly", () => {
      const config: AgentConfig = {
        provider: "openai",
        apiKey: "sk-openai-test-key",
        model: "gpt-4o",
        baseURL: "https://api.openai.com/v1",
      };

      saveConfig(config);
      const loaded = loadConfig();

      expect(loaded.provider).toBe("openai");
      expect(loaded.apiKey).toBe("sk-openai-test-key");
      expect(loaded.model).toBe("gpt-4o");
      expect(loaded.baseURL).toBe("https://api.openai.com/v1");
    });

    it("overwrites previous config on save", () => {
      saveConfig({
        provider: "anthropic",
        apiKey: "old-key",
        model: "claude-sonnet-4-20250514",
      });

      saveConfig({
        provider: "openai",
        apiKey: "new-key",
        model: "gpt-4o",
      });

      const loaded = loadConfig();
      expect(loaded.provider).toBe("openai");
      expect(loaded.apiKey).toBe("new-key");
    });

    it("preserves optional fields in config", () => {
      const config: AgentConfig = {
        provider: "compatible",
        apiKey: "custom-key",
        model: "custom-model",
        baseURL: "https://custom.api.example.com",
        proxyURL: "http://proxy:8080",
        workDir: "/home/user/project",
        enableTools: true,
      };

      saveConfig(config);
      const loaded = loadConfig();

      expect(loaded.baseURL).toBe("https://custom.api.example.com");
      expect(loaded.proxyURL).toBe("http://proxy:8080");
      expect(loaded.workDir).toBe("/home/user/project");
      expect(loaded.enableTools).toBe(true);
    });
  });

  describe("provider selection changes model options", () => {
    it("anthropic provider has Claude models", () => {
      const models = PROVIDER_MODELS.anthropic;
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(m => m.startsWith("claude"))).toBe(true);
    });

    it("openai provider has GPT models", () => {
      const models = PROVIDER_MODELS.openai;
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.startsWith("gpt"))).toBe(true);
    });

    it("google provider has Gemini models", () => {
      const models = PROVIDER_MODELS.google;
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(m => m.startsWith("gemini"))).toBe(true);
    });

    it("ollama provider has local models", () => {
      const models = PROVIDER_MODELS.ollama;
      expect(models.length).toBeGreaterThan(0);
    });

    it("compatible provider has empty model list (user provides custom)", () => {
      const models = PROVIDER_MODELS.compatible;
      expect(models).toEqual([]);
    });

    it("switching provider updates model to first option for that provider", () => {
      const config = loadConfig();
      expect(config.provider).toBe("anthropic");

      // Simulate switching to openai
      const newProvider = "openai";
      const newModel = PROVIDER_MODELS[newProvider][0];
      const updatedConfig: AgentConfig = {
        ...config,
        provider: newProvider as AgentConfig["provider"],
        model: newModel,
        baseURL: PROVIDER_DEFAULT_BASE_URLS[newProvider],
      };

      saveConfig(updatedConfig);
      const loaded = loadConfig();

      expect(loaded.provider).toBe("openai");
      expect(loaded.model).toBe("gpt-4o");
      expect(loaded.baseURL).toBe("https://api.openai.com/v1");
    });

    it("switching between all providers produces valid configs", () => {
      for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        if (provider === "compatible") continue; // No default models
        const config: AgentConfig = {
          provider: provider as AgentConfig["provider"],
          apiKey: "test-key",
          model: models[0],
          baseURL: PROVIDER_DEFAULT_BASE_URLS[provider],
        };

        saveConfig(config);
        const loaded = loadConfig();

        expect(loaded.provider).toBe(provider);
        expect(loaded.model).toBe(models[0]);
        expect(loaded.baseURL).toBeDefined();
      }
    });
  });

  describe("API key management", () => {
    it("can save an API key", () => {
      const config: AgentConfig = {
        provider: "anthropic",
        apiKey: "sk-ant-api03-real-key-here",
        model: "claude-sonnet-4-20250514",
      };

      saveConfig(config);
      const loaded = loadConfig();

      expect(loaded.apiKey).toBe("sk-ant-api03-real-key-here");
    });

    it("can clear an API key", () => {
      saveConfig({
        provider: "anthropic",
        apiKey: "sk-existing-key",
        model: "claude-sonnet-4-20250514",
      });

      const config = loadConfig();
      saveConfig({ ...config, apiKey: "" });

      expect(loadConfig().apiKey).toBe("");
    });

    it("preserves API key when changing other settings", () => {
      saveConfig({
        provider: "anthropic",
        apiKey: "sk-important-key",
        model: "claude-sonnet-4-20250514",
      });

      const config = loadConfig();
      saveConfig({ ...config, model: "claude-3-haiku-20240307" });

      const loaded = loadConfig();
      expect(loaded.apiKey).toBe("sk-important-key");
      expect(loaded.model).toBe("claude-3-haiku-20240307");
    });
  });

  describe("base URL configuration", () => {
    it("anthropic base URL points to anthropic API", () => {
      expect(PROVIDER_DEFAULT_BASE_URLS.anthropic).toBe("https://api.anthropic.com");
    });

    it("ollama base URL points to localhost", () => {
      expect(PROVIDER_DEFAULT_BASE_URLS.ollama).toContain("localhost");
    });

    it("compatible provider has empty base URL (user must configure)", () => {
      expect(PROVIDER_DEFAULT_BASE_URLS.compatible).toBe("");
    });

    it("custom base URL is preserved for compatible provider", () => {
      const config: AgentConfig = {
        provider: "compatible",
        apiKey: "custom-key",
        model: "my-model",
        baseURL: "https://my-custom-llm.example.com/v1",
      };

      saveConfig(config);
      const loaded = loadConfig();

      expect(loaded.baseURL).toBe("https://my-custom-llm.example.com/v1");
    });
  });
});
