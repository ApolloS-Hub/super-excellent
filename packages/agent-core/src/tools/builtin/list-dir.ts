/**
 * ListDir tool — list directory contents
 */
import { readdir, stat } from "fs/promises";
import { join } from "path";
import type { ToolDefinitionFull } from "../types.js";

export const listDirTool: ToolDefinitionFull = {
  name: "ListDir",
  description: "List files and directories in a path. Shows name, type, and size.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
    },
    required: ["path"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const dirPath = input.path as string;
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const results: string[] = [];

      for (const entry of entries.slice(0, 200)) {
        const fullPath = join(dirPath, entry.name);
        try {
          const stats = await stat(fullPath);
          const type = entry.isDirectory() ? "dir" : "file";
          const size = entry.isDirectory() ? "" : ` (${formatBytes(stats.size)})`;
          results.push(`${type}  ${entry.name}${size}`);
        } catch {
          results.push(`???  ${entry.name}`);
        }
      }

      return results.length ? results.join("\n") : "(empty directory)";
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
