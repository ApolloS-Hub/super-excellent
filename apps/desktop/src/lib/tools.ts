/**
 * Tool definitions and execution for OpenAI-compatible function calling.
 * Tries Tauri backend first, falls back to JS implementations.
 *
 * Registry-aware: new tools register via tool-registry.ts.
 * Legacy tools below are also registered into the registry for unified access.
 *
 * Definitions, metadata, and per-tool execution logic live in ./tool-defs/.
 * This file is the orchestrator that wires everything together.
 */
import { isTauriAvailable } from "./tauri-bridge";
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

import {
  type ToolDef,
  buildToolDefinitions,
  TOOL_NAME_MAP,
  LEGACY_META,
  isDangerousCommand,
  getDangerDescription,
  jsBrowserOpen,
  executeTodo,
  executeMemoryWrite,
  executeMemoryRead,
  executeDiffView,
  executeUndo,
  executeProjectDetect,
  executeAgentSpawn,
  executeNotebookEdit,
} from "./tool-defs";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

// ═══════════ Re-export ToolDef type for consumers ═══════════
export type { ToolDef } from "./tool-defs";

// ═══════════ Build TOOL_DEFINITIONS from per-tool modules ═══════════

export const TOOL_DEFINITIONS: ToolDef[] = buildToolDefinitions(t);

// ═══════════ Permission callback — set by ChatPage ═══════════

let permissionCallback: ((tool: string, detail: string) => Promise<boolean>) | null = null;

export function setPermissionCallback(cb: (tool: string, detail: string) => Promise<boolean>): void {
  permissionCallback = cb;
}

export function describeToolAction(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash": {
      const cmd = typeof args.command === "string" ? args.command : "";
      const danger = isDangerousCommand(cmd) ? ` [⚠️ ${getDangerDescription(cmd, t)}]` : "";
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
    const desc = getDangerDescription(args.command, t);
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
  if (name === "bash" && typeof args.command === "string") {
    const maxTimeout = 600;
    const defaultTimeout = 120;
    const requestedTimeout = typeof args.timeout === "number" ? args.timeout : defaultTimeout;
    args.timeout = Math.min(Math.max(requestedTimeout, 1), maxTimeout);
    delete args.truncate_output; // no longer used; registry handles truncation
  }

  // ═══════ Agent Spawn ═══════
  if (name === "agent_spawn") {
    return executeAgentSpawn(args, t);
  }

  // ═══════ Notebook Edit ═══════
  if (name === "notebook_edit") {
    return executeNotebookEdit(args, t);
  }

  // ═══════ Frontend-only tools (no Rust needed) ═══════
  if (name === "todo_write") {
    return executeTodo(args, t);
  }
  if (name === "memory_write") {
    return executeMemoryWrite(args, t);
  }
  if (name === "memory_read") {
    return executeMemoryRead(t);
  }
  if (name === "diff_view") {
    return executeDiffView(args, t);
  }
  if (name === "undo") {
    return executeUndo(args, t);
  }
  if (name === "project_detect") {
    return executeProjectDetect(args, t);
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
        return jsBrowserOpen(args.url as string, t);
      default:
        return `⚠️ ${t("tools.requiresDesktopApp")}`;
    }
  }

  return `${t("tools.unknownTool")}: ${name}`;
}

// ═══════════ Web Search Implementation ═══════════

async function executeWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query || "");
  if (!query) return `❌ ${t("tools.missingQueryParam")}`;

  try {
    const enOnly = query.replace(/[一-鿿]/g, " ").replace(/\d{4}/g, "")
      .replace(/(news|latest|search|find|today|recent)/gi, "")
      .replace(/\s+/g, " ").trim() || "AI";

    // Use Rust backend web_search command with hard 15s timeout
    if (isTauriAvailable()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const timeout = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("web_search timeout (15s)")), 15000)
      );
      try {
        return await Promise.race([
          invoke("web_search", { query: enOnly }) as Promise<string>,
          timeout,
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("timeout")) {
          // Tauri invoke hung — fall back to direct fetch
          return await webSearchFallback(enOnly);
        }
        throw e;
      }
    }

    return await webSearchFallback(enOnly);
  } catch (e) {
    return `${t("tools.searchFailed")}: ` + (e instanceof Error ? e.message : String(e));
  }
}

/** Fallback web search using direct fetch (works when Rust curl hangs) */
async function webSearchFallback(query: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    // Try HackerNews Algolia API
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return `Search returned HTTP ${resp.status}`;
    const data = await resp.json() as { hits?: Array<{ title?: string; url?: string; points?: number }> };
    if (!data.hits?.length) return "No results found";
    return data.hits
      .map((h, i) => `${i + 1}. ${h.title || "Untitled"}${h.url ? ` — ${h.url}` : ""}${h.points ? ` (${h.points} pts)` : ""}`)
      .join("\n");
  } catch (e) {
    clearTimeout(timer);
    return `Search failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

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
