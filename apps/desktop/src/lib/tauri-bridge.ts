/**
 * Tauri Bridge — Frontend bindings to Rust backend commands
 * 
 * S11: Terminal execution
 * S12: File system with sandbox
 * S15: Health check and repair
 */

// Tauri invoke will be available at runtime
// In dev mode, we provide fallbacks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriWindow = typeof window !== "undefined" ? (window as any) : null;
const invoke = tauriWindow?.__TAURI_INTERNALS__?.invoke
  ?? (async (_cmd: string, _args?: Record<string, unknown>) => {
      throw new Error("Tauri not available (dev mode without Tauri)");
    });

// S11: Terminal Command Execution

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  success: boolean;
}

export async function executeCommand(
  command: string,
  cwd?: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  return invoke("execute_command", { command, cwd, timeoutMs }) as Promise<CommandResult>;
}

// S12: File System with Sandbox

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

const allowedDirs: string[] = []; // Managed by settings

export function setAllowedDirs(dirs: string[]): void {
  allowedDirs.length = 0;
  allowedDirs.push(...dirs);
}

export async function readFileTauri(path: string): Promise<string> {
  return invoke("read_file", { path, allowedDirs }) as Promise<string>;
}

export async function writeFileTauri(path: string, content: string): Promise<string> {
  return invoke("write_file", { path, content, allowedDirs }) as Promise<string>;
}

export async function listDirectoryTauri(path: string): Promise<FileInfo[]> {
  return invoke("list_directory", { path, allowedDirs }) as Promise<FileInfo[]>;
}

export async function deleteFileTauri(path: string): Promise<string> {
  return invoke("delete_file", { path, allowedDirs }) as Promise<string>;
}

// ═══════════ Agent Commands (Phase 2: Rust Backend) ═══════════

export async function agentChat(
  provider: string,
  apiKey: string,
  baseUrl: string | null,
  model: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
): Promise<unknown> {
  return invoke("agent_chat", {
    provider, apiKey, baseUrl, model, messages, systemPrompt,
  });
}

export async function agentExecuteTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  return invoke("agent_execute_tool", { name, input }) as Promise<string>;
}

export async function agentGetTools(): Promise<Array<{ name: string; description: string; input_schema: unknown }>> {
  return invoke("agent_get_tools") as Promise<Array<{ name: string; description: string; input_schema: unknown }>>;
}

export async function setWorkspaceDir(dir: string): Promise<void> {
  return invoke("set_workspace_dir", { dir }) as Promise<void>;
}

export async function setPermissionMode(mode: string): Promise<void> {
  return invoke("set_permission_mode", { mode }) as Promise<void>;
}

export async function validateApiKeyRust(
  provider: string,
  apiKey: string,
  baseUrl: string | null,
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  return invoke("validate_api_key", { provider, apiKey, baseUrl, model }) as Promise<{ valid: boolean; error?: string }>;
}

/** Check if conversation needs compaction */
export async function checkCompactNeeded(messages: Array<{ role: string; content: string }>): Promise<boolean> {
  return invoke("check_compact_needed", { messages }) as Promise<boolean>;
}

/** Compact a conversation */
export async function compactConversation(messages: Array<{ role: string; content: string }>): Promise<{
  result: { summary: string; messages_removed: number; messages_kept: number };
  messages: Array<{ role: string; content: string }>;
}> {
  return invoke("compact_conversation", { messages }) as Promise<{
    result: { summary: string; messages_removed: number; messages_kept: number };
    messages: Array<{ role: string; content: string }>;
  }>;
}

/** Check if Tauri runtime is available */
export function isTauriAvailable(): boolean {
  return !!tauriWindow?.__TAURI_INTERNALS__?.invoke;
}

/** Stream chat via Tauri events — real-time token streaming from Rust */
export async function agentChatStream(
  provider: string,
  apiKey: string,
  baseUrl: string | null,
  model: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
): Promise<void> {
  return invoke("agent_chat_stream", {
    provider, apiKey, baseUrl, model, messages, systemPrompt,
  }) as Promise<void>;
}

export type StreamEventCallback = (event: {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  error?: string;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
  tool_call_id?: string;
  output?: string;
  is_error?: boolean;
}) => void;

/** Listen for agent-stream events from Rust backend */
export function listenAgentStream(callback: StreamEventCallback): (() => void) | null {
  const listen = tauriWindow?.__TAURI_INTERNALS__?.event?.listen;
  if (!listen) return null;

  let unlisten: (() => void) | null = null;
  listen("agent-stream", (event: { payload: unknown }) => {
    callback(event.payload as Parameters<StreamEventCallback>[0]);
  }).then((fn: () => void) => { unlisten = fn; });

  return () => { unlisten?.(); };
}

// S15: Health Check

export interface HealthStatus {
  config_valid: boolean;
  config_error: string | null;
  app_version: string;
}

export async function healthCheck(): Promise<HealthStatus> {
  return invoke("health_check") as Promise<HealthStatus>;
}

export async function repairConfig(): Promise<string> {
  return invoke("repair_config") as Promise<string>;
}
