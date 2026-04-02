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
