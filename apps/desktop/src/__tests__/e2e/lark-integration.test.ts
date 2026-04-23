/**
 * Lark Integration tests — tool-registration + scope gating
 *
 * The lark-integration.ts module wraps lark-client as Agent tools.
 * IM is tenant-scope (always available when configured); calendar /
 * doc / task / approval / sheet / email are user-scope (require OAuth).
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as lark from "../../lib/lark-integration";

beforeEach(() => {
  localStorage.clear();
  // Reset in-memory config state (module-level cache)
  lark.setLarkConfig({ appId: "", appSecret: "" });
});

describe("lark-integration: config shim", () => {
  it("setLarkConfig / getLarkConfig roundtrip", () => {
    lark.setLarkConfig({ appId: "cli_abc", appSecret: "sec_xyz" });
    const cfg = lark.getLarkConfig();
    expect(cfg.appId).toBe("cli_abc");
    expect(cfg.appSecret).toBe("sec_xyz");
  });

  it("setLarkConfig preserves fields not in the partial", () => {
    lark.setLarkConfig({ appId: "a", appSecret: "s" });
    lark.setLarkConfig({ appId: "new_a" });
    const cfg = lark.getLarkConfig();
    expect(cfg.appId).toBe("new_a");
    expect(cfg.appSecret).toBe("s");
  });

  it("isLarkConfigured reflects both fields being set", () => {
    expect(lark.isLarkConfigured()).toBe(false);
    lark.setLarkConfig({ appId: "", appSecret: "" });
    expect(lark.isLarkConfigured()).toBe(false);
    lark.setLarkConfig({ appId: "a", appSecret: "s" });
    expect(lark.isLarkConfigured()).toBe(true);
  });

  it("loadLarkConfig returns a fresh snapshot", () => {
    lark.setLarkConfig({ appId: "x", appSecret: "y" });
    const loaded = lark.loadLarkConfig();
    expect(loaded.appId).toBe("x");
    expect(loaded.appSecret).toBe("y");
  });
});

describe("lark-integration: access state", () => {
  it("hasTenantAccess is false before any config + token", () => {
    expect(lark.hasTenantAccess()).toBe(false);
  });

  it("hasUserAccess is false when no user OAuth token exists", () => {
    expect(lark.hasUserAccess()).toBe(false);
  });

  it("isUserTokenValid reflects hasUserAccess", () => {
    expect(lark.isUserTokenValid()).toBe(lark.hasUserAccess());
  });

  it("loadUserInfo returns null when disconnected", () => {
    expect(lark.loadUserInfo()).toBeNull();
  });

  it("disconnectUser clears user state", () => {
    lark.disconnectUser();
    expect(lark.hasUserAccess()).toBe(false);
    expect(lark.loadUserInfo()).toBeNull();
  });
});

describe("lark-integration: getUserToolNames", () => {
  it("returns all user-scope tool names (6 tools: calendar, doc, task, approval, sheet, email)", () => {
    const names = lark.getUserToolNames();
    expect(names).toContain("lark_calendar");
    expect(names).toContain("lark_doc");
    expect(names).toContain("lark_task");
    expect(names).toContain("lark_approval");
    expect(names).toContain("lark_sheet");
    expect(names).toContain("lark_email");
  });

  it("does NOT include lark_im (that is tenant-scope, always available)", () => {
    expect(lark.getUserToolNames()).not.toContain("lark_im");
  });

  it("returns exactly 6 user-scope tools", () => {
    expect(lark.getUserToolNames().length).toBe(6);
  });
});

describe("lark-integration: tool registration gating", () => {
  it("registerLarkTools registers at least lark_im (tenant-scope, no user token needed)", async () => {
    const { getTool } = await import("../../lib/tool-registry");
    lark.registerLarkTools();
    expect(getTool("lark_im")).toBeDefined();
  });

  it("without user token, user-scope tools are NOT registered after refresh", async () => {
    const { getTool } = await import("../../lib/tool-registry");
    lark.registerLarkTools();
    lark.refreshUserToolRegistration();
    // No user token present, so calendar should NOT be registered
    expect(getTool("lark_calendar")).toBeUndefined();
    expect(getTool("lark_doc")).toBeUndefined();
  });

  it("lark_im tool execute returns 'not configured' when appId+secret are empty", async () => {
    const { getTool } = await import("../../lib/tool-registry");
    lark.setLarkConfig({ appId: "", appSecret: "" });
    lark.registerLarkTools();
    const imTool = getTool("lark_im");
    expect(imTool).toBeDefined();
    const result = await imTool!.execute!({ action: "list_chats" });
    expect(result).toMatch(/not configured/i);
  });
});

describe("lark-integration: re-exported OAuth utilities", () => {
  it("buildOAuthUrl is exported and builds a valid Lark URL", () => {
    const url = lark.buildOAuthUrl("cli_test", "", "state_xyz");
    expect(url).toContain("accounts.larksuite.com/open-apis/authen/v1/authorize");
    expect(url).toContain("app_id=cli_test");
    expect(url).toContain("state=state_xyz");
  });

  it("buildOAuthUrl does NOT include the invalid mail:mail scope", () => {
    const url = lark.buildOAuthUrl("x", "", "s");
    expect(url).not.toContain("mail%3Amail");
  });
});
