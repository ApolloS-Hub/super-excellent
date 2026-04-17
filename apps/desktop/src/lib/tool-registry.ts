/**
 * Tool Registry — dynamic tool registration, lookup, and OpenAI format conversion.
 * Inspired by Claude Code's Tool.ts / tools.ts architecture.
 */
import {
  createTask as tsCreateTask,
  updateTaskStatus as tsUpdateStatus,
  deleteTask as tsDeleteTask,
} from "./runtime/task-store";

// ═══════════ Types ═══════════

export type PermissionLevel = "none" | "low" | "medium" | "high" | "dangerous";

/** Logical grouping of tools — mirrors Claude Code tool categories */
export type ToolCategory =
  | "file"      // file read/write/edit/glob/grep/list
  | "web"       // web_search / web_fetch / browser_open
  | "process"   // bash / shell execution
  | "task"      // todo_write / task_create / task_list / task_update
  | "memory"    // memory_write / memory_read
  | "agent"     // agent_spawn / ask_user / plan mode
  | "notebook"  // notebook_edit
  | "meta";     // tool_search / sleep / diff_view / undo / project_detect

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export type ProgressCallback = (data: { percent?: number; message?: string }) => void;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
  permission?: PermissionLevel;
  maxResultChars?: number;
  searchHint?: string;
  category?: ToolCategory;
  validate?: (args: Record<string, unknown>) => ValidationResult;
  progress?: (callback: ProgressCallback) => void;
}

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ═══════════ Registry ═══════════

const registry = new Map<string, ToolDefinition>();

export function registerTool(def: ToolDefinition): void {
  registry.set(def.name, def);
}

export function unregisterTool(name: string): void {
  registry.delete(name);
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

export function getToolsAsOpenAI(): OpenAIToolDef[] {
  return getAllTools().map(def => ({
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }));
}

export function listToolCategories(): ToolCategory[] {
  const cats = new Set<ToolCategory>();
  for (const def of registry.values()) {
    if (def.category) cats.add(def.category);
  }
  return Array.from(cats).sort();
}

export interface SearchToolsOptions {
  category?: ToolCategory;
  maxResults?: number;
}

export function searchTools(query: string, opts?: SearchToolsOptions): ToolDefinition[] {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  let candidates = getAllTools();
  if (opts?.category) {
    candidates = candidates.filter(d => d.category === opts.category);
  }

  const results = candidates
    .map(def => {
      let score = 0;
      const haystack = `${def.name} ${def.description} ${def.searchHint ?? ""}`.toLowerCase();
      for (const term of terms) {
        if (def.name.toLowerCase() === term) score += 10;
        else if (def.name.toLowerCase().includes(term)) score += 5;
        else if (haystack.includes(term)) score += 2;
      }
      return { def, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.def);

  return opts?.maxResults ? results.slice(0, opts.maxResults) : results;
}

// ═══════════ Validation helper ═══════════

function validateRequired(args: Record<string, unknown>, fields: string[]): ValidationResult {
  for (const f of fields) {
    if (args[f] === undefined || args[f] === null || args[f] === "") {
      return { valid: false, error: `Missing required parameter: ${f}` };
    }
  }
  return { valid: true };
}

// ═══════════ Plan mode state ═══════════

let planModeActive = false;

export function isPlanMode(): boolean {
  return planModeActive;
}

const _planModeListeners = new Set<(active: boolean) => void>();

export function onPlanModeChange(fn: (active: boolean) => void): () => void {
  _planModeListeners.add(fn);
  return () => { _planModeListeners.delete(fn); };
}

function setPlanMode(active: boolean): void {
  planModeActive = active;
  for (const fn of _planModeListeners) {
    try { fn(active); } catch { /* ignore */ }
  }
}

// ═══════════ ask_user handler ═══════════

type AskUserHandler = (question: string, options: string[], multiSelect: boolean) => Promise<string>;
let _askUserHandler: AskUserHandler | null = null;

export function setAskUserHandler(fn: AskUserHandler): void {
  _askUserHandler = fn;
}

// ═══════════ Progress emitter ═══════════

type ProgressEmitter = (toolName: string, data: { percent?: number; message?: string }) => void;
let _progressEmitter: ProgressEmitter | null = null;

export function setProgressEmitter(fn: ProgressEmitter): void {
  _progressEmitter = fn;
}

// ═══════════ Task system (lightweight, CC-aligned) ═══════════

type CCTaskStatus = "pending" | "in_progress" | "completed" | "deleted";
type CCTaskPriority = "high" | "medium" | "low";

interface CCTask {
  id: string;
  subject: string;
  description: string;
  priority: CCTaskPriority;
  status: CCTaskStatus;
  blockedBy: string[];
  blocks: string[];
  owner: string;
  createdAt: number;
  updatedAt: number;
}

const ccTasks = new Map<string, CCTask>();
let ccTaskCounter = 0;

function nextTaskId(): string {
  return String(++ccTaskCounter);
}

const STATUS_EMOJI: Record<CCTaskStatus, string> = {
  pending: "⬜",
  in_progress: "🔄",
  completed: "✅",
  deleted: "🗑️",
};

const PRIORITY_EMOJI: Record<CCTaskPriority, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

function formatCCTaskSummary(t: CCTask): string {
  const blocked = t.blockedBy.length > 0 ? ` ⛓️[${t.blockedBy.join(",")}]` : "";
  return `${STATUS_EMOJI[t.status]} ${PRIORITY_EMOJI[t.priority]} [${t.id}] ${t.subject}${blocked}`;
}

function formatCCTaskDetail(t: CCTask): string {
  const lines = [
    `📌 Task [${t.id}]: ${t.subject}`,
    `  Status: ${STATUS_EMOJI[t.status]} ${t.status}`,
    `  Priority: ${PRIORITY_EMOJI[t.priority]} ${t.priority}`,
    `  Owner: ${t.owner}`,
  ];
  if (t.description) lines.push(`  Description: ${t.description}`);
  if (t.blockedBy.length > 0) lines.push(`  Blocked by: ${t.blockedBy.join(", ")}`);
  if (t.blocks.length > 0) lines.push(`  Blocks: ${t.blocks.join(", ")}`);
  lines.push(`  Created: ${new Date(t.createdAt).toLocaleString()}`);
  lines.push(`  Updated: ${new Date(t.updatedAt).toLocaleString()}`);
  return lines.join("\n");
}

function listCCTasks(): string {
  const all = Array.from(ccTasks.values()).filter(t => t.status !== "deleted");
  if (all.length === 0) return "📋 No tasks.";
  const completed = all.filter(t => t.status === "completed").length;
  const sorted = [...all].sort((a, b) => {
    const sOrder: Record<CCTaskStatus, number> = { in_progress: 0, pending: 1, completed: 2, deleted: 3 };
    const pOrder: Record<CCTaskPriority, number> = { high: 0, medium: 1, low: 2 };
    const sd = sOrder[a.status] - sOrder[b.status];
    return sd !== 0 ? sd : pOrder[a.priority] - pOrder[b.priority];
  });
  let out = `📋 Tasks (${completed}/${all.length} completed)\n`;
  for (const t of sorted) out += formatCCTaskSummary(t) + "\n";
  return out.trimEnd();
}

// ═══════════ Built-in tools ═══════════

const askUserTool: ToolDefinition = {
  name: "ask_user",
  description: "Ask the user a question to gather information, clarify ambiguity, or get decisions. Returns the question text for the user to answer.",
  searchHint: "question clarify user input prompt",
  category: "agent",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to ask the user" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional multiple-choice options",
      },
      multi_select: {
        type: "boolean",
        description: "Allow multiple answers (default false)",
      },
    },
    required: ["question"],
  },
  permission: "none",
  validate: (args) => validateRequired(args, ["question"]),
  execute: async (args) => {
    const question = String(args.question);
    const options = Array.isArray(args.options) ? args.options.map(String) : [];
    const multiSelect = args.multi_select === true;

    if (_askUserHandler) {
      const answer = await _askUserHandler(question, options, multiSelect);
      return `❓ ${question}\n\n用户回答: ${answer}`;
    }

    // Fallback when no UI handler is registered
    if (options.length > 0) {
      const numbered = options.map((o, i) => `  ${i + 1}. ${o}`).join("\n");
      return `❓ ${question}\n\nOptions:\n${numbered}\n\n(Waiting for user response...)`;
    }
    return `❓ ${question}\n\n(Waiting for user response...)`;
  },
};

const enterPlanModeTool: ToolDefinition = {
  name: "enter_plan_mode",
  description: "Transition into plan mode for non-trivial implementation tasks. In plan mode, explore the codebase and design an approach before writing code.",
  searchHint: "planning design approach architecture",
  category: "agent",
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why plan mode is needed" },
    },
    required: [],
  },
  permission: "none",
  execute: async (args) => {
    if (planModeActive) return "⚠️ Already in plan mode.";
    setPlanMode(true);
    const reason = args.reason ? String(args.reason) : "Non-trivial task";
    return `📐 Entered plan mode.\nReason: ${reason}\n\nIn plan mode you should:\n1. Explore the codebase (read, grep, glob)\n2. Design an implementation approach\n3. Present the plan for approval\n4. Use exit_plan_mode when ready to implement`;
  },
};

const exitPlanModeTool: ToolDefinition = {
  name: "exit_plan_mode",
  description: "Exit plan mode and signal that the plan is ready for user approval. Use after writing the plan.",
  searchHint: "plan approval implement execute",
  category: "agent",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Brief summary of the plan" },
    },
    required: [],
  },
  permission: "none",
  execute: async (args) => {
    if (!planModeActive) return "⚠️ Not in plan mode.";
    setPlanMode(false);
    const summary = args.summary ? String(args.summary) : "Plan completed";
    return `✅ Exited plan mode.\nSummary: ${summary}\n\nReady for implementation.`;
  },
};

const taskCreateTool: ToolDefinition = {
  name: "task_create",
  description: "Create a structured task for tracking progress. Use for complex multi-step work.",
  searchHint: "create task todo item tracking progress",
  category: "task",
  inputSchema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Brief, actionable title in imperative form" },
      description: { type: "string", description: "Detailed requirements and context" },
      priority: { type: "string", enum: ["high", "medium", "low"], description: "Task priority (default: medium)" },
      blocked_by: {
        type: "array",
        items: { type: "string" },
        description: "IDs of tasks that must complete before this one",
      },
    },
    required: ["subject"],
  },
  permission: "none",
  validate: (args) => validateRequired(args, ["subject"]),
  execute: async (args) => {
    const id = nextTaskId();
    const blockedBy = Array.isArray(args.blocked_by) ? args.blocked_by.map(String) : [];
    const priority = (args.priority as CCTaskPriority) || "medium";
    const now = Date.now();
    const task: CCTask = {
      id,
      subject: String(args.subject),
      description: String(args.description ?? ""),
      priority,
      status: "pending",
      blockedBy,
      blocks: [],
      owner: "",
      createdAt: now,
      updatedAt: now,
    };
    ccTasks.set(id, task);
    for (const depId of blockedBy) {
      const dep = ccTasks.get(depId);
      if (dep && !dep.blocks.includes(id)) dep.blocks.push(id);
    }
    // Mirror to task-store so Monitor + /tasks see it
    try {
      tsCreateTask({
        projectId: "registry",
        taskId: id,
        title: task.subject,
        status: "todo",
        owner: "agent",
        definitionOfDone: task.description ? [task.description] : [],
      });
    } catch { /* taskId collision — already exists */ }
    return `✅ Created task [${id}]: ${task.subject}\n\n${listCCTasks()}`;
  },
};

const taskGetTool: ToolDefinition = {
  name: "task_get",
  description: "Get full details of a task by its ID.",
  searchHint: "get task detail status",
  category: "task",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID" },
    },
    required: ["task_id"],
  },
  permission: "none",
  validate: (args) => validateRequired(args, ["task_id"]),
  execute: async (args) => {
    const task = ccTasks.get(String(args.task_id));
    if (!task) return `❌ Task not found: ${args.task_id}`;
    return formatCCTaskDetail(task);
  },
};

const taskListTool: ToolDefinition = {
  name: "task_list",
  description: "List all tasks with their status, priority, and dependencies.",
  searchHint: "list tasks todo progress overview",
  category: "task",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "in_progress", "completed", "all"], description: "Filter by status (default: all)" },
    },
    required: [],
  },
  permission: "none",
  execute: async (args) => {
    const filter = args.status ? String(args.status) : "all";
    if (filter === "all") return listCCTasks();
    const all = Array.from(ccTasks.values()).filter(t => t.status === filter);
    if (all.length === 0) return `📋 No ${filter} tasks.`;
    let out = `📋 ${filter} tasks (${all.length})\n`;
    for (const t of all) out += formatCCTaskSummary(t) + "\n";
    return out.trimEnd();
  },
};

const taskUpdateTool: ToolDefinition = {
  name: "task_update",
  description: "Update a task's status, subject, description, or dependencies.",
  searchHint: "update task status complete progress",
  category: "task",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID to update" },
      status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"], description: "New status" },
      subject: { type: "string", description: "New subject" },
      description: { type: "string", description: "New description" },
      owner: { type: "string", description: "Task owner" },
      add_blocked_by: { type: "array", items: { type: "string" }, description: "Add dependency task IDs" },
    },
    required: ["task_id"],
  },
  permission: "none",
  validate: (args) => validateRequired(args, ["task_id"]),
  execute: async (args) => {
    const task = ccTasks.get(String(args.task_id));
    if (!task) return `❌ Task not found: ${args.task_id}`;

    if (args.status !== undefined) task.status = args.status as CCTaskStatus;
    if (args.subject !== undefined) task.subject = String(args.subject);
    if (args.description !== undefined) task.description = String(args.description);
    if (args.owner !== undefined) task.owner = String(args.owner);
    if (Array.isArray(args.add_blocked_by)) {
      for (const depId of args.add_blocked_by) {
        const id = String(depId);
        if (!task.blockedBy.includes(id)) task.blockedBy.push(id);
        const dep = ccTasks.get(id);
        if (dep && !dep.blocks.includes(task.id)) dep.blocks.push(task.id);
      }
    }
    task.updatedAt = Date.now();

    if (task.status === "deleted") {
      ccTasks.delete(task.id);
      try { tsDeleteTask(task.id, "registry"); } catch { /* already gone */ }
      return `🗑️ Deleted task [${task.id}]\n\n${listCCTasks()}`;
    }

    // Mirror status to task-store
    const statusMap: Record<CCTaskStatus, import("./runtime/task-store").TaskState> = {
      pending: "todo", in_progress: "in_progress", completed: "done", deleted: "done",
    };
    try { tsUpdateStatus(task.id, statusMap[task.status], "registry"); } catch { /* not mirrored */ }

    return `✅ Updated task [${task.id}]\n\n${listCCTasks()}`;
  },
};

const taskStopTool: ToolDefinition = {
  name: "task_stop",
  description: "Stop a running background task by its ID.",
  searchHint: "stop cancel terminate background task",
  category: "task",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID to stop" },
    },
    required: ["task_id"],
  },
  permission: "none",
  validate: (args) => validateRequired(args, ["task_id"]),
  execute: async (args) => {
    const task = ccTasks.get(String(args.task_id));
    if (!task) return `❌ Task not found: ${args.task_id}`;
    if (task.status === "completed") return `⚠️ Task [${task.id}] is already completed.`;
    if (task.status === "deleted") return `⚠️ Task [${task.id}] is already deleted.`;
    task.status = "completed";
    task.updatedAt = Date.now();
    try { tsUpdateStatus(task.id, "done", "registry"); } catch { /* not mirrored */ }
    return `⏹️ Stopped task [${task.id}]: ${task.subject}`;
  },
};

const sleepTool: ToolDefinition = {
  name: "sleep",
  description: "Wait for a specified duration in milliseconds. Prefer this over bash sleep.",
  searchHint: "wait pause delay timer rest",
  category: "meta",
  inputSchema: {
    type: "object",
    properties: {
      duration_ms: { type: "number", description: "Duration to sleep in milliseconds (max 300000)" },
    },
    required: ["duration_ms"],
  },
  permission: "none",
  validate: (args) => {
    const result = validateRequired(args, ["duration_ms"]);
    if (!result.valid) return result;
    const ms = Number(args.duration_ms);
    if (isNaN(ms) || ms < 0) return { valid: false, error: "duration_ms must be a non-negative number" };
    if (ms > 300_000) return { valid: false, error: "duration_ms max is 300000 (5 minutes)" };
    return { valid: true };
  },
  execute: async (args) => {
    const ms = Math.min(Math.max(0, Number(args.duration_ms)), 300_000);
    await new Promise<void>(resolve => { setTimeout(resolve, ms); });
    return `⏱️ Slept for ${ms}ms.`;
  },
};

const toolSearchTool: ToolDefinition = {
  name: "tool_search",
  description: "Search available tools by keyword, name, or category. Returns matching tools with descriptions, permission level, and search hints.",
  searchHint: "find discover lookup available tools",
  category: "meta",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query — keyword or tool name" },
      max_results: { type: "number", description: "Max results to return (default 10)" },
      category: {
        type: "string",
        enum: ["file", "web", "process", "task", "memory", "agent", "notebook", "meta"],
        description: "Filter by tool category (optional)",
      },
    },
    required: ["query"],
  },
  permission: "none",
  validate: (args) => validateRequired(args, ["query"]),
  execute: async (args) => {
    const query = String(args.query);
    const max = typeof args.max_results === "number" ? args.max_results : 10;
    const categoryFilter = args.category ? (String(args.category) as ToolCategory) : undefined;

    const results = searchTools(query, { category: categoryFilter, maxResults: max });
    if (results.length === 0) {
      const catClause = categoryFilter ? ` in category "${categoryFilter}"` : "";
      return `🔍 No tools found for query: "${query}"${catClause}`;
    }

    const catHeader = categoryFilter ? ` (category: ${categoryFilter})` : "";
    let out = `🔍 Found ${results.length} tool(s) for "${query}"${catHeader}:\n\n`;
    for (const t of results) {
      const perm = t.permission && t.permission !== "none" ? ` [${t.permission}]` : "";
      const cat = t.category ? ` [${t.category}]` : "";
      out += `• **${t.name}**${cat}${perm} — ${t.description}\n`;
      if (t.searchHint) out += `  hints: ${t.searchHint}\n`;
    }

    // When query is "*" or "all", also show category summary
    if (query === "*" || query === "all" || query === "list") {
      const cats = listToolCategories();
      out += `\nCategories: ${cats.join(", ")}`;
    }

    return out.trimEnd();
  },
};

// ═══════════ Register all built-in new tools ═══════════

const BUILTIN_NEW_TOOLS: ToolDefinition[] = [
  askUserTool,
  enterPlanModeTool,
  exitPlanModeTool,
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
  taskStopTool,
  sleepTool,
  toolSearchTool,
];

for (const tool of BUILTIN_NEW_TOOLS) {
  registerTool(tool);
}

// ═══════════ Execute through registry (with validation) ═══════════

/**
 * Unified tool execution result — used by executeTool() wrapper.
 * Consistent shape regardless of whether execution succeeded, validated, or errored.
 */
export interface ToolExecutionResult {
  /** Was this tool found and handled? */
  handled: boolean;
  /** Did execution succeed (no exception)? */
  success: boolean;
  /** Textual result (truncated if oversized) */
  result: string;
  /** Execution time in ms */
  durationMs: number;
  /** If truncated, how many chars were cut */
  truncatedChars?: number;
  /** Error category if failed */
  errorCategory?: "validation" | "timeout" | "not_found" | "runtime";
}

export async function executeRegistryTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ handled: boolean; result: string }> {
  const full = await executeRegistryToolFull(name, args);
  return { handled: full.handled, result: full.result };
}

/**
 * Full execution with structured result (timing, error classification, truncation metadata).
 * Use this in places that need to display status to the user or log telemetry.
 */
export async function executeRegistryToolFull(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const tool = getTool(name);
  if (!tool) {
    return {
      handled: false,
      success: false,
      result: "",
      durationMs: 0,
      errorCategory: "not_found",
    };
  }

  if (tool.validate) {
    const validation = tool.validate(args);
    if (!validation.valid) {
      return {
        handled: true,
        success: false,
        result: `❌ Validation error: ${validation.error}`,
        durationMs: Date.now() - startedAt,
        errorCategory: "validation",
      };
    }
  }

  if (tool.progress && _progressEmitter) {
    tool.progress((data) => { _progressEmitter!(name, data); });
  }

  try {
    const result = await tool.execute(args);
    const durationMs = Date.now() - startedAt;

    if (tool.maxResultChars && result.length > tool.maxResultChars) {
      const half = Math.floor(tool.maxResultChars / 2);
      const truncatedChars = result.length - tool.maxResultChars;
      return {
        handled: true,
        success: true,
        result: `${result.slice(0, half)}\n\n... [truncated ${truncatedChars} chars] ...\n\n${result.slice(-half)}`,
        durationMs,
        truncatedChars,
      };
    }

    return { handled: true, success: true, result, durationMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes("timeout");
    return {
      handled: true,
      success: false,
      result: `❌ ${msg}`,
      durationMs: Date.now() - startedAt,
      errorCategory: isTimeout ? "timeout" : "runtime",
    };
  }
}
