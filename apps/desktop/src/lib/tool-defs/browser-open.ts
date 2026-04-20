import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "browser_open",
      description: t("tools.browserOpenDesc"),
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: t("tools.browserOpenUrl") },
        },
        required: ["url"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "medium",
  category: "web",
  searchHint: "open browser url link",
};

export const rustName = "Browser";

export function jsBrowserOpen(url: string, t: TranslateFn): string {
  try {
    window.open(url, "_blank");
    return `\u2705 ${t("tools.browserOpened", { url })}`;
  } catch {
    return `${t("tools.browserOpenFailed", { url })}`;
  }
}
