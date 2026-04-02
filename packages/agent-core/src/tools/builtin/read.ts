/**
 * Read tool — read file contents
 */
import { readFile } from "fs/promises";
import type { ToolDefinitionFull } from "../types.js";

export const readTool: ToolDefinitionFull = {
  name: "Read",
  description: "Read the contents of a file. Returns the file content as text.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read" },
      offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["path"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const filePath = input.path as string;
    const offset = (input.offset as number) ?? 1;
    const limit = input.limit as number | undefined;

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, offset - 1);
      const end = limit ? start + limit : lines.length;
      return lines.slice(start, end).join("\n");
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
