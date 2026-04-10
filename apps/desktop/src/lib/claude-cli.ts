/**
 * Claude CLI Bridge — 通过 Tauri execute_command 调用 Claude Code CLI
 *
 * 核心思路：不引入 Claude Agent SDK npm 包，直接用 Tauri shell 跑 `claude --print`。
 * CLI 自带 agent loop（工具调用、多轮、超时），替代手写的 HTTP API + tool loop。
 */

import { executeCommand, isTauriAvailable } from "./tauri-bridge";

/** Claude CLI 硬编码路径（macOS Homebrew），后续可配置 */
const CLAUDE_CLI_PATH = "/opt/homebrew/Cellar/node/25.9.0_1/bin/claude";

/** CLI 调用选项 */
export interface ClaudeCLIOptions {
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  apiKey?: string;
  baseURL?: string;
}

/** CLI 调用结果 */
export interface ClaudeCLIResult {
  success: boolean;
  output: string;
  error?: string;
}

/** 缓存 CLI 可用性检测结果，避免重复 shell 调用 */
let cliAvailableCache: boolean | null = null;

/**
 * 检测 Claude CLI 是否可用
 * - Tauri 运行时存在
 * - CLI 二进制存在且可执行
 */
export async function isClaudeCLIAvailable(): Promise<boolean> {
  if (cliAvailableCache !== null) return cliAvailableCache;

  if (!isTauriAvailable()) {
    cliAvailableCache = false;
    return false;
  }

  try {
    const result = await executeCommand(`test -x "${CLAUDE_CLI_PATH}" && echo "ok"`, undefined, 5000);
    cliAvailableCache = result.success && result.stdout.trim() === "ok";
  } catch {
    cliAvailableCache = false;
  }
  return cliAvailableCache;
}

/** 重置缓存（测试用） */
export function resetCLICache(): void {
  cliAvailableCache = null;
}

/**
 * 调用 Claude CLI 执行 prompt
 *
 * 命令格式：claude --print [--model X] [--max-turns N] '<prompt>'
 * CLI 自己处理工具调用循环和超时，我们只需要拿最终输出。
 */
export async function invokeClaudeCLI(
  prompt: string,
  options: ClaudeCLIOptions = {},
): Promise<ClaudeCLIResult> {
  const { model, systemPrompt, maxTurns, apiKey, baseURL } = options;

  // 构建命令参数
  const args: string[] = [`"${CLAUDE_CLI_PATH}"`, "--print"];

  if (model) {
    args.push("--model", shellEscape(model));
  }
  if (maxTurns) {
    args.push("--max-turns", String(maxTurns));
  }
  if (systemPrompt) {
    args.push("--system-prompt", shellEscape(systemPrompt));
  }

  // prompt 作为最后一个参数
  args.push(shellEscape(prompt));

  // 构建环境变量前缀
  const envParts: string[] = [];
  if (apiKey) {
    envParts.push(`ANTHROPIC_API_KEY=${shellEscape(apiKey)}`);
  }
  if (baseURL) {
    envParts.push(`ANTHROPIC_BASE_URL=${shellEscape(baseURL)}`);
  }

  const command = envParts.length > 0
    ? `${envParts.join(" ")} ${args.join(" ")}`
    : args.join(" ");

  try {
    const result = await executeCommand(command, undefined, 60000);

    if (result.success) {
      return {
        success: true,
        output: result.stdout.trim(),
      };
    }

    return {
      success: false,
      output: "",
      error: result.stderr?.trim() || `CLI exited with code ${result.exit_code}`,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Shell 转义 — 用单引号包裹，内部单引号用 '\'' 替换
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
