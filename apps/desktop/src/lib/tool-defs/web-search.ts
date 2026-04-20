import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "web_search",
      description: t("tools.webSearchDesc"),
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: t("tools.webSearchQuery") },
        },
        required: ["query"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "low",
  category: "web",
  searchHint: "search internet query online information",
  maxResultChars: 20_000,
};

export const rustName = "WebSearch";
