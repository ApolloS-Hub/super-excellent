import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "file_read",
      description: t("tools.fileReadDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
          offset: { type: "number", description: t("tools.fileReadOffset") },
          limit: { type: "number", description: t("tools.fileReadLimit") },
        },
        required: ["path"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "file",
  searchHint: "read file content open view",
  maxResultChars: 50_000,
};

export const rustName = "Read";
