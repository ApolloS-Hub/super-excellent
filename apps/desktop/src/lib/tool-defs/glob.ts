import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "glob",
      description: t("tools.globDesc"),
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: t("tools.globPattern") },
          path: { type: "string", description: t("tools.searchRootDir") },
        },
        required: ["pattern"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "file",
  searchHint: "find files pattern match search filesystem",
  maxResultChars: 20_000,
};

export const rustName = "Glob";
