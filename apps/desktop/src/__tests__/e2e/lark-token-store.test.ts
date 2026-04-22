/**
 * Lark Token Store tests — obfuscated persistence + expiry math
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveTenantToken,
  loadTenantToken,
  isTenantTokenValid,
  saveUserToken,
  loadUserToken,
  isUserTokenValid,
  isRefreshTokenValid,
  clearUserToken,
  saveUserInfo,
  loadUserInfo,
} from "../../lib/lark-token-store";

beforeEach(() => {
  localStorage.clear();
});

describe("lark-token-store: tenant token", () => {
  it("saves and loads a tenant token", () => {
    saveTenantToken("t_abc123", 7200);
    const loaded = loadTenantToken();
    expect(loaded).not.toBeNull();
    expect(loaded!.token).toBe("t_abc123");
  });

  it("isTenantTokenValid returns false when not stored", () => {
    expect(isTenantTokenValid()).toBe(false);
  });

  it("isTenantTokenValid returns true for a fresh token", () => {
    saveTenantToken("t_abc", 7200);
    expect(isTenantTokenValid()).toBe(true);
  });

  it("expiresAt accounts for 5-minute safety margin", () => {
    const before = Date.now();
    saveTenantToken("t_x", 3600); // 1 hour
    const loaded = loadTenantToken()!;
    const expected = before + 3600 * 1000 - 300_000;
    // Allow 2s slack
    expect(loaded.expiresAt).toBeGreaterThanOrEqual(expected - 2000);
    expect(loaded.expiresAt).toBeLessThanOrEqual(expected + 2000);
  });
});

describe("lark-token-store: user token", () => {
  it("saves and loads a user token with access + refresh", () => {
    saveUserToken("u_access", "u_refresh", 7200, 2592000);
    const loaded = loadUserToken();
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe("u_access");
    expect(loaded!.refreshToken).toBe("u_refresh");
  });

  it("isUserTokenValid returns false when none stored", () => {
    expect(isUserTokenValid()).toBe(false);
    expect(isRefreshTokenValid()).toBe(false);
  });

  it("isUserTokenValid returns true for fresh token", () => {
    saveUserToken("a", "r", 7200, 2592000);
    expect(isUserTokenValid()).toBe(true);
    expect(isRefreshTokenValid()).toBe(true);
  });

  it("clearUserToken removes both token + user info", () => {
    saveUserToken("a", "r", 7200, 2592000);
    saveUserInfo({ name: "Alice", email: "a@x", avatarUrl: "", userId: "u_1" });
    clearUserToken();
    expect(loadUserToken()).toBeNull();
    expect(loadUserInfo()).toBeNull();
  });

  it("access expiresAt < refresh expiresAt", () => {
    saveUserToken("a", "r", 7200, 2592000);
    const t = loadUserToken()!;
    expect(t.expiresAt).toBeLessThan(t.refreshExpiresAt);
  });
});

describe("lark-token-store: user info", () => {
  it("roundtrips user info", () => {
    const info = { name: "Alice Chen", email: "alice@x.com", avatarUrl: "https://x/a.png", userId: "u_123" };
    saveUserInfo(info);
    expect(loadUserInfo()).toEqual(info);
  });

  it("returns null when no user info is stored", () => {
    expect(loadUserInfo()).toBeNull();
  });
});

describe("lark-token-store: obfuscation", () => {
  it("stored data is obfuscated, not plain JSON", () => {
    saveTenantToken("my-secret-token", 7200);
    const raw = localStorage.getItem("__se_lark_tenant_token");
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("my-secret-token");
    expect(raw).not.toContain("{");
  });

  it("deobfuscates back to original", () => {
    saveTenantToken("my-secret-token", 7200);
    expect(loadTenantToken()!.token).toBe("my-secret-token");
  });
});
