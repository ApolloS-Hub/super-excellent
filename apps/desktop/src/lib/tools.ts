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
import i18n from "../i18n";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

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
      description: t("tools.webSearchDesc"),
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: t("tools.webSearchQuery") },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: t("tools.webFetchDesc"),
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: t("tools.webFetchUrl") },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: t("tools.bashDesc"),
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: t("tools.bashCommand") },
          timeout: { type: "number", description: t("tools.bashTimeout") },
          truncate_output: { type: "number", description: t("tools.bashTruncate") },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_read",
      description: t("tools.fileReadDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
          offset: { type: "number", description: t("tools.fileReadOffset") },
          limit: { type: "number", description: t("tools.fileReadLimit") },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: t("tools.fileWriteDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
          content: { type: "string", description: t("tools.fileWriteContent") },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_edit",
      description: t("tools.fileEditDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
          old_text: { type: "string", description: t("tools.fileEditOldText") },
          new_text: { type: "string", description: t("tools.fileEditNewText") },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: t("tools.globDesc"),
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: t("tools.globPattern") },
          path: { type: "string", description: t("tools.searchRootDir") },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: t("tools.grepDesc"),
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: t("tools.grepPattern") },
          path: { type: "string", description: t("tools.grepPath") },
          include: { type: "string", description: t("tools.grepInclude") },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: t("tools.listDirDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.dirPath") },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_open",
      description: t("tools.browserOpenDesc"),
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: t("tools.browserOpenUrl") },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_write",
      description: t("tools.todoWriteDesc"),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "add", "done", "remove", "clear", "update", "get"],
            description: t("tools.todoAction"),
          },
          item: { type: "string", description: t("tools.todoItem") },
          id: { type: "string", description: t("tools.todoId") },
          priority: { type: "string", enum: ["high", "medium", "low"], description: t("tools.todoPriority") },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "blocked"],
            description: t("tools.todoStatus"),
          },
          blocked_by: {
            type: "array",
            items: { type: "string" },
            description: t("tools.todoBlockedBy"),
          },
          description: { type: "string", description: t("tools.todoDescription") },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: t("tools.memoryWriteDesc"),
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: t("tools.memoryWriteContent") },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_read",
      description: t("tools.memoryReadDesc"),
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_view",
      description: t("tools.diffViewDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo",
      description: t("tools.undoDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.undoPath") },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_detect",
      description: t("tools.projectDetectDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.projectDetectPath") },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_spawn",
      description: t("tools.agentSpawnDesc"),
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: t("tools.agentSpawnPrompt") },
          name: { type: "string", description: t("tools.agentSpawnName") },
          description: { type: "string", description: t("tools.agentSpawnDescription") },
          allowed_tools: {
            type: "array",
            items: { type: "string" },
            description: t("tools.agentSpawnAllowedTools"),
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
      description: t("tools.notebookEditDesc"),
      parameters: {
        type: "object",
        properties: {
          notebook_path: { type: "string", description: t("tools.notebookEditPath") },
          cell_id: { type: "string", description: t("tools.notebookEditCellId") },
          new_source: { type: "string", description: t("tools.notebookEditNewSource") },
          cell_type: { type: "string", enum: ["code", "markdown"], description: t("tools.notebookEditCellType") },
          edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: t("tools.notebookEditMode") },
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
  const completedIds = new Set(taskList.filter(tk => tk.status === "completed").map(tk => tk.id));
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
      if (!item) return `❌ ${t("tools.todoProvideContent")}`;
      const id = generateTaskId();
      const status: TaskStatus = blockedBy.length > 0 ? "blocked" : "pending";
      taskList.push({
        id, subject: item, description, priority, status,
        blockedBy, createdAt: Date.now(), updatedAt: Date.now(),
      });
      return `✅ ${t("tools.todoCreated", { id, item })}\n\n${formatTodoList()}`;
    }
    case "done": {
      const target = taskId
        ? taskList.find(tk => tk.id === taskId)
        : taskList.find(tk => tk.subject.includes(item) && tk.status !== "completed");
      if (!target) return `❌ ${t("tools.todoNotFoundIncomplete", { query: taskId || item })}`;
      target.status = "completed";
      target.updatedAt = Date.now();
      resolveBlockedTasks();
      return `✅ ${t("tools.todoDone", { id: target.id, subject: target.subject })}\n\n${formatTodoList()}`;
    }
    case "update": {
      const task = taskList.find(tk => tk.id === taskId);
      if (!task) return `❌ ${t("tools.todoNotFound", { id: taskId })}`;
      if (args.status) task.status = args.status as TaskStatus;
      if (args.priority) task.priority = args.priority as TaskPriority;
      if (item) task.subject = item;
      if (description) task.description = description;
      if (blockedBy.length > 0) task.blockedBy = blockedBy;
      task.updatedAt = Date.now();
      resolveBlockedTasks();
      return `✅ ${t("tools.todoUpdated", { id: task.id })}\n\n${formatTodoList()}`;
    }
    case "get": {
      const found = taskList.find(tk => tk.id === taskId);
      if (!found) return `❌ ${t("tools.todoNotFound", { id: taskId })}`;
      return formatTaskDetail(found);
    }
    case "remove": {
      const before = taskList.length;
      taskList = taskList.filter(tk =>
        taskId ? tk.id !== taskId : !tk.subject.includes(item),
      );
      resolveBlockedTasks();
      return `✅ ${t("tools.todoRemoved", { count: before - taskList.length })}\n\n${formatTodoList()}`;
    }
    case "clear":
      taskList = [];
      taskIdCounter = 1;
      return `✅ ${t("tools.todoCleared")}`;
    case "list":
    default:
      return formatTodoList();
  }
}

function formatTaskDetail(task: Task): string {
  const deps = task.blockedBy.length > 0 ? `\n  ${t("tools.taskDependsOn")}: ${task.blockedBy.join(", ")}` : "";
  const desc = task.description ? `\n  ${t("tools.taskDescription")}: ${task.description}` : "";
  return `📌 [${task.id}] ${task.subject}\n  ${t("tools.taskStatusLabel")}: ${STATUS_ICONS[task.status]} ${task.status} | ${t("tools.taskPriorityLabel")}: ${PRIORITY_ICONS[task.priority]} ${task.priority}${deps}${desc}\n  ${t("tools.taskCreated")}: ${new Date(task.createdAt).toLocaleString()} | ${t("tools.taskUpdated")}: ${new Date(task.updatedAt).toLocaleString()}`;
}

function formatTodoList(): string {
  if (taskList.length === 0) return `📋 ${t("tools.todoListEmpty")}`;
  const completed = taskList.filter(tk => tk.status === "completed").length;
  const sorted = [...taskList].sort((a, b) => {
    const pOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
    const sOrder: Record<TaskStatus, number> = { in_progress: 0, pending: 1, blocked: 2, completed: 3 };
    const sd = sOrder[a.status] - sOrder[b.status];
    return sd !== 0 ? sd : pOrder[a.priority] - pOrder[b.priority];
  });
  let out = `📋 ${t("tools.todoListTitle", { completed, total: taskList.length })}\n`;
  for (const tk of sorted) {
    const deps = tk.blockedBy.length > 0 ? ` ⛓️[${tk.blockedBy.join(",")}]` : "";
    out += `${STATUS_ICONS[tk.status]} ${PRIORITY_ICONS[tk.priority]} [${tk.id}] ${tk.subject}${deps}\n`;
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
  if (/rm\s/.test(command)) return t("tools.dangerDeleteFiles");
  if (/sudo/.test(command)) return t("tools.dangerSudo");
  if (/git\s+push.*(-f|--force)/.test(command)) return t("tools.dangerForcePush");
  if (/DROP|DELETE|TRUNCATE/i.test(command)) return t("tools.dangerDbDestruct");
  if (/curl.*\|\s*(sh|bash)/.test(command)) return t("tools.dangerRemoteScript");
  return t("tools.dangerPotential");
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
      return `${t("tools.actionExecCommand")}${danger}: ${cmd.slice(0, 150)}`;
    }
    case "file_write":
      return `${t("tools.actionWriteFile")}: ${args.path ?? ""}`;
    case "file_edit":
      return `${t("tools.actionEditFile")}: ${args.path ?? ""}`;
    case "notebook_edit":
      return `${t("tools.actionEditNotebook")}: ${args.notebook_path ?? ""}`;
    case "browser_open":
      return `${t("tools.actionOpenUrl")}: ${args.url ?? ""}`;
    case "agent_spawn":
      return `${t("tools.actionSpawnAgent")}: ${(args.name as string) ?? ""}`;
    case "memory_write":
      return `${t("tools.actionWriteMemory")}: ${(args.content as string)?.slice(0, 80) ?? ""}`;
    default:
      return `${t("tools.actionUseTool")}: ${toolName}`;
  }
}

// ═══════════ Tool Execution ═══════════

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Execute before_tool hooks
  try {
    const { executeHooks } = await import("./hooks");
    const hookResult = await executeHooks("before_tool", { toolName: name, toolInput: args });
    if (hookResult.blocked) {
      return `⛔ ${t("tools.hookBlocked")}: ${hookResult.reason || t("tools.operationBlocked")}`;
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
      const allowed = await permissionCallback("bash", `${desc}\n${t("tools.command")}: ${args.command}`);
      if (!allowed) return `⛔ ${t("tools.userDeniedExec")}: ${desc}`;
    }
  }
  if ((name === "file_write" || name === "file_edit") && typeof args.path === "string") {
    const sensitivePaths = ["/etc/", "/usr/", "/System/", "/bin/", "/sbin/", "~/.ssh/", "~/.config/"];
    if (sensitivePaths.some(p => (args.path as string).startsWith(p))) {
      if (permissionCallback) {
        const allowed = await permissionCallback(name, `${t("tools.writeSensitivePath")}: ${args.path}`);
        if (!allowed) return `⛔ ${t("tools.userDeniedWrite")}: ${args.path}`;
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
    const description = String(args.description || t("tools.subTask"));
    if (!prompt) return `❌ ${t("tools.agentSpawnNoPrompt")}`;
    return `🤖 ${t("tools.agentSpawnStarted", { name: agentName })}\n📝 ${t("tools.taskLabel")}: ${description}\n\n${t("tools.agentSpawnRunning")}\n\n---\n${t("tools.promptLabel")}: ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`;
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
    return `✅ ${t("tools.memorySaved")}`;
  }
  if (name === "memory_read") {
    const { formatMemory } = await import("./memory");
    return formatMemory();
  }
  if (name === "diff_view") {
    const { getFileBackups, formatDiff, computeDiff } = await import("./file-history");
    const backups = getFileBackups(String(args.path || ""));
    if (backups.length === 0) return t("tools.noModificationRecords");
    const last = backups[backups.length - 1];
    return formatDiff(computeDiff(last.originalContent, last.newContent));
  }
  if (name === "undo") {
    const path = String(args.path || "");
    const { getRewindContent } = await import("./file-history");
    const original = getRewindContent(path);
    if (!original) return t("tools.undoNoBackup");
    // Write original content back via Rust
    const tReady = isTauriAvailable();
    if (tReady) {
      const { agentExecuteTool } = await import("./tauri-bridge");
      await agentExecuteTool("Write", { path, content: original });
      return `✅ ${t("tools.undoSuccess", { path })}`;
    }
    return `⚠️ ${t("tools.undoRequiresTauri")}`;
  }
  if (name === "project_detect") {
    const { detectProject, buildProjectPrompt } = await import("./project-context");
    const project = await detectProject(String(args.path || "/tmp"));
    if (!project) return t("tools.noProjectDetected");
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
        return `${t("tools.toolExecFailed", { tool: rustName })}: ${msg}\n\n${t("tools.debugInfo")}:\n- ${t("tools.toolName")}: ${rustName}\n- ${t("tools.toolArgs")}: ${JSON.stringify(args).slice(0, 500)}\n- Tauri: ${tauriReady}`;
      }
    }
  }
  if (!tauriReady) {
    return `⚠️ ${t("tools.tauriNotAvailable")}`;
  }

  // Minimal JS fallbacks (only for dev/browser mode without Tauri)
  if (!isTauriAvailable()) {
    switch (name) {
      case "browser_open":
        return jsBrowserOpen(args.url as string);
      default:
        return `⚠️ ${t("tools.requiresDesktopApp")}`;
    }
  }

  return `${t("tools.unknownTool")}: ${name}`;
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

  if (!notebookPath) return `❌ ${t("tools.notebookProvidePathError")}`;
  if (!notebookPath.endsWith(".ipynb")) return `❌ ${t("tools.notebookMustBeIpynb")}`;

  const tauriReady = isTauriAvailable();
  if (!tauriReady) return `⚠️ ${t("tools.notebookRequiresTauri")}`;

  try {
    const { agentExecuteTool } = await import("./tauri-bridge");
    const raw = await agentExecuteTool("Read", { path: notebookPath });
    const notebook: NotebookContent = JSON.parse(raw);

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return `❌ ${t("tools.notebookInvalidFormat")}`;
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
          if (notebook.cells.length === 0) return `❌ ${t("tools.notebookNoCells")}`;
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
        if (targetIdx < 0) return `❌ ${t("tools.notebookCellNotFound")}`;
        notebook.cells.splice(targetIdx, 1);
        break;
      }
    }

    const updated = JSON.stringify(notebook, null, 1) + "\n";
    await agentExecuteTool("Write", { path: notebookPath, content: updated });

    const modeLabel = editMode === "replace" ? t("tools.notebookReplace") : editMode === "insert" ? t("tools.notebookInsert") : t("tools.notebookDelete");
    const cellLabel = cellId ? `${t("tools.notebookCell")} ${cellId}` : `${t("tools.notebookCell")} ${(targetIdx + 1)}`;
    return `✅ Notebook ${modeLabel}: ${cellLabel} (${cellType})\n${t("tools.pathLabel")}: ${notebookPath}`;
  } catch (e) {
    return `❌ ${t("tools.notebookEditFailed")}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ═══════════ JS Fallback (browser_open only) ═══════════

function jsBrowserOpen(url: string): string {
  try {
    window.open(url, "_blank");
    return `✅ ${t("tools.browserOpened", { url })}`;
  } catch {
    return `${t("tools.browserOpenFailed", { url })}`;
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
  if (!query) return `❌ ${t("tools.missingQueryParam")}`;

  try {
    const enOnly = query.replace(/[一-鿿]/g, " ").replace(/\d{4}/g, "")
      .replace(/(news|latest|search|find|today|recent)/gi, "")
      .replace(/\s+/g, " ").trim() || "AI";

    // Use Rust backend web_search command (reqwest with system proxy)
    if (isTauriAvailable()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("web_search", { query: enOnly }) as string;
    }

    return `⚠️ ${t("tools.searchRequiresDesktop")}`;
  } catch (e) {
    return `${t("tools.searchFailed")}: ` + (e instanceof Error ? e.message : String(e));
  }
}
