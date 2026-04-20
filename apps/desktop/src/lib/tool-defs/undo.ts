import type { ToolDef, ToolMeta, TranslateFn } from "./types";
import { isTauriAvailable } from "../tauri-bridge";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "undo",
      description: t("tools.undoDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.undoPath") },
        },
        required: ["path"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "high",
  category: "meta",
  searchHint: "revert undo rollback restore",
};

export async function execute(args: Record<string, unknown>, t: TranslateFn): Promise<string> {
  const path = String(args.path || "");
  const { getRewindContent } = await import("../file-history");
  const original = getRewindContent(path);
  if (!original) return t("tools.undoNoBackup");
  const tReady = isTauriAvailable();
  if (tReady) {
    const { agentExecuteTool } = await import("../tauri-bridge");
    await agentExecuteTool("Write", { path, content: original });
    return `\u2705 ${t("tools.undoSuccess", { path })}`;
  }
  return `\u26A0\uFE0F ${t("tools.undoRequiresTauri")}`;
}
