import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "file_edit",
      description: t("tools.fileEditDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
          old_text: { type: "string", description: t("tools.fileEditOldText") },
          new_text: { type: "string", description: t("tools.fileEditNewText") },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "high",
  category: "file",
  searchHint: "edit modify patch replace text",
};

export const rustName = "Edit";
