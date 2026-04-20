import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "web_fetch",
      description: t("tools.webFetchDesc"),
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: t("tools.webFetchUrl") },
        },
        required: ["url"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "low",
  category: "web",
  searchHint: "fetch url page content scrape",
  maxResultChars: 50_000,
};

export const rustName = "WebFetch";
