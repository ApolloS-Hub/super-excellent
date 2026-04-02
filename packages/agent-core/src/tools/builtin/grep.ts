/**
 * Grep tool — search file contents
 */
import { exec } from "child_process";
import type { ToolDefinitionFull } from "../types.js";

export const grepTool: ToolDefinitionFull = {
  name: "Grep",
  description: "Search for text patterns in files using grep. Returns matching lines with file paths and line numbers.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Search pattern (regex)" },
      path: { type: "string", description: "File or directory to search" },
      include: { type: "string", description: "File pattern to include (e.g., '*.ts')" },
    },
    required: ["pattern", "path"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const pattern = input.pattern as string;
    const path = input.path as string;
    const include = input.include as string | undefined;

    let cmd = `grep -rn "${pattern.replace(/"/g, '\\"')}" "${path}"`;
    if (include) cmd += ` --include="${include}"`;
    cmd += " | head -100";

    return new Promise<string>((resolve) => {
      exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        resolve(stdout || "(no matches)");
      });
    });
  },
};
