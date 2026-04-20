import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "list_dir",
      description: t("tools.listDirDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.dirPath") },
        },
        required: ["path"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "file",
  searchHint: "list directory ls files folder",
  maxResultChars: 10_000,
};

export const rustName = "ListDir";
