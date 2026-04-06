/**
 * LSP Client — Language Server Protocol integration for code intelligence
 * Provides diagnostics, completions, go-to-definition for the agent
 */

export interface LSPDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
}

export interface LSPCompletion {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
}

let diagnosticsCache: Map<string, LSPDiagnostic[]> = new Map();

/**
 * Get cached diagnostics for a file
 */
export function getDiagnostics(file: string): LSPDiagnostic[] {
  return diagnosticsCache.get(file) || [];
}

/**
 * Get all diagnostics across all files
 */
export function getAllDiagnostics(): LSPDiagnostic[] {
  const all: LSPDiagnostic[] = [];
  diagnosticsCache.forEach(diags => all.push(...diags));
  return all;
}

/**
 * Run TypeScript diagnostics via tsc --noEmit (lightweight, no LSP server needed)
 */
export async function runTscDiagnostics(projectPath: string): Promise<LSPDiagnostic[]> {
  try {
    const { isTauriAvailable } = await import("./tauri-bridge");
    if (!isTauriAvailable()) return [];

    const { agentExecuteTool } = await import("./tauri-bridge");
    const result = await agentExecuteTool("Bash", { command: `cd "${projectPath}" && npx tsc --noEmit --pretty false 2>&1 | head -50` });

    const diags: LSPDiagnostic[] = [];
    const lines = result.split("\n");
    for (const line of lines) {
      const match = line.match(/^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/);
      if (match) {
        diags.push({
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          severity: match[4] as "error" | "warning",
          message: `${match[5]}: ${match[6]}`,
          source: "typescript",
        });
      }
    }
    diagnosticsCache.set(projectPath, diags);
    return diags;
  } catch {
    return [];
  }
}

/**
 * Run ESLint diagnostics
 */
export async function runEslintDiagnostics(projectPath: string): Promise<LSPDiagnostic[]> {
  try {
    const { isTauriAvailable } = await import("./tauri-bridge");
    if (!isTauriAvailable()) return [];

    const { agentExecuteTool } = await import("./tauri-bridge");
    const result = await agentExecuteTool("Bash", {
      command: `cd "${projectPath}" && npx eslint . --format compact 2>&1 | head -50`,
    });

    const diags: LSPDiagnostic[] = [];
    const lines = result.split("\n");
    for (const line of lines) {
      const match = line.match(/^(.+?): line (\d+), col (\d+), (Error|Warning) - (.+)$/);
      if (match) {
        diags.push({
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          severity: match[4].toLowerCase() as "error" | "warning",
          message: match[5],
          source: "eslint",
        });
      }
    }
    return diags;
  } catch {
    return [];
  }
}

/**
 * Format diagnostics for the agent context
 */
export function formatDiagnosticsForAgent(diags: LSPDiagnostic[]): string {
  if (diags.length === 0) return "✅ 无诊断问题";
  const errors = diags.filter(d => d.severity === "error");
  const warnings = diags.filter(d => d.severity === "warning");

  let output = `📋 诊断结果: ${errors.length} 错误, ${warnings.length} 警告\n\n`;
  for (const d of diags.slice(0, 20)) {
    const icon = d.severity === "error" ? "❌" : "⚠️";
    output += `${icon} ${d.file}:${d.line}:${d.column} — ${d.message}\n`;
  }
  if (diags.length > 20) output += `\n... 还有 ${diags.length - 20} 条\n`;
  return output;
}

/**
 * Get project language info
 */
export async function detectProjectLanguage(projectPath: string): Promise<string[]> {
  try {
    const { isTauriAvailable } = await import("./tauri-bridge");
    if (!isTauriAvailable()) return [];

    const { agentExecuteTool } = await import("./tauri-bridge");
    const result = await agentExecuteTool("Bash", {
      command: `cd "${projectPath}" && ls package.json tsconfig.json Cargo.toml go.mod pyproject.toml requirements.txt 2>/dev/null`,
    });
    const langs: string[] = [];
    if (result.includes("tsconfig.json")) langs.push("typescript");
    else if (result.includes("package.json")) langs.push("javascript");
    if (result.includes("Cargo.toml")) langs.push("rust");
    if (result.includes("go.mod")) langs.push("go");
    if (result.includes("pyproject.toml") || result.includes("requirements.txt")) langs.push("python");
    return langs;
  } catch {
    return [];
  }
}
