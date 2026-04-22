/**
 * Lark Token Store — persist tenant/user OAuth tokens.
 * Uses the same XOR-obfuscation pattern as secure-store.ts.
 */

const KEY_PREFIX = "__se_lark_";
const OBF_KEY = "SuperExcellent2024";

function obfuscate(v: string): string {
  const b = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) b[i] = v.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length);
  return btoa(String.fromCharCode(...b));
}

function deobfuscate(e: string): string {
  const d = atob(e);
  const r: string[] = [];
  for (let i = 0; i < d.length; i++) r.push(String.fromCharCode(d.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length)));
  return r.join("");
}

function save(key: string, data: unknown): void {
  try { localStorage.setItem(KEY_PREFIX + key, obfuscate(JSON.stringify(data))); } catch { /* quota */ }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    return raw ? JSON.parse(deobfuscate(raw)) as T : null;
  } catch { return null; }
}

function remove(key: string): void {
  localStorage.removeItem(KEY_PREFIX + key);
}

// ── Tenant token (app credentials → 2h lifetime) ──

export interface TenantToken {
  token: string;
  expiresAt: number; // epoch ms
}

export function saveTenantToken(token: string, expiresInSec: number): void {
  save("tenant_token", { token, expiresAt: Date.now() + expiresInSec * 1000 - 300_000 } satisfies TenantToken);
}

export function loadTenantToken(): TenantToken | null {
  return load<TenantToken>("tenant_token");
}

export function isTenantTokenValid(): boolean {
  const t = loadTenantToken();
  return !!t && t.expiresAt > Date.now();
}

// ── User token (OAuth → access 2h, refresh 30d) ──

export interface UserToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;       // epoch ms — access token
  refreshExpiresAt: number; // epoch ms — refresh token
}

export function saveUserToken(access: string, refresh: string, accessExpSec: number, refreshExpSec: number): void {
  const now = Date.now();
  save("user_token", {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: now + accessExpSec * 1000 - 300_000,
    refreshExpiresAt: now + refreshExpSec * 1000 - 3600_000,
  } satisfies UserToken);
}

export function loadUserToken(): UserToken | null {
  return load<UserToken>("user_token");
}

export function isUserTokenValid(): boolean {
  const t = loadUserToken();
  return !!t && t.expiresAt > Date.now();
}

export function isRefreshTokenValid(): boolean {
  const t = loadUserToken();
  return !!t && t.refreshExpiresAt > Date.now();
}

export function clearUserToken(): void {
  remove("user_token");
  remove("user_info");
}

// ── User info (display in settings) ──

export interface LarkUserInfo {
  name: string;
  email: string;
  avatarUrl: string;
  userId: string;
}

export function saveUserInfo(info: LarkUserInfo): void {
  save("user_info", info);
}

export function loadUserInfo(): LarkUserInfo | null {
  return load<LarkUserInfo>("user_info");
}
