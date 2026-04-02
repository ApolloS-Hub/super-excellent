/**
 * Browser tool — open URLs and take screenshots
 * Uses system browser via shell commands (cross-platform)
 */
import { exec } from "child_process";
import type { ToolDefinitionFull } from "../types.js";

export const browserOpenTool: ToolDefinitionFull = {
  name: "BrowserOpen",
  description: "Open a URL in the system default browser.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to open" },
    },
    required: ["url"],
  },
  isReadOnly: false,
  execute: async (input) => {
    const url = input.url as string;
    const cmd = process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;

    return new Promise<string>((resolve) => {
      exec(cmd, { timeout: 10000 }, (error) => {
        resolve(error ? `Error: ${error.message}` : `Opened ${url} in browser`);
      });
    });
  },
};

export const screenshotTool: ToolDefinitionFull = {
  name: "Screenshot",
  description: "Take a screenshot of the current screen (macOS only for now).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Output file path (default: /tmp/screenshot.png)" },
    },
  },
  isReadOnly: true,
  execute: async (input) => {
    const outPath = (input.path as string) || "/tmp/se-screenshot.png";

    if (process.platform !== "darwin") {
      return "Screenshot currently only supported on macOS";
    }

    return new Promise<string>((resolve) => {
      exec(`screencapture -x "${outPath}"`, { timeout: 10000 }, (error) => {
        resolve(error ? `Error: ${error.message}` : `Screenshot saved to ${outPath}`);
      });
    });
  },
};
