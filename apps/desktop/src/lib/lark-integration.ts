/**
 * Lark Integration — direct HTTP via open.larksuite.com
 *
 * Two-tier auth: tenant_access_token (bot/app scope) + user_access_token
 * (personal calendar/docs/tasks). User-scope tools are only registered
 * when a valid user OAuth token exists.
 */
import { registerTool, unregisterTool, type ToolDefinition } from "./tool-registry";
import * as lark from "./lark-client";

// ═══════════ Config (compat shim for SettingsPage) ═══════════

export interface LarkConfig {
  appId: string;
  appSecret: string;
}

export function getLarkConfig(): LarkConfig {
  return lark.loadLarkAppConfig();
}

export function setLarkConfig(cfg: Partial<LarkConfig>): void {
  const prev = lark.loadLarkAppConfig();
  lark.setLarkAppConfig({ appId: cfg.appId ?? prev.appId, appSecret: cfg.appSecret ?? prev.appSecret });
}

export function loadLarkConfig(): LarkConfig {
  return lark.loadLarkAppConfig();
}

export function isLarkConfigured(): boolean {
  return lark.isLarkConfigured();
}

// Re-export client functions for Settings UI
export { testConnection, buildOAuthUrl, exchangeOAuthCode, disconnectUser, hasUserAccess, hasTenantAccess } from "./lark-client";
export { loadUserInfo, isRefreshTokenValid, clearUserToken, isUserTokenValid } from "./lark-token-store";

// ═══════════ Tool Definitions ═══════════

const NOT_CONFIGURED = "Lark not configured. Please set App ID and App Secret in Settings > Lark.\n\n💡 You can still do this manually in Lark — open the Lark app and perform the action there, then tell me the result.";
const NEEDS_OAUTH = "This feature requires personal authorization. Connect your Lark account in Settings > Lark > 'Connect Lark Account'.\n\n💡 In the meantime, you can open Lark manually to access your calendar/docs/tasks, and tell me what you find.";

function checkTenant(): string | null {
  if (!lark.isLarkConfigured()) return NOT_CONFIGURED;
  return null;
}

function checkUser(): string | null {
  const t = checkTenant();
  if (t) return t;
  if (!lark.hasUserAccess()) return NEEDS_OAUTH;
  return null;
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ── IM (tenant token — bot scope, always available) ──

const larkImTool: ToolDefinition = {
  name: "lark_im",
  description: "Lark Messenger — send messages, list chats, search chat history",
  searchHint: "message chat send im lark",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["send", "search", "list_chats"], description: "send=send message, search=search messages, list_chats=list chats" },
      chat_id: { type: "string", description: "send/search: chat ID (oc_xxx)" },
      text: { type: "string", description: "send: message text" },
      query: { type: "string", description: "search: search keyword" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkTenant();
    if (err) return err;
    switch (String(args.action)) {
      case "send":
        if (!args.chat_id || !args.text) return "send requires chat_id and text";
        return json(await lark.imSendMessage(String(args.chat_id), String(args.text)));
      case "search":
        if (!args.query) return "search requires query";
        return json(await lark.imSearchMessages(String(args.query), args.chat_id ? String(args.chat_id) : undefined));
      case "list_chats":
        return json(await lark.imListChats());
      default:
        return `Unknown action: ${args.action}. Available: send, search, list_chats`;
    }
  },
};

// ── Calendar (user token) ──

const larkCalendarTool: ToolDefinition = {
  name: "lark_calendar",
  description: "Lark Calendar — view events, create meetings, check free/busy (requires personal authorization)",
  searchHint: "calendar agenda meeting schedule lark",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "freebusy"], description: "list=upcoming events, create=new event, freebusy=check availability" },
      calendar_id: { type: "string", description: "list: calendar ID (default: primary)" },
      start_time: { type: "string", description: "ISO 8601 or Unix timestamp" },
      end_time: { type: "string", description: "ISO 8601 or Unix timestamp" },
      summary: { type: "string", description: "create: event title" },
      attendees: { type: "string", description: "create: comma-separated emails" },
      user_ids: { type: "string", description: "freebusy: comma-separated open_ids" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkUser();
    if (err) return err;
    switch (String(args.action)) {
      case "list":
        return json(await lark.calendarListEvents(
          args.calendar_id ? String(args.calendar_id) : undefined,
          args.start_time ? String(args.start_time) : undefined,
          args.end_time ? String(args.end_time) : undefined,
        ));
      case "create":
        if (!args.summary || !args.start_time || !args.end_time) return "create requires summary, start_time, end_time";
        return json(await lark.calendarCreateEvent(
          String(args.summary), String(args.start_time), String(args.end_time),
          args.attendees ? String(args.attendees).split(",").map(s => s.trim()) : undefined,
        ));
      case "freebusy":
        if (!args.user_ids || !args.start_time || !args.end_time) return "freebusy requires user_ids, start_time, end_time";
        return json(await lark.calendarFreeBusy(
          String(args.user_ids).split(",").map(s => s.trim()),
          String(args.start_time), String(args.end_time),
        ));
      default:
        return `Unknown action: ${args.action}. Available: list, create, freebusy`;
    }
  },
};

// ── Drive / Docs (user token) ──

const larkDocTool: ToolDefinition = {
  name: "lark_doc",
  description: "Lark Docs — search, read, create, update, and manage documents (requires personal authorization). Supports block-level editing for precise updates.",
  searchHint: "document doc create read search update write edit lark",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["search", "read", "read_content", "create", "update", "list_blocks", "append", "delete_block"],
        description: "search=find docs, read=doc metadata, read_content=full text, create=new doc, update=replace entire content, list_blocks=show doc structure, append=add content at end, delete_block=remove a block",
      },
      query: { type: "string", description: "search: keyword" },
      doc_token: { type: "string", description: "read/read_content/update/list_blocks/append/delete_block: document token (from search results or doc URL)" },
      title: { type: "string", description: "create: document title" },
      folder_token: { type: "string", description: "create: target folder token (optional)" },
      content: { type: "string", description: "update/append: the text content (paragraphs separated by double newlines)" },
      block_id: { type: "string", description: "delete_block: specific block ID to remove" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkUser();
    if (err) return err;
    switch (String(args.action)) {
      case "search":
        if (!args.query) return "search requires query";
        return json(await lark.driveSearch(String(args.query)));
      case "read":
        if (!args.doc_token) return "read requires doc_token";
        return json(await lark.driveGetDoc(String(args.doc_token)));
      case "read_content":
        if (!args.doc_token) return "read_content requires doc_token";
        return json(await lark.driveGetDocContent(String(args.doc_token)));
      case "create":
        if (!args.title) return "create requires title";
        return json(await lark.driveCreateDoc(String(args.title), args.folder_token ? String(args.folder_token) : undefined));
      case "update":
        if (!args.doc_token) return "update requires doc_token";
        if (!args.content) return "update requires content";
        return json(await lark.driveReplaceDocContent(String(args.doc_token), String(args.content)));
      case "list_blocks":
        if (!args.doc_token) return "list_blocks requires doc_token";
        return json(await lark.driveListBlocks(String(args.doc_token)));
      case "append": {
        if (!args.doc_token) return "append requires doc_token";
        if (!args.content) return "append requires content";
        const docInfo = await lark.driveGetDoc(String(args.doc_token)) as { document?: { document_id: string } };
        const pageBlockId = docInfo?.document?.document_id || String(args.doc_token);
        const paragraphs = String(args.content).split(/\n{2,}/).filter((p: string) => p.trim());
        const children = paragraphs.map((p: string) => ({
          block_type: 2,
          paragraph: { elements: [{ text_run: { content: p.trim() } }] },
        }));
        return json(await lark.driveCreateBlock(String(args.doc_token), pageBlockId, children));
      }
      case "delete_block":
        if (!args.doc_token || !args.block_id) return "delete_block requires doc_token and block_id";
        return json(await lark.driveDeleteBlock(String(args.doc_token), String(args.block_id)));
      default:
        return `Unknown action: ${args.action}. Available: search, read, read_content, create, update, list_blocks, append, delete_block`;
    }
  },
};

// ── Tasks (user token) ──

const larkTaskTool: ToolDefinition = {
  name: "lark_task",
  description: "Lark Tasks — list, create, and complete tasks (requires personal authorization)",
  searchHint: "task todo create complete lark",
  category: "task",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "complete"], description: "list=all tasks, create=new task, complete=mark done" },
      summary: { type: "string", description: "create: task title" },
      due: { type: "string", description: "create: due date ISO8601" },
      task_id: { type: "string", description: "complete: task ID" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkUser();
    if (err) return err;
    switch (String(args.action)) {
      case "list":
        return json(await lark.taskList());
      case "create":
        if (!args.summary) return "create requires summary";
        return json(await lark.taskCreate(String(args.summary), args.due ? String(args.due) : undefined));
      case "complete":
        if (!args.task_id) return "complete requires task_id";
        return json(await lark.taskComplete(String(args.task_id)));
      default:
        return `Unknown action: ${args.action}. Available: list, create, complete`;
    }
  },
};

// ── Approval (user token) ──

const larkApprovalTool: ToolDefinition = {
  name: "lark_approval",
  description: "Lark Approval — query, approve, or reject approval requests (requires personal authorization)",
  searchHint: "approval approve reject lark",
  category: "web",
  permission: "high",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "approve", "reject"], description: "list=pending approvals, approve/reject by instance_id" },
      approval_code: { type: "string", description: "list: filter by approval template code" },
      instance_id: { type: "string", description: "approve/reject: instance ID" },
      comment: { type: "string", description: "approve/reject: comment" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkUser();
    if (err) return err;
    switch (String(args.action)) {
      case "list":
        return json(await lark.approvalList(args.approval_code ? String(args.approval_code) : undefined));
      case "approve":
        if (!args.instance_id) return "approve requires instance_id";
        return json(await lark.approvalApprove(String(args.instance_id), args.comment ? String(args.comment) : undefined));
      case "reject":
        if (!args.instance_id) return "reject requires instance_id";
        return json(await lark.approvalReject(String(args.instance_id), args.comment ? String(args.comment) : undefined));
      default:
        return `Unknown action: ${args.action}. Available: list, approve, reject`;
    }
  },
};

// ── Sheets (user token) ──

const larkSheetTool: ToolDefinition = {
  name: "lark_sheet",
  description: "Lark Sheets — read/write spreadsheet data, create sheets (requires personal authorization)",
  searchHint: "sheet spreadsheet read write data lark",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write", "create"], description: "read=read data, write=write data, create=new sheet" },
      spreadsheet_token: { type: "string", description: "read/write: spreadsheet token" },
      range: { type: "string", description: "read/write: cell range (e.g. Sheet1!A1:C10)" },
      values: { type: "string", description: "write: data as JSON 2D array" },
      title: { type: "string", description: "create: sheet title" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkUser();
    if (err) return err;
    switch (String(args.action)) {
      case "read":
        if (!args.spreadsheet_token) return "read requires spreadsheet_token";
        return json(await lark.sheetRead(String(args.spreadsheet_token), args.range ? String(args.range) : undefined));
      case "write":
        if (!args.spreadsheet_token || !args.range || !args.values) return "write requires spreadsheet_token, range, values";
        return json(await lark.sheetWrite(String(args.spreadsheet_token), String(args.range), JSON.parse(String(args.values))));
      case "create":
        if (!args.title) return "create requires title";
        return json(await lark.sheetCreate(String(args.title)));
      default:
        return `Unknown action: ${args.action}. Available: read, write, create`;
    }
  },
};

// ── Email (user token) ──

const larkEmailTool: ToolDefinition = {
  name: "lark_email",
  description: "Lark Mail — list, read, send, reply, search emails (requires personal authorization)",
  searchHint: "email mail send read reply search lark",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "read", "send", "reply", "search"], description: "list=inbox, read=get one email, send=new, reply=reply, search=search" },
      folder: { type: "string", description: "list: folder (INBOX/SENT/DRAFTS)" },
      limit: { type: "number", description: "list: max results (default 20)" },
      message_id: { type: "string", description: "read/reply: email ID" },
      to: { type: "string", description: "send: comma-separated emails" },
      cc: { type: "string", description: "send: comma-separated CCs" },
      subject: { type: "string", description: "send: subject line" },
      body: { type: "string", description: "send/reply: body text" },
      query: { type: "string", description: "search: search keyword" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    const err = checkUser();
    if (err) return err;
    switch (String(args.action)) {
      case "list":
        return json(await lark.mailList(args.folder ? String(args.folder) : undefined, args.limit ? Number(args.limit) : undefined));
      case "read":
        if (!args.message_id) return "read requires message_id";
        return json(await lark.mailRead(String(args.message_id)));
      case "send":
        if (!args.to || !args.subject || !args.body) return "send requires to, subject, body";
        return json(await lark.mailSend(
          String(args.to).split(",").map(s => s.trim()),
          String(args.subject), String(args.body),
          args.cc ? String(args.cc).split(",").map(s => s.trim()) : undefined,
        ));
      case "search":
        if (!args.query) return "search requires query";
        return json(await lark.mailSearch(String(args.query)));
      default:
        return `Unknown action: ${args.action}. Available: list, read, send, reply, search`;
    }
  },
};

// ═══════════ Registration ═══════════

const TENANT_TOOLS: ToolDefinition[] = [larkImTool];
const USER_TOOLS: ToolDefinition[] = [larkCalendarTool, larkDocTool, larkTaskTool, larkApprovalTool, larkSheetTool, larkEmailTool];
const USER_TOOL_NAMES = USER_TOOLS.map(t => t.name);

export function registerLarkTools(): void {
  for (const tool of TENANT_TOOLS) registerTool(tool);
  refreshUserToolRegistration();
}

export function refreshUserToolRegistration(): void {
  const hasUser = lark.hasUserAccess();
  for (const tool of USER_TOOLS) {
    if (hasUser) {
      registerTool(tool);
    } else {
      unregisterTool(tool.name);
    }
  }
}

export function getUserToolNames(): string[] {
  return USER_TOOL_NAMES;
}

export function initLark(): void {
  lark.loadLarkAppConfig();
  registerLarkTools();
}
