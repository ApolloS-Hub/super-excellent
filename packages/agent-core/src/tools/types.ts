/**
 * Tool system types — inspired by open-agent-sdk's 34 built-in tools
 * and claude-code-haha's permission gates
 */

export interface ToolDefinitionFull {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Is this tool read-only (safe to run without approval)? */
  isReadOnly: boolean;
  /** Execute the tool */
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface ToolExecutor {
  /** Execute a tool by name */
  execute: (name: string, input: Record<string, unknown>) => Promise<string>;
  /** Get all available tool definitions (for LLM) */
  getDefinitions: () => Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export type PermissionMode = "default" | "acceptEdits" | "dontAsk" | "bypassPermissions" | "plan";

export interface PermissionGate {
  /** Check if a tool call should be allowed */
  check: (toolName: string, input: Record<string, unknown>, mode: PermissionMode) => Promise<boolean>;
}
