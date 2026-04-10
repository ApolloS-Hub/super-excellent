/**
 * Tool definitions and execution for OpenAI-compatible function calling.
 * Tries Tauri backend first, falls back to JS implementations.
 *
 * Registry-aware: new tools register via tool-registry.ts.
 * Legacy tools below are also registered into the registry for unified access.
 */
import { isTauriAvailable } from "./tauri-bridge";
// tauriFetch reserved for other tools
// import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  registerTool,
  getToolsAsOpenAI,
  executeRegistryTool,
  type ToolDefinition,
  type OpenAIToolDef,
  type ToolCategory,
  type PermissionLevel,
} from "./tool-registry";

// ═══════════ OpenAI Tool Definitions ═══════════

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "搜索互联网获取最新信息。用于回答需要实时数据的问题。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "获取指定 URL 的网页内容并提取主要文本。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要获取的网页 URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "执行 shell 命令。可用于运行脚本、查看文件、安装包等。支持超时控制和输出截断。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 shell 命令" },
          timeout: { type: "number", description: "超时时间（秒），默认 120，最大 600" },
          truncate_output: { type: "number", description: "输出最大字符数，超出则截断，默认 100000" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_read",
      description: "读取文件内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          offset: { type: "number", description: "起始行号" },
          limit: { type: "number", description: "读取行数" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "写入文件内容（覆盖）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "要写入的内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_edit",
      description: "编辑文件中的指定文本（查找并替换）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          old_text: { type: "string", description: "要查找的原文本" },
          new_text: { type: "string", description: "替换后的新文本" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "按模式匹配搜索文件路径。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，如 **/*.ts" },
          path: { type: "string", description: "搜索根目录" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "在文件中搜索文本内容。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "搜索正则表达式" },
          path: { type: "string", description: "搜索目录或文件" },
          include: { type: "string", description: "文件名过滤模式" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "列出目录内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_open",
      description: "在用户的默认浏览器中打开 URL。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要打开的 URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_write",
      description: "管理任务清单。创建、更新、标记完成 TODO 项目。支持优先级、依赖关系和状态流转。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "add", "done", "remove", "clear", "update", "get"],
            description: "操作类型",
          },
          item: { type: "string", description: "TODO 内容（add/done/remove 时必填）" },
          id: { type: "string", description: "任务 ID（update/get/done/remove 时可用）" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "优先级，默认 medium" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "blocked"],
            description: "状态（update 时可用）",
          },
          blocked_by: {
            type: "array",
            items: { type: "string" },
            description: "依赖的其他任务 ID 列表",
          },
          description: { type: "string", description: "任务详细描述" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: "保存用户偏好和重要信息到持久记忆。记住用户说的重要事情，下次对话时可以使用。",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "要记住的内容" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_read",
      description: "读取用户的持久记忆，了解用户偏好和历史上下文。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_view",
      description: "查看文件的修改历史和 diff。显示文件在本次会话中被如何修改。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo",
      description: "撤销对文件的最近一次修改，恢复到修改前的内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "要撤销修改的文件路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_detect",
      description: "检测并分析当前项目的类型、依赖、脚本等信息。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "项目根目录路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_spawn",
      description: "派生子 agent 执行独立子任务。子 agent 有独立上下文，完成后返回结果摘要。适用于复杂的多步骤任务拆分。",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "子 agent 的任务描述，需提供完整上下文" },
          name: { type: "string", description: "子 agent 名称（1-2 个词，小写），用于显示" },
          description: { type: "string", description: "子 agent 用途的简短描述（3-5 个词）" },
          allowed_tools: {
            type: "array",
            items: { type: "string" },
            description: "允许子 agent 使用的工具列表，省略则允许全部",
          },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notebook_edit",
      description: "编辑 Jupyter notebook (.ipynb) 的单元格。支持替换、插入、删除单元格。",
      parameters: {
        type: "object",
        properties: {
          notebook_path: { type: "string", description: "notebook 文件的绝对路径" },
          cell_id: { type: "string", description: "要编辑的单元格 ID。插入模式时新单元格插入到此 ID 之后" },
          new_source: { type: "string", description: "单元格的新内容" },
          cell_type: { type: "string", enum: ["code", "markdown"], description: "单元格类型" },
          edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: "编辑模式，默认 replace" },
        },
        required: ["notebook_path", "new_source"],
      },
    },
  },
];

// ═══════════ Tool Name Mapping (frontend name → Rust backend name) ═══════════

const TOOL_NAME_MAP: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  bash: "Bash",
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  list_dir: "ListDir",
  browser_open: "Browser",
};

// ═══════════ Todo / Task System (inspired by Claude Code TaskCreate/Get/List) ═══════════

type TaskPriority = "high" | "medium" | "low";
type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

interface Task {
  id: string;
  subject: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
}

let taskList: Task[] = [];
let taskIdCounter = 1;

function generateTaskId(): string {
  return `task_${taskIdCounter++}`;
}

const PRIORITY_ICONS: Record<TaskPriority, string> = { high: "🔴", medium: "🟡", low: "🟢" };
const STATUS_ICONS: Record<TaskStatus, string> = { pending: "⬜", in_progress: "🔄", completed: "✅", blocked: "🚫" };

function resolveBlockedTasks(): void {
  const completedIds = new Set(taskList.filter(t => t.status === "completed").map(t => t.id));
  for (const task of taskList) {
    if (task.status === "blocked" && task.blockedBy.every(id => completedIds.has(id))) {
      task.status = "pending";
      task.updatedAt = Date.now();
    }
  }
}

function executeTodoTool(args: Record<string, unknown>): string {
  const action = String(args.action || "list");
  const item = String(args.item || "");
  const taskId = String(args.id || "");
  const priority = (args.priority as TaskPriority) || "medium";
  const blockedBy = Array.isArray(args.blocked_by) ? args.blocked_by.map(String) : [];
  const description = String(args.description || "");

  switch (action) {
    case "add": {
      if (!item) return "❌ 请提供任务内容";
      const id = generateTaskId();
      const status: TaskStatus = blockedBy.length > 0 ? "blocked" : "pending";
      taskList.push({
        id, subject: item, description, priority, status,
        blockedBy, createdAt: Date.now(), updatedAt: Date.now(),
      });
      return `✅ 创建任务 [${id}]: ${item}\n\n${formatTodoList()}`;
    }
    case "done": {
      const target = taskId
        ? taskList.find(t => t.id === taskId)
        : taskList.find(t => t.subject.includes(item) && t.status !== "completed");
      if (!target) return `❌ 未找到匹配的未完成任务: ${taskId || item}`;
      target.status = "completed";
      target.updatedAt = Date.now();
      resolveBlockedTasks();
      return `✅ 完成: [${target.id}] ${target.subject}\n\n${formatTodoList()}`;
    }
    case "update": {
      const t = taskList.find(tk => tk.id === taskId);
      if (!t) return `❌ 未找到任务: ${taskId}`;
      if (args.status) t.status = args.status as TaskStatus;
      if (args.priority) t.priority = args.priority as TaskPriority;
      if (item) t.subject = item;
      if (description) t.description = description;
      if (blockedBy.length > 0) t.blockedBy = blockedBy;
      t.updatedAt = Date.now();
      resolveBlockedTasks();
      return `✅ 已更新任务 [${t.id}]\n\n${formatTodoList()}`;
    }
    case "get": {
      const found = taskList.find(tk => tk.id === taskId);
      if (!found) return `❌ 未找到任务: ${taskId}`;
      return formatTaskDetail(found);
    }
    case "remove": {
      const before = taskList.length;
      taskList = taskList.filter(t =>
        taskId ? t.id !== taskId : !t.subject.includes(item),
      );
      resolveBlockedTasks();
      return `✅ 删除了 ${before - taskList.length} 项\n\n${formatTodoList()}`;
    }
    case "clear":
      taskList = [];
      taskIdCounter = 1;
      return "✅ 清单已清空";
    case "list":
    default:
      return formatTodoList();
  }
}

function formatTaskDetail(t: Task): string {
  const deps = t.blockedBy.length > 0 ? `\n  依赖: ${t.blockedBy.join(", ")}` : "";
  const desc = t.description ? `\n  描述: ${t.description}` : "";
  return `📌 [${t.id}] ${t.subject}\n  状态: ${STATUS_ICONS[t.status]} ${t.status} | 优先级: ${PRIORITY_ICONS[t.priority]} ${t.priority}${deps}${desc}\n  创建: ${new Date(t.createdAt).toLocaleString()} | 更新: ${new Date(t.updatedAt).toLocaleString()}`;
}

function formatTodoList(): string {
  if (taskList.length === 0) return "📋 清单为空";
  const completed = taskList.filter(t => t.status === "completed").length;
  const sorted = [...taskList].sort((a, b) => {
    const pOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
    const sOrder: Record<TaskStatus, number> = { in_progress: 0, pending: 1, blocked: 2, completed: 3 };
    const sd = sOrder[a.status] - sOrder[b.status];
    return sd !== 0 ? sd : pOrder[a.priority] - pOrder[b.priority];
  });
  let out = `📋 任务清单 (${completed}/${taskList.length} 完成)\n`;
  for (const t of sorted) {
    const deps = t.blockedBy.length > 0 ? ` ⛓️[${t.blockedBy.join(",")}]` : "";
    out += `${STATUS_ICONS[t.status]} ${PRIORITY_ICONS[t.priority]} [${t.id}] ${t.subject}${deps}\n`;
  }
  return out;
}

// ═══════════ Dangerous Command Detection (from claw-code-parity bash_validation) ═══════════

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?\s+)?[/~]/, /mkfs/, /dd\s+if=/, />\s*\/dev\//, /chmod\s+-R\s+777\s+\//,
  /shutdown/, /reboot/, /halt/, /poweroff/,
  /DROP\s+(DATABASE|TABLE)/i, /DELETE\s+FROM/i, /TRUNCATE/i,
  /curl\s*\|.*sh/, /wget\s*\|.*sh/, /eval\s*\$\(curl/, 
  /sudo\s+/, /su\s+-/,
  /git\s+push.*--force/, /git\s+push.*-f/,
];

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command));
}

function getDangerDescription(command: string): string {
  if (/rm\s/.test(command)) return "删除文件/目录";
  if (/sudo/.test(command)) return "需要管理员权限";
  if (/git\s+push.*(-f|--force)/.test(command)) return "强制推送 Git";
  if (/DROP|DELETE|TRUNCATE/i.test(command)) return "数据库破坏性操作";
  if (/curl.*\|\s*(sh|bash)/.test(command)) return "远程脚本执行";
  return "潜在危险操作";
}

// Permission callback — set by ChatPage
let permissionCallback: ((tool: string, detail: string) => Promise<boolean>) | null = null;

export function setPermissionCallback(cb: (tool: string, detail: string) => Promise<boolean>): void {
  permissionCallback = cb;
}

export function describeToolAction(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash": {
      const cmd = typeof args.command === "string" ? args.command : "";
      const danger = isDangerousCommand(cmd) ? ` [⚠️ ${getDangerDescription(cmd)}]` : "";
      return `执行命令${danger}: ${cmd.slice(0, 150)}`;
    }
    case "file_write":
      return `写入文件: ${args.path ?? ""}`;
    case "file_edit":
      return `编辑文件: ${args.path ?? ""}`;
    case "notebook_edit":
      return `编辑 Notebook: ${args.notebook_path ?? ""}`;
    case "browser_open":
      return `打开 URL: ${args.url ?? ""}`;
    case "agent_spawn":
      return `派生子 Agent: ${(args.name as string) ?? ""}`;
    case "memory_write":
      return `写入记忆: ${(args.content as string)?.slice(0, 80) ?? ""}`;
    default:
      return `使用工具: ${toolName}`;
  }
}

// ═══════════ Tool Execution ═══════════

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Execute before_tool hooks
  try {
    const { executeHooks } = await import("./hooks");
    const hookResult = await executeHooks("before_tool", { toolName: name, toolInput: args });
    if (hookResult.blocked) {
      return `⛔ Hook 拦截: ${hookResult.reason || "操作被阻止"}`;
    }
    if (hookResult.modifiedInput) {
      Object.assign(args, hookResult.modifiedInput);
    }
  } catch { /* hooks not available */ }

  const result = await _executeToolInner(name, args);

  // Execute after_tool hooks
  try {
    const { executeHooks } = await import("./hooks");
    await executeHooks("after_tool", { toolName: name, toolInput: args, toolOutput: result });
  } catch { /* hooks not available */ }

  return result;
}

async function _executeToolInner(name: string, args: Record<string, unknown>): Promise<string> {
  // Web search — handle before anything else to avoid Rust invoke stack overflow
  if (name === "web_search") {
    return executeWebSearch(args);
  }

  // Registry-first: new tools (ask_user, sleep, task_*, plan mode, tool_search) route through registry
  const registryResult = await executeRegistryTool(name, args);
  if (registryResult.handled) return registryResult.result;

  const rustName = TOOL_NAME_MAP[name];

  // Permission check for dangerous operations
  if (name === "bash" && typeof args.command === "string" && isDangerousCommand(args.command)) {
    const desc = getDangerDescription(args.command);
    if (permissionCallback) {
      const allowed = await permissionCallback("bash", `${desc}\n命令: ${args.command}`);
      if (!allowed) return `⛔ 用户拒绝执行: ${desc}`;
    }
  }
  if ((name === "file_write" || name === "file_edit") && typeof args.path === "string") {
    const sensitivePaths = ["/etc/", "/usr/", "/System/", "/bin/", "/sbin/", "~/.ssh/", "~/.config/"];
    if (sensitivePaths.some(p => (args.path as string).startsWith(p))) {
      if (permissionCallback) {
        const allowed = await permissionCallback(name, `写入敏感路径: ${args.path}`);
        if (!allowed) return `⛔ 用户拒绝写入: ${args.path}`;
      }
    }
  }

  // ═══════ Bash improvements: timeout clamping ═══════
  // Output truncation is handled by maxResultChars in the registry (100_000 chars).
  if (name === "bash" && typeof args.command === "string") {
    const maxTimeout = 600;
    const defaultTimeout = 120;
    const requestedTimeout = typeof args.timeout === "number" ? args.timeout : defaultTimeout;
    args.timeout = Math.min(Math.max(requestedTimeout, 1), maxTimeout);
    delete args.truncate_output; // no longer used; registry handles truncation
  }

  // ═══════ Agent Spawn (inspired by Claude Code AgentTool) ═══════
  if (name === "agent_spawn") {
    const prompt = String(args.prompt || "");
    const agentName = String(args.name || `sub-${Date.now()}`);
    const description = String(args.description || "子任务");
    if (!prompt) return "❌ 请提供子 agent 的任务描述 (prompt)";
    return `🤖 子 Agent「${agentName}」已启动\n📝 任务: ${description}\n\n子 agent 正在独立执行任务，完成后将返回结果摘要。\n\n---\n提示: ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`;
  }

  // ═══════ Notebook Edit (inspired by Claude Code NotebookEditTool) ═══════
  if (name === "notebook_edit") {
    return executeNotebookEdit(args);
  }

  // ═══════ Frontend-only tools (no Rust needed) ═══════
  if (name === "todo_write") {
    return executeTodoTool(args);
  }
  if (name === "memory_write") {
    const { appendMemory } = await import("./memory");
    appendMemory(String(args.content || ""));
    return "✅ 已保存到记忆";
  }
  if (name === "memory_read") {
    const { formatMemory } = await import("./memory");
    return formatMemory();
  }
  if (name === "diff_view") {
    const { getFileBackups, formatDiff, computeDiff } = await import("./file-history");
    const backups = getFileBackups(String(args.path || ""));
    if (backups.length === 0) return "无修改记录";
    const last = backups[backups.length - 1];
    return formatDiff(computeDiff(last.originalContent, last.newContent));
  }
  if (name === "undo") {
    const path = String(args.path || "");
    const { getRewindContent } = await import("./file-history");
    const original = getRewindContent(path);
    if (!original) return "无法撤销：没有备份记录";
    // Write original content back via Rust
    const tReady = isTauriAvailable();
    if (tReady) {
      const { agentExecuteTool } = await import("./tauri-bridge");
      await agentExecuteTool("Write", { path, content: original });
      return `✅ 已撤销 ${path} 的修改`;
    }
    return "⚠️ 撤销需要 Tauri 环境";
  }
  if (name === "project_detect") {
    const { detectProject, buildProjectPrompt } = await import("./project-context");
    const project = await detectProject(String(args.path || "/tmp"));
    if (!project) return "未检测到项目";
    return buildProjectPrompt(project);
  }

  // ═══════ Rust backend tools ═══════
  const tauriReady = isTauriAvailable();
  if (tauriReady && rustName) {
    try {
      const { agentExecuteTool } = await import("./tauri-bridge");
      // Backup before write/edit
      if ((name === "file_write" || name === "file_edit") && typeof args.path === "string") {
        try {
          const original = await agentExecuteTool("Read", { path: args.path });
          const { recordBackup } = await import("./file-history");
          recordBackup(args.path, original, typeof args.content === "string" ? args.content : "");
        } catch { /* file doesn't exist yet, no backup needed */ }
      }

      const result = await agentExecuteTool(rustName, args);

      // Track file changes
      const { trackFileChange } = await import("./file-tracker");
      if (name === "file_write" && typeof args.path === "string") {
        trackFileChange(args.path, "create", typeof args.content === "string" ? args.content.length : undefined);
      } else if (name === "file_edit" && typeof args.path === "string") {
        trackFileChange(args.path, "modify");
      } else if (name === "file_read" && typeof args.path === "string") {
        trackFileChange(args.path, "read");
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Return detailed error for debugging
      if (name !== "browser_open") {
        return `工具 ${rustName} 执行失败: ${msg}\n\n调试信息:\n- 工具名: ${rustName}\n- 参数: ${JSON.stringify(args).slice(0, 500)}\n- Tauri: ${tauriReady}`;
      }
    }
  }
  if (!tauriReady) {
    return `⚠️ Tauri 运行时不可用。此工具需要桌面 App 环境。\n请使用打包后的 .app 而不是浏览器 dev server。`;
  }

  // Minimal JS fallbacks (only for dev/browser mode without Tauri)
  if (!isTauriAvailable()) {
    switch (name) {
      case "browser_open":
        return jsBrowserOpen(args.url as string);
      default:
        return `⚠️ 此工具需要桌面 App 环境。请使用打包后的 App 以获得完整工具支持。`;
    }
  }

  return `未知工具: ${name}`;
}

// ═══════════ Notebook Edit Implementation ═══════════

interface NotebookCell {
  cell_type: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  id?: string;
}

interface NotebookContent {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

async function executeNotebookEdit(args: Record<string, unknown>): Promise<string> {
  const notebookPath = String(args.notebook_path || "");
  const newSource = String(args.new_source || "");
  const editMode = String(args.edit_mode || "replace") as "replace" | "insert" | "delete";
  const cellType = String(args.cell_type || "code");
  const cellId = args.cell_id ? String(args.cell_id) : undefined;

  if (!notebookPath) return "❌ 请提供 notebook 文件路径";
  if (!notebookPath.endsWith(".ipynb")) return "❌ 文件必须是 .ipynb 格式";

  const tauriReady = isTauriAvailable();
  if (!tauriReady) return "⚠️ notebook_edit 需要 Tauri 环境";

  try {
    const { agentExecuteTool } = await import("./tauri-bridge");
    const raw = await agentExecuteTool("Read", { path: notebookPath });
    const notebook: NotebookContent = JSON.parse(raw);

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return "❌ 无效的 notebook 格式";
    }

    const sourceLines = newSource.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line,
    );

    let targetIdx = -1;
    if (cellId) {
      targetIdx = notebook.cells.findIndex((c, i) =>
        (c.id === cellId) || (String(i + 1) === cellId),
      );
    }

    switch (editMode) {
      case "replace": {
        if (targetIdx < 0) {
          if (notebook.cells.length === 0) return "❌ notebook 没有单元格可替换";
          targetIdx = 0;
        }
        notebook.cells[targetIdx].source = sourceLines;
        if (cellType) notebook.cells[targetIdx].cell_type = cellType;
        break;
      }
      case "insert": {
        const newCell: NotebookCell = {
          cell_type: cellType,
          source: sourceLines,
          metadata: {},
          ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
        };
        const insertAt = targetIdx >= 0 ? targetIdx + 1 : notebook.cells.length;
        notebook.cells.splice(insertAt, 0, newCell);
        break;
      }
      case "delete": {
        if (targetIdx < 0) return "❌ 未找到要删除的单元格";
        notebook.cells.splice(targetIdx, 1);
        break;
      }
    }

    const updated = JSON.stringify(notebook, null, 1) + "\n";
    await agentExecuteTool("Write", { path: notebookPath, content: updated });

    const modeLabel = editMode === "replace" ? "替换" : editMode === "insert" ? "插入" : "删除";
    const cellLabel = cellId ? `单元格 ${cellId}` : `第 ${(targetIdx + 1)} 个单元格`;
    return `✅ Notebook ${modeLabel}成功: ${cellLabel} (${cellType})\n路径: ${notebookPath}`;
  } catch (e) {
    return `❌ notebook 编辑失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ═══════════ JS Fallback (browser_open only) ═══════════

function jsBrowserOpen(url: string): string {
  try {
    window.open(url, "_blank");
    return `✅ 已在浏览器中打开: ${url}`;
  } catch {
    return `打开失败，请手动访问: ${url}`;
  }
}

// ═══════════ Per-tool registry metadata ═══════════

interface LegacyMeta {
  permission: PermissionLevel;
  category: ToolCategory;
  searchHint: string;
  maxResultChars?: number;
}

const LEGACY_META: Record<string, LegacyMeta> = {
  bash: {
    permission: "dangerous",
    category: "process",
    searchHint: "execute shell command run script terminal",
    maxResultChars: 100_000,
  },
  web_search: {
    permission: "low",
    category: "web",
    searchHint: "search internet query online information",
    maxResultChars: 20_000,
  },
  web_fetch: {
    permission: "low",
    category: "web",
    searchHint: "fetch url page content scrape",
    maxResultChars: 50_000,
  },
  file_read: {
    permission: "none",
    category: "file",
    searchHint: "read file content open view",
    maxResultChars: 50_000,
  },
  file_write: {
    permission: "high",
    category: "file",
    searchHint: "write create file content save",
  },
  file_edit: {
    permission: "high",
    category: "file",
    searchHint: "edit modify patch replace text",
  },
  glob: {
    permission: "none",
    category: "file",
    searchHint: "find files pattern match search filesystem",
    maxResultChars: 20_000,
  },
  grep: {
    permission: "none",
    category: "file",
    searchHint: "search content text regex find in files",
    maxResultChars: 30_000,
  },
  list_dir: {
    permission: "none",
    category: "file",
    searchHint: "list directory ls files folder",
    maxResultChars: 10_000,
  },
  browser_open: {
    permission: "medium",
    category: "web",
    searchHint: "open browser url link",
  },
  todo_write: {
    permission: "none",
    category: "task",
    searchHint: "manage tasks todo list checklist",
  },
  memory_write: {
    permission: "low",
    category: "memory",
    searchHint: "save remember persist preferences",
  },
  memory_read: {
    permission: "none",
    category: "memory",
    searchHint: "recall remember history preferences",
  },
  diff_view: {
    permission: "none",
    category: "meta",
    searchHint: "diff changes modifications history",
  },
  undo: {
    permission: "high",
    category: "meta",
    searchHint: "revert undo rollback restore",
  },
  project_detect: {
    permission: "none",
    category: "meta",
    searchHint: "detect project type language framework",
  },
  agent_spawn: {
    permission: "medium",
    category: "agent",
    searchHint: "spawn sub-agent child task delegate",
  },
  notebook_edit: {
    permission: "high",
    category: "notebook",
    searchHint: "jupyter notebook ipynb cell edit",
  },
};

// ═══════════ Register legacy tools into the registry ═══════════

function registerLegacyTools(): void {
  for (const def of TOOL_DEFINITIONS) {
    const fn = def.function;
    const required = Array.isArray((fn.parameters as Record<string, unknown>).required)
      ? (fn.parameters as Record<string, unknown>).required as string[]
      : [];
    const meta = LEGACY_META[fn.name] ?? { permission: "low" as PermissionLevel, category: "meta" as ToolCategory, searchHint: "" };
    const legacyDef: ToolDefinition = {
      name: fn.name,
      description: fn.description,
      inputSchema: fn.parameters,
      execute: (a) => executeTool(fn.name, a),
      permission: meta.permission,
      category: meta.category,
      searchHint: meta.searchHint,
      maxResultChars: meta.maxResultChars,
      validate: (a) => {
        for (const r of required) {
          if (a[r] === undefined || a[r] === null || a[r] === "") {
            return { valid: false, error: `Missing required parameter: ${r}` };
          }
        }
        return { valid: true };
      },
    };
    registerTool(legacyDef);
  }
}

registerLegacyTools();

// ═══════════ Unified access (new + legacy) ═══════════

/** All tool definitions in OpenAI format — legacy TOOL_DEFINITIONS + registry new tools merged */
export function getAllToolDefinitions(): OpenAIToolDef[] {
  return getToolsAsOpenAI();
}

// Re-export registry utilities for direct access
export {
  getTool,
  getAllTools,
  searchTools,
  listToolCategories,
  type ToolDefinition,
  type ToolCategory,
  type OpenAIToolDef as RegistryOpenAIToolDef,
} from "./tool-registry";

async function executeWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query || "");
  if (!query) return "❌ 缺少 query 参数";

  try {
    const enOnly = query.replace(/[一-鿿]/g, " ").replace(/\d{4}/g, "")
      .replace(/(news|latest|search|find|today|recent)/gi, "")
      .replace(/\s+/g, " ").trim() || "AI";

    // Use Rust backend web_search command (reqwest with system proxy)
    if (isTauriAvailable()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("web_search", { query: enOnly }) as string;
    }

    return "⚠️ 搜索需要桌面 App 环境";
  } catch (e) {
    return "搜索失败: " + (e instanceof Error ? e.message : String(e));
  }
}
