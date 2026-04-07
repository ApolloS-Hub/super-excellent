/**
 * Tool registry — manages available tools and execution
 */
import type { ToolDefinitionFull, ToolExecutor, PermissionMode, PermissionGate } from "./types.js";
import { bashTool } from "./builtin/bash.js";
import { readTool } from "./builtin/read.js";
import { writeTool } from "./builtin/write.js";
import { editTool } from "./builtin/edit.js";
import { globTool } from "./builtin/glob.js";
import { grepTool } from "./builtin/grep.js";
import { webFetchTool } from "./builtin/web-fetch.js";
import { webSearchTool } from "./builtin/web-search.js";
import { askUserTool } from "./builtin/ask-user.js";
import { listDirTool } from "./builtin/list-dir.js";
import { browserOpenTool, screenshotTool, browserFetchTool } from "./builtin/browser.js";

/** All built-in tools (13 tools) */
export const BUILTIN_TOOLS: ToolDefinitionFull[] = [
  bashTool,
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
  askUserTool,
  listDirTool,
  browserOpenTool,
  screenshotTool,
  browserFetchTool,
];

/**
 * Create a tool executor with permission gating
 */
export function createToolExecutor(
  tools: ToolDefinitionFull[] = BUILTIN_TOOLS,
  permissionMode: PermissionMode = "bypassPermissions",
  permissionGate?: PermissionGate,
): ToolExecutor {
  const toolMap = new Map(tools.map(t => [t.name, t]));

  return {
    execute: async (name: string, input: Record<string, unknown>) => {
      const tool = toolMap.get(name);
      if (!tool) {
        return `Error: Unknown tool "${name}". Available: ${[...toolMap.keys()].join(", ")}`;
      }

      // Permission check
      if (permissionMode !== "bypassPermissions" && !tool.isReadOnly) {
        if (permissionGate) {
          const allowed = await permissionGate.check(name, input, permissionMode);
          if (!allowed) {
            return `Error: Permission denied for tool "${name}". User approval required.`;
          }
        }
      }

      return tool.execute(input);
    },

    getDefinitions: () => tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

export { setUserInputCallback } from "./builtin/ask-user.js";
export { BUILTIN_TOOLS as allTools };
export type { ToolDefinitionFull, ToolExecutor, PermissionMode } from "./types.js";
