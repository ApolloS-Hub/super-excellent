/**
 * File Change Tracker — tracks files created/modified/deleted by the agent
 */

export interface FileChange {
  path: string;
  action: "create" | "modify" | "delete" | "read";
  timestamp: number;
  sizeBytes?: number;
}

let changes: FileChange[] = [];

export function trackFileChange(path: string, action: FileChange["action"], sizeBytes?: number): void {
  changes.push({ path, action, timestamp: Date.now(), sizeBytes });
}

export function getFileChanges(): FileChange[] {
  return [...changes];
}

export function clearFileChanges(): void {
  changes = [];
}

export function getChangeSummary(): string {
  if (changes.length === 0) return "";
  const created = changes.filter(c => c.action === "create");
  const modified = changes.filter(c => c.action === "modify");
  const deleted = changes.filter(c => c.action === "delete");
  const parts: string[] = [];
  if (created.length) parts.push(`📝 创建 ${created.length} 个文件`);
  if (modified.length) parts.push(`✏️ 修改 ${modified.length} 个文件`);
  if (deleted.length) parts.push(`🗑️ 删除 ${deleted.length} 个文件`);
  return parts.join("，");
}

export function formatFileChanges(): string {
  if (changes.length === 0) return "无文件变更";
  return changes.map(c => {
    const icon = { create: "📝", modify: "✏️", delete: "🗑️", read: "👁️" }[c.action];
    const size = c.sizeBytes ? ` (${formatBytes(c.sizeBytes)})` : "";
    return `${icon} ${c.path}${size}`;
  }).join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
