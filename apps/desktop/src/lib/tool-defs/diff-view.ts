import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "diff_view",
      description: t("tools.diffViewDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.filePath") },
        },
        required: ["path"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "meta",
  searchHint: "diff changes modifications history",
};

export async function execute(args: Record<string, unknown>, t: TranslateFn): Promise<string> {
  const { getFileBackups, formatDiff, computeDiff } = await import("../file-history");
  const backups = getFileBackups(String(args.path || ""));
  if (backups.length === 0) return t("tools.noModificationRecords");
  const last = backups[backups.length - 1];
  return formatDiff(computeDiff(last.originalContent, last.newContent));
}
