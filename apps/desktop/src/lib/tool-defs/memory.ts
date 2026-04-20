import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function memoryWriteDefinition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "memory_write",
      description: t("tools.memoryWriteDesc"),
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: t("tools.memoryWriteContent") },
        },
        required: ["content"],
      },
    },
  };
}

export function memoryReadDefinition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "memory_read",
      description: t("tools.memoryReadDesc"),
      parameters: { type: "object", properties: {} },
    },
  };
}

export const memoryWriteMeta: ToolMeta = {
  permission: "low",
  category: "memory",
  searchHint: "save remember persist preferences",
};

export const memoryReadMeta: ToolMeta = {
  permission: "none",
  category: "memory",
  searchHint: "recall remember history preferences",
};

export async function executeMemoryWrite(args: Record<string, unknown>, t: TranslateFn): Promise<string> {
  const { appendMemory } = await import("../memory");
  appendMemory(String(args.content || ""));
  return `\u2705 ${t("tools.memorySaved")}`;
}

export async function executeMemoryRead(_t: TranslateFn): Promise<string> {
  const { formatMemory } = await import("../memory");
  return formatMemory();
}
