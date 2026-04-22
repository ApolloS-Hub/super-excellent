/**
 * Lark Client tests — OAuth URL building + config CRUD + connection test flow
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  buildOAuthUrl,
  setLarkAppConfig,
  loadLarkAppConfig,
  isLarkConfigured,
  hasTenantAccess,
  hasUserAccess,
  LarkApiError,
  disconnectUser,
  testConnection,
  exchangeOAuthCode,
} from "../../lib/lark-client";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("lark-client: buildOAuthUrl", () => {
  it("uses the accounts.larksuite.com domain", () => {
    const url = buildOAuthUrl("cli_test123", "", "state_abc");
    expect(url).toContain("https://accounts.larksuite.com/open-apis/authen/v1/authorize");
  });

  it("percent-encodes the redirect URI to Lark's display page", () => {
    const url = buildOAuthUrl("cli_test123", "", "s");
    expect(url).toContain(encodeURIComponent("https://open.larksuite.com/open-apis/authen/v1/index"));
  });

  it("includes the app_id", () => {
    const url = buildOAuthUrl("cli_xyz", "", "s");
    expect(url).toContain("app_id=cli_xyz");
  });

  it("includes only known-good scopes (contact + im)", () => {
    const url = buildOAuthUrl("cli_x", "", "s");
    expect(url).toContain("contact");
    expect(url).toContain("im");
  });

  it("does NOT include the invalid mail scope", () => {
    const url = buildOAuthUrl("cli_x", "", "s");
    expect(url).not.toContain("mail%3Amail");
    expect(url).not.toContain("mail:mail");
  });

  it("includes the state parameter", () => {
    const url = buildOAuthUrl("cli_x", "", "my_state_xyz");
    expect(url).toContain("state=my_state_xyz");
  });
});

describe("lark-client: config", () => {
  it("setLarkAppConfig persists to localStorage", () => {
    setLarkAppConfig({ appId: "cli_abc", appSecret: "secret_xyz" });
    const loaded = loadLarkAppConfig();
    expect(loaded.appId).toBe("cli_abc");
    expect(loaded.appSecret).toBe("secret_xyz");
  });

  it("isLarkConfigured reflects presence of both fields", () => {
    setLarkAppConfig({ appId: "", appSecret: "" });
    expect(isLarkConfigured()).toBe(false);
    setLarkAppConfig({ appId: "cli_x", appSecret: "" });
    expect(isLarkConfigured()).toBe(false);
    setLarkAppConfig({ appId: "cli_x", appSecret: "s" });
    expect(isLarkConfigured()).toBe(true);
  });
});

describe("lark-client: token-gated helpers", () => {
  it("hasTenantAccess false when no config", () => {
    setLarkAppConfig({ appId: "", appSecret: "" });
    expect(hasTenantAccess()).toBe(false);
  });

  it("hasUserAccess false when no user token", () => {
    expect(hasUserAccess()).toBe(false);
  });

  it("disconnectUser clears user access", () => {
    disconnectUser();
    expect(hasUserAccess()).toBe(false);
  });
});

describe("lark-client: LarkApiError", () => {
  it("carries code, msg, and httpStatus", () => {
    const err = new LarkApiError(99991400, "bad request", 400);
    expect(err.code).toBe(99991400);
    expect(err.message).toBe("bad request");
    expect(err.httpStatus).toBe(400);
    expect(err.name).toBe("LarkApiError");
  });

  it("is an instance of Error", () => {
    const err = new LarkApiError(0, "x");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("lark-client: testConnection", () => {
  it("reports tenantOk=true on a valid token response", async () => {
    setLarkAppConfig({ appId: "cli_x", appSecret: "s" });
    (tauriFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ code: 0, msg: "ok", tenant_access_token: "t_xyz", expire: 7200 }),
    });
    const result = await testConnection();
    expect(result.tenantOk).toBe(true);
    expect(result.tenantError).toBeUndefined();
  });

  it("reports tenantOk=false and captures error on invalid creds", async () => {
    setLarkAppConfig({ appId: "cli_x", appSecret: "wrong" });
    (tauriFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 400,
      json: async () => ({ code: 99991003, msg: "invalid app secret" }),
    });
    const result = await testConnection();
    expect(result.tenantOk).toBe(false);
    expect(result.tenantError).toContain("invalid app secret");
  });

  it("userOk reflects absence of user token", async () => {
    setLarkAppConfig({ appId: "cli_x", appSecret: "s" });
    (tauriFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ code: 0, msg: "ok", tenant_access_token: "t", expire: 7200 }),
    });
    const result = await testConnection();
    expect(result.userOk).toBe(false);
  });
});

describe("lark-client: exchangeOAuthCode", () => {
  it("throws LarkApiError when code is invalid", async () => {
    setLarkAppConfig({ appId: "cli_x", appSecret: "s" });
    // First call: get tenant token
    (tauriFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ code: 0, msg: "ok", tenant_access_token: "t", expire: 7200 }),
    });
    // Second call: exchange code -> error
    (tauriFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 400,
      json: async () => ({ code: 99991670, msg: "invalid code" }),
    });
    await expect(exchangeOAuthCode("bad_code")).rejects.toThrow(LarkApiError);
  });
});
