/**
 * Bash tool — execute shell commands
 * Core tool from both claude-code-haha and open-agent-sdk
 */
import { exec } from "child_process";
import type { ToolDefinitionFull } from "../types.js";

export const bashTool: ToolDefinitionFull = {
  name: "Bash",
  description: "Execute a shell command and return stdout/stderr. Use for running scripts, installing packages, file operations, git commands, etc.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  },
  isReadOnly: false,
  execute: async (input) => {
    const command = input.command as string;
    const timeout = (input.timeout as number) ?? 30000;

    return new Promise<string>((resolve) => {
      exec(command, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        let result = "";
        if (stdout) result += stdout;
        if (stderr) result += (result ? "\n" : "") + stderr;
        if (error && !stdout && !stderr) {
          result = `Error: ${error.message}`;
        }
        resolve(result || "(no output)");
      });
    });
  },
};
