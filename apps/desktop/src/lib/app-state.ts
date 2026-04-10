/**
 * AppState — centralized state management
 * Inspired by Claude Code's AppState pattern
 */

import { useState, useEffect, useRef } from "react";
import type { Conversation } from "./conversations";
import type { MCPServer } from "./mcp-client";
import type { PermissionLevel } from "./permission-engine";
import type { ProjectInfo } from "./project-context";

export interface AgentTask {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "blocked";
  parentId?: string;
  subtasks: AgentTask[];
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export interface AppState {
  // UI
  currentPage: "chat" | "settings" | "monitor" | "media" | "skills";
  sidebarOpen: boolean;
  theme: "light" | "dark" | "auto";
  language: string;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;

  // Agent state
  isGenerating: boolean;
  currentModel: string;
  totalCost: number;
  totalTokens: number;

  // Tasks (hierarchical)
  tasks: AgentTask[];
  activeTaskId: string | null;

  // MCP
  mcpServers: MCPServer[];

  // File changes
  fileChanges: Array<{ path: string; action: string; timestamp: number }>;

  // Permission mode (mirrors permission-engine singleton, kept in sync)
  permissionMode: PermissionLevel;

  // Project info (mirrors project-context cache, kept in sync)
  projectInfo: ProjectInfo | null;

  // Memory snapshot (long-term memory text, refreshed on demand)
  memorySnapshot: string;
}

type Listener = (state: AppState) => void;

let state: AppState = {
  currentPage: "chat",
  sidebarOpen: true,
  theme: "auto",
  language: "zh",
  conversations: [],
  activeConversationId: null,
  isGenerating: false,
  currentModel: "",
  totalCost: 0,
  totalTokens: 0,
  tasks: [],
  activeTaskId: null,
  mcpServers: [],
  fileChanges: [],
  permissionMode: "default",
  projectInfo: null,
  memorySnapshot: "",
};

const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  listeners.forEach(fn => {
    try { fn(state); } catch { /* ignore */ }
  });
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ═══════ Task Management ═══════

export function createTask(title: string, parentId?: string): AgentTask {
  const task: AgentTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    status: "pending",
    parentId,
    subtasks: [],
  };
  if (parentId) {
    const parent = findTask(state.tasks, parentId);
    if (parent) parent.subtasks.push(task);
  } else {
    state.tasks = [...state.tasks, task];
  }
  setState({ tasks: [...state.tasks] });
  return task;
}

export function updateTask(id: string, update: Partial<AgentTask>): void {
  const task = findTask(state.tasks, id);
  if (task) {
    Object.assign(task, update);
    setState({ tasks: [...state.tasks] });
  }
}

export function findTask(tasks: AgentTask[], id: string): AgentTask | null {
  for (const t of tasks) {
    if (t.id === id) return t;
    const found = findTask(t.subtasks, id);
    if (found) return found;
  }
  return null;
}

export function getTaskTree(): AgentTask[] {
  return state.tasks.filter(t => !t.parentId);
}

// ═══════ Hook System (#16) ═══════

type HookEvent = "before_tool" | "after_tool" | "before_send" | "after_response" | "error" | "task_complete";
type HookFn = (event: HookEvent, data: unknown) => Promise<void> | void;

const hooks = new Map<HookEvent, Set<HookFn>>();

export function registerHook(event: HookEvent, fn: HookFn): () => void {
  if (!hooks.has(event)) hooks.set(event, new Set());
  hooks.get(event)!.add(fn);
  return () => hooks.get(event)?.delete(fn);
}

export async function emitHook(event: HookEvent, data: unknown): Promise<void> {
  const fns = hooks.get(event);
  if (!fns) return;
  for (const fn of fns) {
    try { await fn(event, data); } catch { /* ignore hook errors */ }
  }
}

// ═══════ React Hook ═══════

/**
 * Subscribe to a derived slice of AppState.
 * Re-renders only when the selected value changes (by reference).
 *
 * Usage: const page = useAppState(s => s.currentPage);
 */
export function useAppState<T>(selector: (s: AppState) => T): T {
  const [value, setValue] = useState<T>(() => selector(getState()));
  // Keep a stable ref so the subscribe callback always reads the latest selector
  // without needing to re-subscribe on every render.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  useEffect(() => {
    return subscribe(s => {
      const next = selectorRef.current(s);
      setValue(prev => (prev === next ? prev : next));
    });
  }, []);

  return value;
}

// ═══════ Selectors ═══════

export function selectActiveTodo(s: AppState): AgentTask | null {
  if (!s.activeTaskId) return null;
  return findTask(s.tasks, s.activeTaskId);
}

export function selectPermissionMode(s: AppState): PermissionLevel {
  return s.permissionMode;
}

export function selectProjectInfo(s: AppState): ProjectInfo | null {
  return s.projectInfo;
}

export function selectMemorySnapshot(s: AppState): string {
  return s.memorySnapshot;
}
