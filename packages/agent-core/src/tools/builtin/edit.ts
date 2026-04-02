/**
 * Edit tool — precise string replacement in files
 */
import { readFile, writeFile } from "fs/promises";
import type { ToolDefinitionFull } from "../types.js";

export const editTool: ToolDefinitionFull = {
  name: "Edit",
  description: "Edit a file by replacing exact text. The oldText must match exactly (including whitespace).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to edit" },
      oldText: { type: "string", description: "Exact text to find and replace" },
      newText: { type: "string", description: "New text to replace with" },
    },
    required: ["path", "oldText", "newText"],
  },
  isReadOnly: false,
  execute: async (input) => {
    const filePath = input.path as string;
    const oldText = input.oldText as string;
    const newText = input.newText as string;
    try {
      const content = await readFile(filePath, "utf-8");
      if (!content.includes(oldText)) {
        return `Error: Could not find the specified text in ${filePath}`;
      }
      const updated = content.replace(oldText, newText);
      await writeFile(filePath, updated, "utf-8");
      return `Successfully edited ${filePath}`;
    } catch (error) {
      return `Error editing file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
