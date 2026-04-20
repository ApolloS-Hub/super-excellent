import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
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
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "task",
  searchHint: "manage tasks todo list checklist",
};

// ═══════════ Todo / Task System ═══════════

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

const PRIORITY_ICONS: Record<TaskPriority, string> = { high: "\uD83D\uDD34", medium: "\uD83D\uDFE1", low: "\uD83D\uDFE2" };
const STATUS_ICONS: Record<TaskStatus, string> = { pending: "\u2B1C", in_progress: "\uD83D\uDD04", completed: "\u2705", blocked: "\uD83D\uDEAB" };

function resolveBlockedTasks(): void {
  const completedIds = new Set(taskList.filter(tk => tk.status === "completed").map(tk => tk.id));
  for (const task of taskList) {
    if (task.status === "blocked" && task.blockedBy.every(id => completedIds.has(id))) {
      task.status = "pending";
      task.updatedAt = Date.now();
    }
  }
}

function formatTaskDetail(task: Task, t: TranslateFn): string {
  const deps = task.blockedBy.length > 0 ? `\n  ${t("tools.taskDependsOn")}: ${task.blockedBy.join(", ")}` : "";
  const desc = task.description ? `\n  ${t("tools.taskDescription")}: ${task.description}` : "";
  return `\uD83D\uDCCC [${task.id}] ${task.subject}\n  ${t("tools.taskStatusLabel")}: ${STATUS_ICONS[task.status]} ${task.status} | ${t("tools.taskPriorityLabel")}: ${PRIORITY_ICONS[task.priority]} ${task.priority}${deps}${desc}\n  ${t("tools.taskCreated")}: ${new Date(task.createdAt).toLocaleString()} | ${t("tools.taskUpdated")}: ${new Date(task.updatedAt).toLocaleString()}`;
}

function formatTodoList(t: TranslateFn): string {
  if (taskList.length === 0) return `\uD83D\uDCCB ${t("tools.todoListEmpty")}`;
  const completed = taskList.filter(tk => tk.status === "completed").length;
  const sorted = [...taskList].sort((a, b) => {
    const pOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
    const sOrder: Record<TaskStatus, number> = { in_progress: 0, pending: 1, blocked: 2, completed: 3 };
    const sd = sOrder[a.status] - sOrder[b.status];
    return sd !== 0 ? sd : pOrder[a.priority] - pOrder[b.priority];
  });
  let out = `\uD83D\uDCCB ${t("tools.todoListTitle", { completed, total: taskList.length })}\n`;
  for (const tk of sorted) {
    const deps = tk.blockedBy.length > 0 ? ` \u26D3\uFE0F[${tk.blockedBy.join(",")}]` : "";
    out += `${STATUS_ICONS[tk.status]} ${PRIORITY_ICONS[tk.priority]} [${tk.id}] ${tk.subject}${deps}\n`;
  }
  return out;
}

export function execute(args: Record<string, unknown>, t: TranslateFn): string {
  const action = String(args.action || "list");
  const item = String(args.item || "");
  const taskId = String(args.id || "");
  const priority = (args.priority as TaskPriority) || "medium";
  const blockedBy = Array.isArray(args.blocked_by) ? args.blocked_by.map(String) : [];
  const description = String(args.description || "");

  switch (action) {
    case "add": {
      if (!item) return `\u274C ${t("tools.todoProvideContent")}`;
      const id = generateTaskId();
      const status: TaskStatus = blockedBy.length > 0 ? "blocked" : "pending";
      taskList.push({
        id, subject: item, description, priority, status,
        blockedBy, createdAt: Date.now(), updatedAt: Date.now(),
      });
      return `\u2705 ${t("tools.todoCreated", { id, item })}\n\n${formatTodoList(t)}`;
    }
    case "done": {
      const target = taskId
        ? taskList.find(tk => tk.id === taskId)
        : taskList.find(tk => tk.subject.includes(item) && tk.status !== "completed");
      if (!target) return `\u274C ${t("tools.todoNotFoundIncomplete", { query: taskId || item })}`;
      target.status = "completed";
      target.updatedAt = Date.now();
      resolveBlockedTasks();
      return `\u2705 ${t("tools.todoDone", { id: target.id, subject: target.subject })}\n\n${formatTodoList(t)}`;
    }
    case "update": {
      const task = taskList.find(tk => tk.id === taskId);
      if (!task) return `\u274C ${t("tools.todoNotFound", { id: taskId })}`;
      if (args.status) task.status = args.status as TaskStatus;
      if (args.priority) task.priority = args.priority as TaskPriority;
      if (item) task.subject = item;
      if (description) task.description = description;
      if (blockedBy.length > 0) task.blockedBy = blockedBy;
      task.updatedAt = Date.now();
      resolveBlockedTasks();
      return `\u2705 ${t("tools.todoUpdated", { id: task.id })}\n\n${formatTodoList(t)}`;
    }
    case "get": {
      const found = taskList.find(tk => tk.id === taskId);
      if (!found) return `\u274C ${t("tools.todoNotFound", { id: taskId })}`;
      return formatTaskDetail(found, t);
    }
    case "remove": {
      const before = taskList.length;
      taskList = taskList.filter(tk =>
        taskId ? tk.id !== taskId : !tk.subject.includes(item),
      );
      resolveBlockedTasks();
      return `\u2705 ${t("tools.todoRemoved", { count: before - taskList.length })}\n\n${formatTodoList(t)}`;
    }
    case "clear":
      taskList = [];
      taskIdCounter = 1;
      return `\u2705 ${t("tools.todoCleared")}`;
    case "list":
    default:
      return formatTodoList(t);
  }
}
