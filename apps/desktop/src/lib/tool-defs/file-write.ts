import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "file_write",
      description: t("tools.fileWriteDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
          content: { type: "string", description: t("tools.fileWriteContent") },
        },
        required: ["path", "content"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "high",
  category: "file",
  searchHint: "write create file content save",
};

export const rustName = "Write";
