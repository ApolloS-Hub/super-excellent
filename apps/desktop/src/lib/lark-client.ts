/**
 * LarkClient — direct HTTP client for Lark Open API.
 * Replaces the previous lark-cli shell delegation.
 * All requests go to open.larksuite.com (international).
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  saveTenantToken, loadTenantToken, isTenantTokenValid,
  saveUserToken, loadUserToken, isUserTokenValid, isRefreshTokenValid,
  saveUserInfo, clearUserToken,
  type LarkUserInfo,
} from "./lark-token-store";

const BASE = "https://open.larksuite.com";

// ── Error ──

export class LarkApiError extends Error {
  constructor(public code: number, msg: string, public httpStatus?: number) {
    super(msg);
    this.name = "LarkApiError";
  }
}

// ── Config ──

export interface LarkAppConfig {
  appId: string;
  appSecret: string;
}

let _cfg: LarkAppConfig = { appId: "", appSecret: "" };

export function setLarkAppConfig(c: LarkAppConfig): void {
  _cfg = { ...c };
  try { localStorage.setItem("lark-config", JSON.stringify(c)); } catch {}
}

export function loadLarkAppConfig(): LarkAppConfig {
  try {
    const raw = localStorage.getItem("lark-config");
    if (raw) {
      const parsed = JSON.parse(raw);
      _cfg = { appId: parsed.appId || "", appSecret: parsed.appSecret || "" };
    }
  } catch {}
  return { ..._cfg };
}

export function isLarkConfigured(): boolean {
  return !!_cfg.appId && !!_cfg.appSecret;
}

// ── Token management ──

let _tenantRefreshPromise: Promise<string> | null = null;
let _userRefreshPromise: Promise<string> | null = null;

async function fetchTenantToken(): Promise<string> {
  const res = await tauriFetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: _cfg.appId, app_secret: _cfg.appSecret }),
  });
  const data = await res.json() as { code: number; msg: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new LarkApiError(data.code, data.msg || "Failed to get tenant token", res.status);
  }
  saveTenantToken(data.tenant_access_token, data.expire ?? 7200);
  return data.tenant_access_token;
}

async function ensureTenantToken(): Promise<string> {
  if (isTenantTokenValid()) return loadTenantToken()!.token;
  if (_tenantRefreshPromise) return _tenantRefreshPromise;
  _tenantRefreshPromise = fetchTenantToken().finally(() => { _tenantRefreshPromise = null; });
  return _tenantRefreshPromise;
}

async function refreshUserToken(): Promise<string> {
  const stored = loadUserToken();
  if (!stored || !isRefreshTokenValid()) throw new LarkApiError(0, "User OAuth session expired — please re-authorize in Settings > Lark.");
  const tenantToken = await ensureTenantToken();
  const res = await tauriFetch(`${BASE}/open-apis/authen/v1/oidc/refresh_access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${tenantToken}`,
    },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: stored.refreshToken }),
  });
  const data = await res.json() as {
    code: number; msg: string;
    data?: { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number };
  };
  if (data.code !== 0 || !data.data) throw new LarkApiError(data.code, data.msg || "Failed to refresh user token", res.status);
  const d = data.data;
  saveUserToken(d.access_token, d.refresh_token, d.expires_in, d.refresh_expires_in);
  return d.access_token;
}

async function ensureUserToken(): Promise<string> {
  if (isUserTokenValid()) return loadUserToken()!.accessToken;
  if (_userRefreshPromise) return _userRefreshPromise;
  _userRefreshPromise = refreshUserToken().finally(() => { _userRefreshPromise = null; });
  return _userRefreshPromise;
}

// ── Generic request ──

type TokenType = "tenant" | "user";

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  tokenType: TokenType = "tenant",
  query?: Record<string, string>,
): Promise<T> {
  const token = tokenType === "user" ? await ensureUserToken() : await ensureTenantToken();
  let url = `${BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  };
  const init: RequestInit = { method, headers };
  if (body && method !== "GET") init.body = JSON.stringify(body);

  const res = await tauriFetch(url, init);
  const json = await res.json() as { code: number; msg: string; data?: T };

  // Token expired — retry once
  if (json.code === 99991668 || json.code === 99991672 || json.code === 99991663) {
    if (tokenType === "user") {
      const newToken = await refreshUserToken();
      headers.Authorization = `Bearer ${newToken}`;
    } else {
      const newToken = await fetchTenantToken();
      headers.Authorization = `Bearer ${newToken}`;
    }
    const retry = await tauriFetch(url, { method, headers, body: init.body as string | undefined });
    const retryJson = await retry.json() as { code: number; msg: string; data?: T };
    if (retryJson.code !== 0) throw new LarkApiError(retryJson.code, retryJson.msg, retry.status);
    return retryJson.data as T;
  }

  if (json.code !== 0) throw new LarkApiError(json.code, json.msg, res.status);
  return json.data as T;
}

// ── Public: connection test ──

export async function testConnection(): Promise<{ tenantOk: boolean; userOk: boolean; tenantError?: string; userError?: string; userName?: string }> {
  const result: { tenantOk: boolean; userOk: boolean; tenantError?: string; userError?: string; userName?: string } = {
    tenantOk: false, userOk: false,
  };
  try {
    await fetchTenantToken();
    result.tenantOk = true;
  } catch (e) {
    result.tenantError = e instanceof Error ? e.message : String(e);
  }
  try {
    if (isRefreshTokenValid() || isUserTokenValid()) {
      const info = await fetchUserInfo();
      result.userOk = true;
      result.userName = info.name;
    }
  } catch (e) {
    result.userError = e instanceof Error ? e.message : String(e);
  }
  return result;
}

// ── Public: OAuth code exchange ──

export function buildOAuthUrl(appId: string, _redirectUri: string, state: string): string {
  const redirectUri = "https://open.larksuite.com/open-apis/authen/v1/index";
  const scopes = [
    "contact:user.base:readonly",
    "im:message",
    "docx:document",
    "drive:drive",
  ].join(" ");
  return `https://accounts.larksuite.com/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scopes)}`;
}

export async function exchangeOAuthCode(code: string): Promise<LarkUserInfo> {
  const tenantToken = await ensureTenantToken();
  const res = await tauriFetch(`${BASE}/open-apis/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${tenantToken}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const data = await res.json() as {
    code: number; msg: string;
    data?: { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number };
  };
  if (data.code !== 0 || !data.data) throw new LarkApiError(data.code, data.msg || "OAuth code exchange failed", res.status);
  const d = data.data;
  saveUserToken(d.access_token, d.refresh_token, d.expires_in, d.refresh_expires_in);
  return fetchUserInfo();
}

async function fetchUserInfo(): Promise<LarkUserInfo> {
  const token = await ensureUserToken();
  const res = await tauriFetch(`${BASE}/open-apis/authen/v1/user_info`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as {
    code: number; msg: string;
    data?: { name?: string; en_name?: string; email?: string; avatar_url?: string; user_id?: string; open_id?: string };
  };
  if (data.code !== 0 || !data.data) throw new LarkApiError(data.code, data.msg || "Failed to fetch user info", res.status);
  const u = data.data;
  const info: LarkUserInfo = {
    name: u.name || u.en_name || "Lark User",
    email: u.email || "",
    avatarUrl: u.avatar_url || "",
    userId: u.open_id || u.user_id || "",
  };
  saveUserInfo(info);
  return info;
}

export function disconnectUser(): void {
  clearUserToken();
}

// ── Public: token status ──

export function hasTenantAccess(): boolean { return isLarkConfigured() && isTenantTokenValid(); }
export function hasUserAccess(): boolean { return isUserTokenValid(); }
export { isRefreshTokenValid, loadUserInfo } from "./lark-token-store";

// ── Public: API methods ──

// Calendar (user token)
export async function calendarListEvents(calendarId?: string, startTime?: string, endTime?: string): Promise<unknown> {
  const cid = calendarId || "primary";
  const query: Record<string, string> = { page_size: "50" };
  if (startTime) query.start_time = startTime;
  if (endTime) query.end_time = endTime;
  return request("GET", `/open-apis/calendar/v4/calendars/${cid}/events`, undefined, "user", query);
}

export async function calendarCreateEvent(summary: string, startTime: string, endTime: string, attendees?: string[]): Promise<unknown> {
  const body: Record<string, unknown> = {
    summary,
    start_time: { timestamp: startTime },
    end_time: { timestamp: endTime },
  };
  if (attendees?.length) body.attendees = attendees.map(email => ({ type: "user", user_id: email }));
  return request("POST", "/open-apis/calendar/v4/calendars/primary/events", body, "user");
}

export async function calendarFreeBusy(userIds: string[], startTime: string, endTime: string): Promise<unknown> {
  return request("POST", "/open-apis/calendar/v4/freebusy/list", {
    time_min: startTime,
    time_max: endTime,
    user_id: { user_ids: userIds },
  }, "user");
}

// IM (tenant token — bot scope)
export async function imSendMessage(chatId: string, text: string): Promise<unknown> {
  return request("POST", "/open-apis/im/v1/messages", {
    receive_id_type: "chat_id",
    receive_id: chatId,
    msg_type: "text",
    content: JSON.stringify({ text }),
  }, "tenant", { receive_id_type: "chat_id" });
}

export async function imListMessages(chatId: string, pageSize = 20): Promise<unknown> {
  return request("GET", `/open-apis/im/v1/messages`, undefined, "tenant", {
    container_id_type: "chat",
    container_id: chatId,
    page_size: String(pageSize),
    sort_type: "ByCreateTimeDesc",
  });
}

export async function imListChats(): Promise<unknown> {
  return request("GET", "/open-apis/im/v1/chats", undefined, "tenant", { page_size: "50" });
}

export async function imSearchMessages(query: string, chatId?: string): Promise<unknown> {
  const q: Record<string, string> = { query, page_size: "20" };
  if (chatId) q.chat_id = chatId;
  return request("POST", "/open-apis/im/v1/messages/search", q, "tenant");
}

// Drive / Docs (user token)
export async function driveSearch(query: string): Promise<unknown> {
  return request("POST", "/open-apis/suite/docs-api/search/object", { search_key: query, count: 20, offset: 0 }, "user");
}

export async function driveGetDoc(docToken: string): Promise<unknown> {
  return request("GET", `/open-apis/docx/v1/documents/${docToken}`, undefined, "user");
}

export async function driveGetDocContent(docToken: string): Promise<unknown> {
  return request("GET", `/open-apis/docx/v1/documents/${docToken}/raw_content`, undefined, "user");
}

export async function driveListBlocks(docToken: string, pageSize = 50): Promise<unknown> {
  return request("GET", `/open-apis/docx/v1/documents/${docToken}/blocks`, undefined, "user", {
    page_size: String(pageSize),
  });
}

export async function driveGetBlock(docToken: string, blockId: string): Promise<unknown> {
  return request("GET", `/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}`, undefined, "user");
}

export async function driveCreateDoc(title: string, folderToken?: string): Promise<unknown> {
  const body: Record<string, unknown> = { title };
  if (folderToken) body.folder_token = folderToken;
  return request("POST", "/open-apis/docx/v1/documents", body, "user");
}

export async function driveCreateBlock(
  docToken: string,
  parentBlockId: string,
  children: unknown[],
  index?: number,
): Promise<unknown> {
  const body: Record<string, unknown> = { children };
  if (index !== undefined) body.index = index;
  return request("POST", `/open-apis/docx/v1/documents/${docToken}/blocks/${parentBlockId}/children`, body, "user");
}

export async function driveUpdateBlock(
  docToken: string,
  blockId: string,
  updateBody: unknown,
): Promise<unknown> {
  return request("PATCH", `/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}`, updateBody, "user");
}

export async function driveDeleteBlock(docToken: string, blockId: string): Promise<unknown> {
  return request("DELETE", `/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}`, undefined, "user");
}

/**
 * High-level helper: replace all body content of a document with new text.
 * Creates paragraph blocks from markdown-like text (split by double newline).
 * Steps: 1) list existing blocks, 2) delete non-page blocks, 3) create new blocks.
 */
export async function driveReplaceDocContent(docToken: string, content: string): Promise<unknown> {
  // Step 1: Get document info to find the page block (root)
  const docInfo = await driveGetDoc(docToken) as { document?: { document_id: string } };
  const pageBlockId = docInfo?.document?.document_id || docToken;

  // Step 2: List all blocks
  const blockData = await driveListBlocks(docToken) as { items?: Array<{ block_id: string; block_type: number; parent_id: string }> };
  const blocks = blockData?.items || [];

  // Step 3: Delete existing child blocks (skip the page block itself, block_type=1)
  for (const block of blocks) {
    if (block.block_type !== 1 && block.parent_id === pageBlockId) {
      try { await driveDeleteBlock(docToken, block.block_id); } catch { /* skip if already gone */ }
    }
  }

  // Step 4: Create new paragraph blocks from content
  const paragraphs = content.split(/\n{2,}/).filter(p => p.trim());
  const children = paragraphs.map(p => ({
    block_type: 2, // paragraph
    paragraph: {
      elements: [{
        text_run: {
          content: p.trim(),
        },
      }],
    },
  }));

  if (children.length > 0) {
    return driveCreateBlock(docToken, pageBlockId, children);
  }
  return { success: true, message: "Document cleared (no content to add)" };
}

// Tasks (user token)
export async function taskList(): Promise<unknown> {
  return request("GET", "/open-apis/task/v2/tasks", undefined, "user", { page_size: "50" });
}

export async function taskCreate(summary: string, due?: string): Promise<unknown> {
  const body: Record<string, unknown> = { summary };
  if (due) body.due = { timestamp: due, is_all_day: false };
  return request("POST", "/open-apis/task/v2/tasks", body, "user");
}

export async function taskComplete(taskId: string): Promise<unknown> {
  return request("PATCH", `/open-apis/task/v2/tasks/${taskId}`, { completed_at: String(Math.floor(Date.now() / 1000)) }, "user");
}

// Approval (user token)
export async function approvalList(approvalCode?: string): Promise<unknown> {
  const q: Record<string, string> = { page_size: "20" };
  if (approvalCode) q.approval_code = approvalCode;
  return request("GET", "/open-apis/approval/v4/instances", undefined, "user", q);
}

export async function approvalApprove(instanceId: string, comment?: string): Promise<unknown> {
  return request("POST", `/open-apis/approval/v4/instances/${instanceId}/approve`, { comment: comment || "" }, "user");
}

export async function approvalReject(instanceId: string, comment?: string): Promise<unknown> {
  return request("POST", `/open-apis/approval/v4/instances/${instanceId}/reject`, { comment: comment || "" }, "user");
}

// Sheets (user token)
export async function sheetRead(spreadsheetToken: string, range?: string): Promise<unknown> {
  const r = range ? `/${encodeURIComponent(range)}` : "";
  return request("GET", `/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query${r}`, undefined, "user");
}

export async function sheetWrite(spreadsheetToken: string, range: string, values: unknown[][]): Promise<unknown> {
  return request("PUT", `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`, {
    valueRange: { range, values },
  }, "user");
}

export async function sheetCreate(title: string): Promise<unknown> {
  return request("POST", "/open-apis/sheets/v3/spreadsheets", { title }, "user");
}

// Mail (user token)
export async function mailList(folder = "INBOX", limit = 20): Promise<unknown> {
  return request("GET", "/open-apis/mail/v1/mailboxes/me/messages", undefined, "user", {
    folder_id: folder, page_size: String(limit),
  });
}

export async function mailRead(messageId: string): Promise<unknown> {
  return request("GET", `/open-apis/mail/v1/mailboxes/me/messages/${messageId}`, undefined, "user");
}

export async function mailSend(to: string[], subject: string, body: string, cc?: string[]): Promise<unknown> {
  return request("POST", "/open-apis/mail/v1/mailboxes/me/messages/send", {
    to: to.map(email => ({ mail_address: email })),
    cc: cc?.map(email => ({ mail_address: email })),
    subject,
    body: { content: body },
  }, "user");
}

export async function mailSearch(query: string): Promise<unknown> {
  return request("POST", "/open-apis/mail/v1/mailboxes/me/messages/search", { query, page_size: 20 }, "user");
}
