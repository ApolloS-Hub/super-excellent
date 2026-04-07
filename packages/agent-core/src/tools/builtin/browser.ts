/**
 * Browser tool — open URLs, take screenshots, and fetch page content
 * Uses system browser via shell commands (cross-platform)
 */
import { exec } from "child_process";
import type { ToolDefinitionFull } from "../types.js";

/**
 * Strip script/style tags and HTML markup, return plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract <title> content from raw HTML.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : "";
}

export const browserFetchTool: ToolDefinitionFull = {
  name: "BrowserFetch",
  description:
    "Fetch a web page with native fetch, strip scripts/styles, and return its title plus up to 5 000 characters of body text.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      maxChars: {
        type: "number",
        description: "Maximum body characters to return (default: 5000)",
      },
    },
    required: ["url"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const url = input.url as string;
    const maxChars = (input.maxChars as number) ?? 5000;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "SuperExcellent/1.0" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return `HTTP ${response.status}: ${response.statusText}`;
      }

      const html = await response.text();
      const title = extractTitle(html);
      const body = stripHtml(html).slice(0, maxChars);

      return title ? `Title: ${title}\n\n${body}` : body;
    } catch (error) {
      return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export { stripHtml as _stripHtml, extractTitle as _extractTitle };

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
