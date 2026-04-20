import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function agentSpawnDefinition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "agent_spawn",
      description: t("tools.agentSpawnDesc"),
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: t("tools.agentSpawnPrompt") },
          name: { type: "string", description: t("tools.agentSpawnName") },
          description: { type: "string", description: t("tools.agentSpawnDescription") },
          allowed_tools: {
            type: "array",
            items: { type: "string" },
            description: t("tools.agentSpawnAllowedTools"),
          },
        },
        required: ["prompt"],
      },
    },
  };
}

export function notebookEditDefinition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "notebook_edit",
      description: t("tools.notebookEditDesc"),
      parameters: {
        type: "object",
        properties: {
          notebook_path: { type: "string", description: t("tools.notebookEditPath") },
          cell_id: { type: "string", description: t("tools.notebookEditCellId") },
          new_source: { type: "string", description: t("tools.notebookEditNewSource") },
          cell_type: { type: "string", enum: ["code", "markdown"], description: t("tools.notebookEditCellType") },
          edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: t("tools.notebookEditMode") },
        },
        required: ["notebook_path", "new_source"],
      },
    },
  };
}

export const agentSpawnMeta: ToolMeta = {
  permission: "medium",
  category: "agent",
  searchHint: "spawn sub-agent child task delegate",
};

export const notebookEditMeta: ToolMeta = {
  permission: "high",
  category: "notebook",
  searchHint: "jupyter notebook ipynb cell edit",
};

export function executeAgentSpawn(args: Record<string, unknown>, t: TranslateFn): string {
  const prompt = String(args.prompt || "");
  const agentName = String(args.name || `sub-${Date.now()}`);
  const description = String(args.description || t("tools.subTask"));
  if (!prompt) return `\u274C ${t("tools.agentSpawnNoPrompt")}`;
  return `\uD83E\uDD16 ${t("tools.agentSpawnStarted", { name: agentName })}\n\uD83D\uDCDD ${t("tools.taskLabel")}: ${description}\n\n${t("tools.agentSpawnRunning")}\n\n---\n${t("tools.promptLabel")}: ${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`;
}

// ═══════════ Notebook Edit Implementation ═══════════

interface NotebookCell {
  cell_type: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  id?: string;
}

interface NotebookContent {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export async function executeNotebookEdit(args: Record<string, unknown>, t: TranslateFn): Promise<string> {
  const { isTauriAvailable } = await import("../tauri-bridge");

  const notebookPath = String(args.notebook_path || "");
  const newSource = String(args.new_source || "");
  const editMode = String(args.edit_mode || "replace") as "replace" | "insert" | "delete";
  const cellType = String(args.cell_type || "code");
  const cellId = args.cell_id ? String(args.cell_id) : undefined;

  if (!notebookPath) return `\u274C ${t("tools.notebookProvidePathError")}`;
  if (!notebookPath.endsWith(".ipynb")) return `\u274C ${t("tools.notebookMustBeIpynb")}`;

  const tauriReady = isTauriAvailable();
  if (!tauriReady) return `\u26A0\uFE0F ${t("tools.notebookRequiresTauri")}`;

  try {
    const { agentExecuteTool } = await import("../tauri-bridge");
    const raw = await agentExecuteTool("Read", { path: notebookPath });
    const notebook: NotebookContent = JSON.parse(raw);

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return `\u274C ${t("tools.notebookInvalidFormat")}`;
    }

    const sourceLines = newSource.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line,
    );

    let targetIdx = -1;
    if (cellId) {
      targetIdx = notebook.cells.findIndex((c, i) =>
        (c.id === cellId) || (String(i + 1) === cellId),
      );
    }

    switch (editMode) {
      case "replace": {
        if (targetIdx < 0) {
          if (notebook.cells.length === 0) return `\u274C ${t("tools.notebookNoCells")}`;
          targetIdx = 0;
        }
        notebook.cells[targetIdx].source = sourceLines;
        if (cellType) notebook.cells[targetIdx].cell_type = cellType;
        break;
      }
      case "insert": {
        const newCell: NotebookCell = {
          cell_type: cellType,
          source: sourceLines,
          metadata: {},
          ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
        };
        const insertAt = targetIdx >= 0 ? targetIdx + 1 : notebook.cells.length;
        notebook.cells.splice(insertAt, 0, newCell);
        break;
      }
      case "delete": {
        if (targetIdx < 0) return `\u274C ${t("tools.notebookCellNotFound")}`;
        notebook.cells.splice(targetIdx, 1);
        break;
      }
    }

    const updated = JSON.stringify(notebook, null, 1) + "\n";
    await agentExecuteTool("Write", { path: notebookPath, content: updated });

    const modeLabel = editMode === "replace" ? t("tools.notebookReplace") : editMode === "insert" ? t("tools.notebookInsert") : t("tools.notebookDelete");
    const cellLabel = cellId ? `${t("tools.notebookCell")} ${cellId}` : `${t("tools.notebookCell")} ${(targetIdx + 1)}`;
    return `\u2705 Notebook ${modeLabel}: ${cellLabel} (${cellType})\n${t("tools.pathLabel")}: ${notebookPath}`;
  } catch (e) {
    return `\u274C ${t("tools.notebookEditFailed")}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
