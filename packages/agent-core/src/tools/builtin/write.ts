/**
 * Write tool — create or overwrite files
 */
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { ToolDefinitionFull } from "../types.js";

export const writeTool: ToolDefinitionFull = {
  name: "Write",
  description: "Create or overwrite a file with the given content. Automatically creates parent directories.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write to the file" },
    },
    required: ["path", "content"],
  },
  isReadOnly: false,
  execute: async (input) => {
    const filePath = input.path as string;
    const content = input.content as string;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");
      return `Successfully wrote ${content.length} bytes to ${filePath}`;
    } catch (error) {
      return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
