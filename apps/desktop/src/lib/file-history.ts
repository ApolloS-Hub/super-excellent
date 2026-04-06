/**
 * File History — automatic backup before every file modification
 * Supports diff view and rewind (undo) operations
 * Inspired by Claude Code's fileHistory.ts
 */

export interface FileBackup {
  path: string;
  originalContent: string;
  newContent: string;
  timestamp: number;
  toolCallId?: string;
}

export interface DiffLine {
  type: "add" | "remove" | "same";
  content: string;
  lineNumber: number;
}

let history: FileBackup[] = [];
const MAX_HISTORY = 100;

/**
 * Record a file backup before modification
 */
export function recordBackup(path: string, originalContent: string, newContent: string, toolCallId?: string): void {
  history.push({
    path,
    originalContent,
    newContent,
    timestamp: Date.now(),
    toolCallId,
  });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
}

/**
 * Get all backups for a file
 */
export function getFileBackups(path: string): FileBackup[] {
  return history.filter(b => b.path === path);
}

/**
 * Get all backups
 */
export function getAllBackups(): FileBackup[] {
  return [...history];
}

/**
 * Get the most recent backup for a file
 */
export function getLastBackup(path: string): FileBackup | null {
  const backups = getFileBackups(path);
  return backups.length > 0 ? backups[backups.length - 1] : null;
}

/**
 * Simple line-level diff
 */
export function computeDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: DiffLine[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  let lineNum = 1;

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined && newLine !== undefined) {
      result.push({ type: "add", content: newLine, lineNumber: lineNum++ });
    } else if (oldLine !== undefined && newLine === undefined) {
      result.push({ type: "remove", content: oldLine, lineNumber: lineNum++ });
    } else if (oldLine !== newLine) {
      result.push({ type: "remove", content: oldLine!, lineNumber: lineNum });
      result.push({ type: "add", content: newLine!, lineNumber: lineNum++ });
    } else {
      result.push({ type: "same", content: oldLine!, lineNumber: lineNum++ });
    }
  }
  return result;
}

/**
 * Format diff for display
 */
export function formatDiff(diff: DiffLine[]): string {
  return diff
    .filter(d => d.type !== "same")
    .map(d => {
      if (d.type === "add") return `+${d.lineNumber}: ${d.content}`;
      return `-${d.lineNumber}: ${d.content}`;
    })
    .join("\n");
}

/**
 * Get a summary of all changes in the session
 */
export function getChangeSummary(): string {
  if (history.length === 0) return "无文件变更";
  const files = new Set(history.map(b => b.path));
  return `${history.length} 次修改，涉及 ${files.size} 个文件:\n${[...files].map(f => `  - ${f}`).join("\n")}`;
}

/**
 * Check if we can rewind (undo) a file
 */
export function canRewind(path: string): boolean {
  return getFileBackups(path).length > 0;
}

/**
 * Get rewind content (the original before last edit)
 */
export function getRewindContent(path: string): string | null {
  const backup = getLastBackup(path);
  return backup?.originalContent ?? null;
}

/**
 * Clear history
 */
export function clearHistory(): void {
  history = [];
}
