/**
 * Commander — 命令处理器，解析 slash 命令并生成告警
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/commander.ts
 * Simplified: no external ReadModelSnapshot dependency, works with local stores
 */

import { listTasks, getAllTasks } from "./task-store";

export type AlertLevel = "info" | "warn" | "action-required";
export type AlertRoute = "timeline" | "operator-watch" | "action-queue";

export interface CommanderAlert {
  level: AlertLevel;
  code: string;
  message: string;
  route: AlertRoute;
}

export interface SlashCommand {
  name: string;
  args: string[];
  raw: string;
}

export interface CommandResult {
  ok: boolean;
  output: string;
  data?: unknown;
}

type CommandHandler = (args: string[]) => CommandResult;

const commandRegistry = new Map<string, CommandHandler>();

export function registerCommand(name: string, handler: CommandHandler): void {
  commandRegistry.set(name.toLowerCase(), handler);
}

export function unregisterCommand(name: string): boolean {
  return commandRegistry.delete(name.toLowerCase());
}

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  if (!name) return null;

  return {
    name,
    args: parts.slice(1),
    raw: trimmed,
  };
}

export function executeCommand(input: string): CommandResult {
  const cmd = parseSlashCommand(input);
  if (!cmd) {
    return { ok: false, output: "Not a valid slash command." };
  }

  const handler = commandRegistry.get(cmd.name);
  if (!handler) {
    return { ok: false, output: `Unknown command: /${cmd.name}` };
  }

  try {
    return handler(cmd.args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Command execution failed.";
    return { ok: false, output: msg };
  }
}

export function commanderAlerts(): CommanderAlert[] {
  const alerts: CommanderAlert[] = [];
  const allTasks = getAllTasks();

  const blocked = allTasks.filter(t => t.status === "blocked");
  if (blocked.length > 0) {
    alerts.push({
      level: "warn",
      code: "HAS_BLOCKED",
      message: `${blocked.length} task(s) are blocked.`,
      route: routeForLevel("warn"),
    });
  }

  const now = Date.now();
  const overdue = allTasks.filter(t => {
    if (!t.dueAt || t.status === "done") return false;
    return Date.parse(t.dueAt) <= now;
  });
  if (overdue.length > 0) {
    alerts.push({
      level: "action-required",
      code: "HAS_TASKS_DUE",
      message: `${overdue.length} task(s) are overdue.`,
      route: routeForLevel("action-required"),
    });
  }

  if (allTasks.length === 0) {
    alerts.push({
      level: "info",
      code: "NO_TASKS",
      message: "No tasks in the store.",
      route: routeForLevel("info"),
    });
  }

  return alerts;
}

function routeForLevel(level: AlertLevel): AlertRoute {
  if (level === "action-required") return "action-queue";
  if (level === "warn") return "operator-watch";
  return "timeline";
}

registerCommand("status", () => {
  const tasks = listTasks();
  const byStatus = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }
  const lines = [
    `Tasks: ${tasks.length} total`,
    `  todo: ${byStatus.todo}`,
    `  in_progress: ${byStatus.in_progress}`,
    `  blocked: ${byStatus.blocked}`,
    `  done: ${byStatus.done}`,
  ];
  return { ok: true, output: lines.join("\n"), data: byStatus };
});

registerCommand("help", () => {
  const names = [...commandRegistry.keys()].sort();
  return {
    ok: true,
    output: `Available commands: ${names.map(n => `/${n}`).join(", ")}`,
  };
});

registerCommand("alerts", () => {
  const alerts = commanderAlerts();
  if (alerts.length === 0) {
    return { ok: true, output: "No alerts." };
  }
  const lines = alerts.map(a => `[${a.level}] ${a.code}: ${a.message}`);
  return { ok: true, output: lines.join("\n"), data: alerts };
});
