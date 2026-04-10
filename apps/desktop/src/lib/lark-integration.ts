/**
 * Lark CLI Integration — 飞书生态全接入
 * Wraps lark-cli commands and registers them as Agent tools
 * Capabilities: Calendar, IM, Doc, Task, Approval, Sheet
 */
import { registerTool, type ToolDefinition } from "./tool-registry";

// ═══════════ Config ═══════════

export interface LarkConfig {
  appId: string;
  appSecret: string;
  cliPath: string;       // default: "lark-cli"
  outputFormat: string;  // default: "pretty"
}

const DEFAULT_CONFIG: LarkConfig = {
  appId: "",
  appSecret: "",
  cliPath: "lark-cli",
  outputFormat: "pretty",
};

let _config: LarkConfig = { ...DEFAULT_CONFIG };

export function getLarkConfig(): LarkConfig {
  return { ..._config };
}

export function setLarkConfig(partial: Partial<LarkConfig>): void {
  _config = { ..._config, ...partial };
  saveLarkConfig();
}

function saveLarkConfig(): void {
  try {
    localStorage.setItem("lark-config", JSON.stringify(_config));
  } catch { /* quota exceeded */ }
}

export function loadLarkConfig(): LarkConfig {
  try {
    const raw = localStorage.getItem("lark-config");
    if (raw) {
      _config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch { /* corrupt */ }
  return { ..._config };
}

export function isLarkConfigured(): boolean {
  return !!_config.appId && !!_config.appSecret;
}

// ═══════════ LarkCLI Class ═══════════

export class LarkCLI {
  private config: LarkConfig;

  constructor(config?: Partial<LarkConfig>) {
    this.config = { ..._config, ...config };
  }

  /** Execute a lark-cli command and return stdout */
  async execute(args: string[]): Promise<string> {
    const fullArgs = [
      ...args,
      "--output", this.config.outputFormat,
    ];

    // Try Tauri shell execute first, fall back to simulation
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("execute_command", {
        program: this.config.cliPath,
        args: fullArgs,
        env: {
          LARK_APP_ID: this.config.appId,
          LARK_APP_SECRET: this.config.appSecret,
        },
      });
      return result;
    } catch {
      // Fallback: return descriptive message for non-Tauri environments
      return `[lark-cli] ${this.config.cliPath} ${fullArgs.join(" ")}\n(Tauri shell not available — command would execute in production)`;
    }
  }

  // ── Calendar ──
  async calendarAgenda(days?: number): Promise<string> {
    return this.execute(["calendar", "+agenda", ...(days ? ["--days", String(days)] : [])]);
  }
  async calendarCreate(title: string, start: string, end: string, attendees?: string[]): Promise<string> {
    const args = ["calendar", "+create", "--summary", title, "--start", start, "--end", end];
    if (attendees?.length) args.push("--attendees", attendees.join(","));
    args.push("--dry-run");
    return this.execute(args);
  }
  async calendarFreebusy(userIds: string[], start: string, end: string): Promise<string> {
    return this.execute(["calendar", "+freebusy", "--user-ids", userIds.join(","), "--start", start, "--end", end]);
  }

  // ── IM (Messenger) ──
  async imSendMessage(chatId: string, text: string): Promise<string> {
    return this.execute(["im", "+messages-send", "--chat-id", chatId, "--msg-type", "text", "--text", text]);
  }
  async imSearchMessages(query: string, chatId?: string): Promise<string> {
    const args = ["im", "+messages-search", "--query", query];
    if (chatId) args.push("--chat-id", chatId);
    return this.execute(args);
  }
  async imListChats(): Promise<string> {
    return this.execute(["im", "chats", "list"]);
  }

  // ── Docs ──
  async docCreate(title: string, content?: string): Promise<string> {
    const args = ["doc", "+create", "--title", title];
    if (content) args.push("--content", content);
    return this.execute(args);
  }
  async docRead(docToken: string): Promise<string> {
    return this.execute(["doc", "+read", "--document-id", docToken]);
  }
  async docSearch(query: string): Promise<string> {
    return this.execute(["drive", "+search", "--query", query]);
  }

  // ── Tasks ──
  async taskCreate(title: string, dueDate?: string): Promise<string> {
    const args = ["task", "+create", "--summary", title];
    if (dueDate) args.push("--due", dueDate);
    return this.execute(args);
  }
  async taskList(): Promise<string> {
    return this.execute(["task", "tasks", "list"]);
  }
  async taskComplete(taskId: string): Promise<string> {
    return this.execute(["task", "+complete", "--task-id", taskId]);
  }

  // ── Approval ──
  async approvalQuery(status?: string): Promise<string> {
    const args = ["approval", "+query"];
    if (status) args.push("--status", status);
    return this.execute(args);
  }
  async approvalApprove(instanceId: string, comment?: string): Promise<string> {
    const args = ["approval", "+approve", "--instance-id", instanceId];
    if (comment) args.push("--comment", comment);
    return this.execute(args);
  }
  async approvalReject(instanceId: string, comment?: string): Promise<string> {
    const args = ["approval", "+reject", "--instance-id", instanceId];
    if (comment) args.push("--comment", comment);
    return this.execute(args);
  }

  // ── Sheets ──
  async sheetRead(spreadsheetToken: string, range?: string): Promise<string> {
    const args = ["sheets", "+read", "--spreadsheet-token", spreadsheetToken];
    if (range) args.push("--range", range);
    return this.execute(args);
  }
  async sheetWrite(spreadsheetToken: string, range: string, values: string): Promise<string> {
    return this.execute(["sheets", "+write", "--spreadsheet-token", spreadsheetToken, "--range", range, "--values", values]);
  }
  async sheetCreate(title: string): Promise<string> {
    return this.execute(["sheets", "+create", "--title", title]);
  }
}

// ═══════════ Tool Definitions ═══════════

const lark = new LarkCLI();

const larkCalendarTool: ToolDefinition = {
  name: "lark_calendar",
  description: "飞书日程管理 — 查看日程、创建会议、查询空闲时间。示例：帮我看今天的日程",
  searchHint: "calendar agenda meeting schedule feishu lark 日程 会议",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["agenda", "create", "freebusy"],
        description: "agenda=查看日程, create=创建日程, freebusy=查询空闲",
      },
      days: { type: "number", description: "agenda: 查看未来N天 (默认1)" },
      title: { type: "string", description: "create: 会议标题" },
      start: { type: "string", description: "create/freebusy: 开始时间 ISO8601" },
      end: { type: "string", description: "create/freebusy: 结束时间 ISO8601" },
      attendees: { type: "string", description: "create: 参会人邮箱逗号分隔" },
      user_ids: { type: "string", description: "freebusy: 用户ID逗号分隔" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    if (!isLarkConfigured()) return "❌ 飞书未配置。请在设置页面配置 App ID 和 App Secret。";
    const action = String(args.action);
    switch (action) {
      case "agenda":
        return lark.calendarAgenda(args.days ? Number(args.days) : undefined);
      case "create":
        if (!args.title || !args.start || !args.end) return "❌ 创建日程需要 title, start, end";
        return lark.calendarCreate(String(args.title), String(args.start), String(args.end),
          args.attendees ? String(args.attendees).split(",") : undefined);
      case "freebusy":
        if (!args.user_ids || !args.start || !args.end) return "❌ 查询空闲需要 user_ids, start, end";
        return lark.calendarFreebusy(String(args.user_ids).split(","), String(args.start), String(args.end));
      default:
        return `❌ 未知操作: ${action}。可用: agenda, create, freebusy`;
    }
  },
};

const larkImTool: ToolDefinition = {
  name: "lark_im",
  description: "飞书消息发送 — 发送个人/群聊消息、搜索聊天记录。示例：给XX群发消息",
  searchHint: "message chat send im feishu lark 消息 群聊",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["send", "search", "list_chats"],
        description: "send=发消息, search=搜索消息, list_chats=列出群聊",
      },
      chat_id: { type: "string", description: "send/search: 聊天ID (oc_xxx)" },
      text: { type: "string", description: "send: 消息内容" },
      query: { type: "string", description: "search: 搜索关键词" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    if (!isLarkConfigured()) return "❌ 飞书未配置。请在设置页面配置 App ID 和 App Secret。";
    const action = String(args.action);
    switch (action) {
      case "send":
        if (!args.chat_id || !args.text) return "❌ 发送消息需要 chat_id 和 text";
        return lark.imSendMessage(String(args.chat_id), String(args.text));
      case "search":
        if (!args.query) return "❌ 搜索需要 query";
        return lark.imSearchMessages(String(args.query), args.chat_id ? String(args.chat_id) : undefined);
      case "list_chats":
        return lark.imListChats();
      default:
        return `❌ 未知操作: ${action}。可用: send, search, list_chats`;
    }
  },
};

const larkDocTool: ToolDefinition = {
  name: "lark_doc",
  description: "飞书文档操作 — 创建/读取/搜索文档。示例：帮我搜索关于XX的文档",
  searchHint: "document doc create read search feishu lark 文档",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "read", "search"],
        description: "create=创建文档, read=读取文档, search=搜索文档",
      },
      title: { type: "string", description: "create: 文档标题" },
      content: { type: "string", description: "create: 文档内容 (Markdown)" },
      doc_token: { type: "string", description: "read: 文档 Token" },
      query: { type: "string", description: "search: 搜索关键词" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    if (!isLarkConfigured()) return "❌ 飞书未配置。请在设置页面配置 App ID 和 App Secret。";
    const action = String(args.action);
    switch (action) {
      case "create":
        if (!args.title) return "❌ 创建文档需要 title";
        return lark.docCreate(String(args.title), args.content ? String(args.content) : undefined);
      case "read":
        if (!args.doc_token) return "❌ 读取文档需要 doc_token";
        return lark.docRead(String(args.doc_token));
      case "search":
        if (!args.query) return "❌ 搜索需要 query";
        return lark.docSearch(String(args.query));
      default:
        return `❌ 未知操作: ${action}。可用: create, read, search`;
    }
  },
};

const larkTaskTool: ToolDefinition = {
  name: "lark_task",
  description: "飞书任务管理 — 创建/查看/完成任务。示例：帮我创建一个任务",
  searchHint: "task todo create complete feishu lark 任务",
  category: "task",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "complete"],
        description: "create=创建任务, list=查看任务列表, complete=完成任务",
      },
      title: { type: "string", description: "create: 任务标题" },
      due_date: { type: "string", description: "create: 截止日期 ISO8601" },
      task_id: { type: "string", description: "complete: 任务ID" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    if (!isLarkConfigured()) return "❌ 飞书未配置。请在设置页面配置 App ID 和 App Secret。";
    const action = String(args.action);
    switch (action) {
      case "create":
        if (!args.title) return "❌ 创建任务需要 title";
        return lark.taskCreate(String(args.title), args.due_date ? String(args.due_date) : undefined);
      case "list":
        return lark.taskList();
      case "complete":
        if (!args.task_id) return "❌ 完成任务需要 task_id";
        return lark.taskComplete(String(args.task_id));
      default:
        return `❌ 未知操作: ${action}。可用: create, list, complete`;
    }
  },
};

const larkApprovalTool: ToolDefinition = {
  name: "lark_approval",
  description: "飞书审批处理 — 查询/审批/驳回审批单。示例：帮我看看待审批的单子",
  searchHint: "approval approve reject feishu lark 审批",
  category: "web",
  permission: "high",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["query", "approve", "reject"],
        description: "query=查询审批, approve=通过, reject=驳回",
      },
      status: { type: "string", description: "query: 筛选状态 (pending/approved/rejected)" },
      instance_id: { type: "string", description: "approve/reject: 审批实例ID" },
      comment: { type: "string", description: "approve/reject: 审批意见" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    if (!isLarkConfigured()) return "❌ 飞书未配置。请在设置页面配置 App ID 和 App Secret。";
    const action = String(args.action);
    switch (action) {
      case "query":
        return lark.approvalQuery(args.status ? String(args.status) : undefined);
      case "approve":
        if (!args.instance_id) return "❌ 审批需要 instance_id";
        return lark.approvalApprove(String(args.instance_id), args.comment ? String(args.comment) : undefined);
      case "reject":
        if (!args.instance_id) return "❌ 驳回需要 instance_id";
        return lark.approvalReject(String(args.instance_id), args.comment ? String(args.comment) : undefined);
      default:
        return `❌ 未知操作: ${action}。可用: query, approve, reject`;
    }
  },
};

const larkSheetTool: ToolDefinition = {
  name: "lark_sheet",
  description: "飞书表格数据 — 读写电子表格数据、创建表格。示例：帮我读取XX表格的数据",
  searchHint: "sheet spreadsheet read write data feishu lark 表格 数据",
  category: "web",
  permission: "medium",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "write", "create"],
        description: "read=读取数据, write=写入数据, create=创建表格",
      },
      spreadsheet_token: { type: "string", description: "read/write: 表格Token" },
      range: { type: "string", description: "read/write: 单元格范围 (如 Sheet1!A1:C10)" },
      values: { type: "string", description: "write: JSON 格式的数据" },
      title: { type: "string", description: "create: 表格标题" },
    },
    required: ["action"],
  },
  execute: async (args) => {
    if (!isLarkConfigured()) return "❌ 飞书未配置。请在设置页面配置 App ID 和 App Secret。";
    const action = String(args.action);
    switch (action) {
      case "read":
        if (!args.spreadsheet_token) return "❌ 读取需要 spreadsheet_token";
        return lark.sheetRead(String(args.spreadsheet_token), args.range ? String(args.range) : undefined);
      case "write":
        if (!args.spreadsheet_token || !args.range || !args.values) return "❌ 写入需要 spreadsheet_token, range, values";
        return lark.sheetWrite(String(args.spreadsheet_token), String(args.range), String(args.values));
      case "create":
        if (!args.title) return "❌ 创建表格需要 title";
        return lark.sheetCreate(String(args.title));
      default:
        return `❌ 未知操作: ${action}。可用: read, write, create`;
    }
  },
};

// ═══════════ Registration ═══════════

const LARK_TOOLS: ToolDefinition[] = [
  larkCalendarTool,
  larkImTool,
  larkDocTool,
  larkTaskTool,
  larkApprovalTool,
  larkSheetTool,
];

/** Register all Lark tools into the tool registry */
export function registerLarkTools(): void {
  for (const tool of LARK_TOOLS) {
    registerTool(tool);
  }
}

/** Initialize Lark: load config + register tools */
export function initLark(): void {
  loadLarkConfig();
  registerLarkTools();
}
