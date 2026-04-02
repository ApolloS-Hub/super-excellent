/**
 * Glob tool — find files by pattern
 */
import { exec } from "child_process";
import type { ToolDefinitionFull } from "../types.js";

export const globTool: ToolDefinitionFull = {
  name: "Glob",
  description: "Find files matching a glob pattern. Returns a list of file paths.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts')" },
      cwd: { type: "string", description: "Working directory (default: current)" },
    },
    required: ["pattern"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const pattern = input.pattern as string;
    const cwd = (input.cwd as string) || process.cwd();

    return new Promise<string>((resolve) => {
      exec(`find . -path "./${pattern}" -type f | head -1000`, { cwd, timeout: 15000 }, (error, stdout) => {
        resolve(stdout?.trim() || "(no matches)");
      });
    });
  },
};
