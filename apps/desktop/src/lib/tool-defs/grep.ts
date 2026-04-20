import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "grep",
      description: t("tools.grepDesc"),
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: t("tools.grepPattern") },
          path: { type: "string", description: t("tools.grepPath") },
          include: { type: "string", description: t("tools.grepInclude") },
        },
        required: ["pattern"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "file",
  searchHint: "search content text regex find in files",
  maxResultChars: 30_000,
};

export const rustName = "Grep";
