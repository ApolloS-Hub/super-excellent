/**
 * Shared types for tool definitions.
 */
import type { PermissionLevel, ToolCategory } from "../tool-registry";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolMeta {
  permission: PermissionLevel;
  category: ToolCategory;
  searchHint: string;
  maxResultChars?: number;
}

/** Translator shorthand type — each tool file receives this. */
export type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;
