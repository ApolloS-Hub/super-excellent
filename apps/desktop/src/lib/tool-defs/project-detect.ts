import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "project_detect",
      description: t("tools.projectDetectDesc"),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: t("tools.projectDetectPath") },
        },
        required: ["path"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "none",
  category: "meta",
  searchHint: "detect project type language framework",
};

export async function execute(args: Record<string, unknown>, t: TranslateFn): Promise<string> {
  const { detectProject, buildProjectPrompt } = await import("../project-context");
  const project = await detectProject(String(args.path || "/tmp"));
  if (!project) return t("tools.noProjectDetected");
  return buildProjectPrompt(project);
}
