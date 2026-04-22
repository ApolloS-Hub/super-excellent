/**
 * Context Bootstrap — Cross-Session Context Persistence
 *
 * Maintains a human-readable `.secretary-context.md` that captures the user's
 * ongoing state: active projects, recent decisions, pending tasks, preferences.
 * Auto-injected into the secretary's system prompt on session start.
 *
 * Inspired by product-playbook's `.product-context.md` pattern.
 * No vector DB, no embeddings — just structured markdown.
 */
import { memoryStore } from "./memory-store";
import { getAllTasks } from "./runtime";

// ── Types ──

export interface ContextSnapshot {
  updatedAt: string;
  activeProjects: string[];
  pendingTasks: string[];
  recentDecisions: string[];
  userPreferences: string[];
  weeklyFocus: string;
  blockers: string[];
  upcomingDeadlines: string[];
}

const STORAGE_KEY = "secretary-context";
const MAX_ITEMS_PER_SECTION = 10;

// ── Load / Save ──

function loadSnapshot(): ContextSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt */ }
  return emptySnapshot();
}

function saveSnapshot(snap: ContextSnapshot): void {
  snap.updatedAt = new Date().toISOString();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snap)); } catch { /* quota */ }
}

function emptySnapshot(): ContextSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    activeProjects: [],
    pendingTasks: [],
    recentDecisions: [],
    userPreferences: [],
    weeklyFocus: "",
    blockers: [],
    upcomingDeadlines: [],
  };
}

// ── Public API ──

export function getContextSnapshot(): ContextSnapshot {
  return loadSnapshot();
}

export function updateContext(partial: Partial<ContextSnapshot>): ContextSnapshot {
  const snap = loadSnapshot();
  if (partial.activeProjects !== undefined) snap.activeProjects = partial.activeProjects.slice(0, MAX_ITEMS_PER_SECTION);
  if (partial.pendingTasks !== undefined) snap.pendingTasks = partial.pendingTasks.slice(0, MAX_ITEMS_PER_SECTION);
  if (partial.recentDecisions !== undefined) snap.recentDecisions = partial.recentDecisions.slice(0, MAX_ITEMS_PER_SECTION);
  if (partial.userPreferences !== undefined) snap.userPreferences = partial.userPreferences.slice(0, MAX_ITEMS_PER_SECTION);
  if (partial.weeklyFocus !== undefined) snap.weeklyFocus = partial.weeklyFocus;
  if (partial.blockers !== undefined) snap.blockers = partial.blockers.slice(0, MAX_ITEMS_PER_SECTION);
  if (partial.upcomingDeadlines !== undefined) snap.upcomingDeadlines = partial.upcomingDeadlines.slice(0, MAX_ITEMS_PER_SECTION);
  saveSnapshot(snap);
  return snap;
}

export function addToContext(section: keyof ContextSnapshot, item: string): void {
  const snap = loadSnapshot();
  const list = snap[section];
  if (Array.isArray(list)) {
    if (!list.includes(item)) {
      list.unshift(item);
      if (list.length > MAX_ITEMS_PER_SECTION) list.pop();
    }
  } else if (section === "weeklyFocus") {
    snap.weeklyFocus = item;
  }
  saveSnapshot(snap);
}

export function removeFromContext(section: keyof ContextSnapshot, item: string): void {
  const snap = loadSnapshot();
  const list = snap[section];
  if (Array.isArray(list)) {
    const idx = list.indexOf(item);
    if (idx >= 0) list.splice(idx, 1);
    saveSnapshot(snap);
  }
}

/**
 * Auto-collect context from existing systems (memory store, tasks, etc.)
 * Called periodically or after meaningful interactions.
 */
export async function autoCollectContext(): Promise<ContextSnapshot> {
  const snap = loadSnapshot();

  // Collect from memory store
  try {
    const memories = await memoryStore.load();
    const prefs = memories
      .filter(m => m.category === "preference")
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 5)
      .map(m => m.content);
    if (prefs.length > 0) snap.userPreferences = prefs;

    const projects = memories
      .filter(m => m.category === "project")
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
      .map(m => m.content);
    if (projects.length > 0) snap.activeProjects = projects;
  } catch { /* memory store not ready */ }

  // Collect from runtime tasks
  try {
    const tasks = getAllTasks();
    const pending = tasks
      .filter(t => t.status === "todo" || t.status === "in_progress")
      .slice(0, MAX_ITEMS_PER_SECTION)
      .map(t => `[${t.status}] ${t.title} (${t.owner})`);
    if (pending.length > 0) snap.pendingTasks = pending;

    const blocked = tasks
      .filter(t => t.status === "blocked")
      .slice(0, 5)
      .map(t => `${t.title}: blocked`);
    if (blocked.length > 0) snap.blockers = blocked;
  } catch { /* runtime not ready */ }

  saveSnapshot(snap);
  return snap;
}

// ── Prompt Injection ──

/**
 * Build a markdown block for injection into the secretary's system prompt.
 * This is the human-readable "context file" that product-playbook inspired.
 */
export function buildContextPrompt(): string {
  const snap = loadSnapshot();
  const sections: string[] = [];

  sections.push(`# Secretary Context (updated ${snap.updatedAt})`);

  if (snap.weeklyFocus) {
    sections.push(`## Weekly Focus\n${snap.weeklyFocus}`);
  }

  if (snap.activeProjects.length > 0) {
    sections.push(`## Active Projects\n${snap.activeProjects.map(p => `- ${p}`).join("\n")}`);
  }

  if (snap.pendingTasks.length > 0) {
    sections.push(`## Pending Tasks\n${snap.pendingTasks.map(t => `- ${t}`).join("\n")}`);
  }

  if (snap.upcomingDeadlines.length > 0) {
    sections.push(`## Upcoming Deadlines\n${snap.upcomingDeadlines.map(d => `- ${d}`).join("\n")}`);
  }

  if (snap.blockers.length > 0) {
    sections.push(`## Blockers\n${snap.blockers.map(b => `- ${b}`).join("\n")}`);
  }

  if (snap.recentDecisions.length > 0) {
    sections.push(`## Recent Decisions\n${snap.recentDecisions.map(d => `- ${d}`).join("\n")}`);
  }

  if (snap.userPreferences.length > 0) {
    sections.push(`## User Preferences\n${snap.userPreferences.map(p => `- ${p}`).join("\n")}`);
  }

  const output = sections.join("\n\n");
  return output.length > 50 ? output : ""; // Don't inject if basically empty
}

/**
 * Extract context updates from a conversation exchange.
 * Called by the coordinator after each meaningful interaction.
 * Returns the items that were learned and should be persisted.
 */
export function extractContextFromResponse(userMessage: string, assistantResponse: string): Record<string, string[]> {
  const learned: Record<string, string[]> = {};

  // Detect project mentions
  const projectPatterns = [
    /(?:working on|在做|项目|project)\s*[:：]?\s*(.{5,60})/gi,
    /(?:关于|about)\s+(.{5,40})\s*(?:项目|project)/gi,
  ];
  for (const p of projectPatterns) {
    const match = p.exec(userMessage);
    if (match) (learned.activeProjects ??= []).push(match[1].trim());
  }

  // Detect deadline mentions
  const deadlinePatterns = [
    /(?:deadline|截止|due)\s*[:：]?\s*(.{5,60})/gi,
    /(?:before|在)\s*(\d{1,2}[月/]\d{1,2}[日号]?)\s*(?:之前|before)/gi,
  ];
  for (const p of deadlinePatterns) {
    const match = p.exec(userMessage);
    if (match) (learned.upcomingDeadlines ??= []).push(match[1].trim());
  }

  // Detect decisions
  const decisionPatterns = [
    /(?:decided|决定|选择|we'll go with|用方案)\s*[:：]?\s*(.{5,80})/gi,
  ];
  for (const p of decisionPatterns) {
    const match = p.exec(userMessage + " " + assistantResponse);
    if (match) (learned.recentDecisions ??= []).push(match[1].trim());
  }

  // Persist learned items
  for (const [section, items] of Object.entries(learned)) {
    for (const item of items) {
      addToContext(section as keyof ContextSnapshot, item);
    }
  }

  return learned;
}
