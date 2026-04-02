/**
 * WebFetch tool — fetch and extract readable content from URLs
 */
import type { ToolDefinitionFull } from "../types.js";

export const webFetchTool: ToolDefinitionFull = {
  name: "WebFetch",
  description: "Fetch a URL and return its content as text. Useful for reading web pages, API responses, documentation.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      maxChars: { type: "number", description: "Maximum characters to return (default: 10000)" },
    },
    required: ["url"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const url = input.url as string;
    const maxChars = (input.maxChars as number) ?? 10000;

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

      const text = await response.text();
      // Basic HTML stripping
      const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return cleaned.slice(0, maxChars);
    } catch (error) {
      return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
