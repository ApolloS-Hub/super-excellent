/**
 * Task Store — 任务存储，支持创建/更新/查询
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/task-store.ts
 * Rewritten as in-memory store (no filesystem dependencies)
 */

export type TaskState = "todo" | "in_progress" | "blocked" | "done";

export interface TaskArtifact {
  artifactId: string;
  type: "code" | "doc" | "link" | "other";
  label: string;
  location: string;
}

export interface RollbackPlan {
  strategy: string;
  steps: string[];
  verification?: string;
}

export interface BudgetThresholds {
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  cost?: number;
  warnRatio: number;
}

export interface ProjectTask {
  projectId: string;
  taskId: string;
  title: string;
  status: TaskState;
  owner: string;
  roomId?: string;
  dueAt?: string;
  parentId?: string;
  children: string[];
  definitionOfDone: string[];
  artifacts: TaskArtifact[];
  rollback: RollbackPlan;
  sessionKeys: string[];
  budget: BudgetThresholds;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
}

export interface TaskListItem {
  projectId: string;
  taskId: string;
  title: string;
  status: TaskState;
  owner: string;
  roomId?: string;
  dueAt?: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  projectId: string;
  taskId: string;
  title: string;
  status?: TaskState;
  owner?: string;
  roomId?: string;
  dueAt?: string;
  parentId?: string;
  definitionOfDone?: string[];
}

export interface PatchTaskInput {
  taskId: string;
  projectId?: string;
  status?: TaskState;
  owner?: string;
  roomId?: string | null;
  dueAt?: string | null;
  sessionKeys?: string[];
  artifacts?: TaskArtifact[];
}

export class TaskStoreValidationError extends Error {
  readonly statusCode: number;
  readonly issues: string[];
  constructor(message: string, issues: string[] = [], statusCode = 400) {
    super(message);
    this.name = "TaskStoreValidationError";
    this.issues = issues;
    this.statusCode = statusCode;
  }
}

let tasks: ProjectTask[] = [];
const changeListeners = new Set<() => void>();

export function onTaskStoreChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function notifyChange(): void {
  for (const fn of changeListeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

function defaultBudget(): BudgetThresholds {
  return { warnRatio: 0.8 };
}

function defaultRollback(): RollbackPlan {
  return { strategy: "manual-rollback", steps: [] };
}

export function listTasks(projectId?: string): TaskListItem[] {
  const filtered = projectId ? tasks.filter(t => t.projectId === projectId) : tasks;
  return filtered
    .map(t => ({
      projectId: t.projectId,
      taskId: t.taskId,
      title: t.title,
      status: t.status,
      owner: t.owner,
      roomId: t.roomId,
      dueAt: t.dueAt,
      updatedAt: t.updatedAt,
    }))
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return a.taskId.localeCompare(b.taskId);
    });
}

export function getTask(taskId: string, projectId?: string): ProjectTask | undefined {
  return tasks.find(t =>
    t.taskId === taskId.trim() && (!projectId || t.projectId === projectId.trim()),
  );
}

export function createTask(input: CreateTaskInput): ProjectTask {
  if (tasks.some(t => t.taskId === input.taskId && t.projectId === input.projectId)) {
    throw new TaskStoreValidationError(`taskId '${input.taskId}' already exists in project '${input.projectId}'.`, ["taskId"], 409);
  }

  const now = new Date().toISOString();
  const task: ProjectTask = {
    projectId: input.projectId,
    taskId: input.taskId,
    title: input.title,
    status: input.status ?? "todo",
    owner: input.owner ?? "unassigned",
    roomId: input.roomId,
    dueAt: input.dueAt,
    parentId: input.parentId,
    children: [],
    definitionOfDone: input.definitionOfDone ?? [],
    artifacts: [],
    rollback: defaultRollback(),
    sessionKeys: [],
    budget: defaultBudget(),
    createdAt: now,
    updatedAt: now,
  };

  tasks.push(task);

  // Link to parent
  if (input.parentId) {
    const parent = getTask(input.parentId, input.projectId);
    if (parent && !parent.children.includes(task.taskId)) {
      parent.children.push(task.taskId);
      parent.updatedAt = now;
    }
  }

  notifyChange();
  persistToIDB();
  return task;
}

export function updateTaskStatus(taskId: string, status: TaskState, projectId?: string): ProjectTask {
  const task = getTask(taskId, projectId);
  if (!task) {
    throw new TaskStoreValidationError(
      `taskId '${taskId}' not found${projectId ? ` in project '${projectId}'` : ""}.`, [], 404,
    );
  }

  task.status = status;
  task.updatedAt = new Date().toISOString();
  if (status === "done") {
    task.completedAt = task.updatedAt;
  }
  notifyChange();
  persistToIDB();
  return task;
}

export function patchTask(input: PatchTaskInput): ProjectTask {
  const task = getTask(input.taskId, input.projectId);
  if (!task) {
    throw new TaskStoreValidationError(
      `taskId '${input.taskId}' not found${input.projectId ? ` in project '${input.projectId}'` : ""}.`, [], 404,
    );
  }

  const now = new Date().toISOString();
  if (input.status !== undefined) task.status = input.status;
  if (input.owner !== undefined) task.owner = input.owner;
  if (input.roomId !== undefined) task.roomId = input.roomId ?? undefined;
  if (input.dueAt !== undefined) task.dueAt = input.dueAt ?? undefined;
  if (input.sessionKeys !== undefined) task.sessionKeys = input.sessionKeys;
  if (input.artifacts !== undefined) task.artifacts = input.artifacts;
  task.updatedAt = now;

  notifyChange();
  return task;
}

export function deleteTask(taskId: string, projectId?: string): ProjectTask {
  const task = getTask(taskId, projectId);
  if (!task) {
    throw new TaskStoreValidationError(
      `taskId '${taskId}' not found${projectId ? ` in project '${projectId}'` : ""}.`, [], 404,
    );
  }

  const deleted = { ...task };
  tasks = tasks.filter(t => !(t.taskId === taskId && t.projectId === task.projectId));
  notifyChange();
  return deleted;
}

export function getAllTasks(): ProjectTask[] {
  return [...tasks];
}

export function resetTaskStore(): void {
  tasks = [];
  notifyChange();
  persistToIDB();
}

/** Get children of a task */
export function getChildren(taskId: string, projectId?: string): ProjectTask[] {
  const task = getTask(taskId, projectId);
  if (!task || task.children.length === 0) return [];
  return task.children
    .map(childId => getTask(childId, task.projectId))
    .filter((t): t is ProjectTask => t !== undefined);
}

/** Get parent of a task */
export function getParent(taskId: string, projectId?: string): ProjectTask | undefined {
  const task = getTask(taskId, projectId);
  if (!task?.parentId) return undefined;
  return getTask(task.parentId, task.projectId);
}

// ═══════════ IndexedDB Persistence ═══════════

const TASK_IDB_NAME = "super-excellent-tasks";
const TASK_IDB_VERSION = 1;
const TASK_IDB_STORE = "tasks";

function openTaskDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(TASK_IDB_NAME, TASK_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TASK_IDB_STORE)) {
        db.createObjectStore(TASK_IDB_STORE, { keyPath: "taskId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function persistToIDB(): void {
  openTaskDB().then(db => {
    const tx = db.transaction(TASK_IDB_STORE, "readwrite");
    const store = tx.objectStore(TASK_IDB_STORE);
    store.clear();
    for (const task of tasks) {
      store.put(task);
    }
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  }).catch(() => { /* IndexedDB not available */ });
}

export function loadTasksFromIDB(): Promise<void> {
  return openTaskDB().then(db => {
    return new Promise<void>((resolve) => {
      const tx = db.transaction(TASK_IDB_STORE, "readonly");
      const store = tx.objectStore(TASK_IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const loaded = req.result as ProjectTask[];
        if (loaded.length > 0) {
          tasks = loaded;
          notifyChange();
        }
        db.close();
        resolve();
      };
      req.onerror = () => { db.close(); resolve(); };
    });
  }).catch(() => { /* IndexedDB not available */ });
}
