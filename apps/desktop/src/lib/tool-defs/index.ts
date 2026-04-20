/**
 * Tool definitions index — aggregates all per-tool definitions, metadata,
 * and execution functions from individual tool files.
 *
 * Re-exports everything needed by the main tools.ts orchestrator.
 */
export type { ToolDef, ToolMeta, TranslateFn } from "./types";

// ═══════ Individual tool modules ═══════
import * as webSearch from "./web-search";
import * as webFetch from "./web-fetch";
import * as bash from "./bash";
import * as fileRead from "./file-read";
import * as fileWrite from "./file-write";
import * as fileEdit from "./file-edit";
import * as glob from "./glob";
import * as grep from "./grep";
import * as listDir from "./list-dir";
import * as browserOpen from "./browser-open";
import * as todo from "./todo";
import * as memory from "./memory";
import * as diffView from "./diff-view";
import * as undo from "./undo";
import * as projectDetect from "./project-detect";
import * as agentSpawn from "./agent-spawn";

import type { ToolDef, ToolMeta, TranslateFn } from "./types";

// ═══════ Build TOOL_DEFINITIONS array from individual modules ═══════

export function buildToolDefinitions(t: TranslateFn): ToolDef[] {
  return [
    webSearch.definition(t),
    webFetch.definition(t),
    bash.definition(t),
    fileRead.definition(t),
    fileWrite.definition(t),
    fileEdit.definition(t),
    glob.definition(t),
    grep.definition(t),
    listDir.definition(t),
    browserOpen.definition(t),
    todo.definition(t),
    memory.memoryWriteDefinition(t),
    memory.memoryReadDefinition(t),
    diffView.definition(t),
    undo.definition(t),
    projectDetect.definition(t),
    agentSpawn.agentSpawnDefinition(t),
    agentSpawn.notebookEditDefinition(t),
  ];
}

// ═══════ TOOL_NAME_MAP (frontend name → Rust backend name) ═══════

export const TOOL_NAME_MAP: Record<string, string> = {
  web_search: webSearch.rustName,
  web_fetch: webFetch.rustName,
  bash: bash.rustName,
  file_read: fileRead.rustName,
  file_write: fileWrite.rustName,
  file_edit: fileEdit.rustName,
  glob: glob.rustName,
  grep: grep.rustName,
  list_dir: listDir.rustName,
  browser_open: browserOpen.rustName,
};

// ═══════ LEGACY_META (per-tool registry metadata) ═══════

export const LEGACY_META: Record<string, ToolMeta> = {
  web_search: webSearch.meta,
  web_fetch: webFetch.meta,
  bash: bash.meta,
  file_read: fileRead.meta,
  file_write: fileWrite.meta,
  file_edit: fileEdit.meta,
  glob: glob.meta,
  grep: grep.meta,
  list_dir: listDir.meta,
  browser_open: browserOpen.meta,
  todo_write: todo.meta,
  memory_write: memory.memoryWriteMeta,
  memory_read: memory.memoryReadMeta,
  diff_view: diffView.meta,
  undo: undo.meta,
  project_detect: projectDetect.meta,
  agent_spawn: agentSpawn.agentSpawnMeta,
  notebook_edit: agentSpawn.notebookEditMeta,
};

// ═══════ Re-export execution functions ═══════
export { isDangerousCommand, getDangerDescription } from "./bash";
export { jsBrowserOpen } from "./browser-open";
export { execute as executeTodo } from "./todo";
export { executeMemoryWrite, executeMemoryRead } from "./memory";
export { execute as executeDiffView } from "./diff-view";
export { execute as executeUndo } from "./undo";
export { execute as executeProjectDetect } from "./project-detect";
export { executeAgentSpawn, executeNotebookEdit } from "./agent-spawn";
