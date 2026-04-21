/**
 * Artifact Store — save AI-generated files to a workspace directory
 *
 * Inspired by Cowork's "文件 = 唯一的渲染契约" principle:
 * Everything the AI produces (PPTX, HTML, reports) should exist
 * as a real file the user can find, open, and share — not just
 * inline text in a chat bubble.
 *
 * Storage hierarchy:
 *   {workDir}/artifacts/
 *     ├── 2026-04-21/
 *     │   ├── market-report.pptx
 *     │   ├── prototype-v1.html
 *     │   └── meeting-notes.md
 *     └── 2026-04-22/
 *         └── ...
 */

import { audit } from "./audit-logger";

export interface Artifact {
  id: string;
  fileName: string;
  type: "pptx" | "html" | "md" | "json" | "csv" | "pdf" | "png" | "svg" | "txt";
  /** Size in bytes */
  size: number;
  createdAt: number;
  /** Relative path within artifacts/ */
  path: string;
  /** What conversation produced this */
  conversationId?: string;
  /** What skill was used */
  skillUsed?: string;
}

const STORAGE_KEY = "artifact-registry";

function loadRegistry(): Artifact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRegistry(artifacts: Artifact[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(artifacts.slice(-500)));
  } catch { /* quota */ }
}

/**
 * Save a blob/string as an artifact. Uses Tauri fs if available,
 * otherwise triggers browser download.
 */
export async function saveArtifact(
  fileName: string,
  content: Blob | string,
  meta?: { conversationId?: string; skillUsed?: string },
): Promise<Artifact> {
  const ext = fileName.split(".").pop()?.toLowerCase() || "txt";
  const dateDir = new Date().toISOString().slice(0, 10);
  const safeName = fileName.replace(/[^a-zA-Z0-9一-鿿._-]/g, "_");
  const path = `${dateDir}/${safeName}`;
  const size = typeof content === "string" ? content.length : content.size;

  const artifact: Artifact = {
    id: `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    fileName: safeName,
    type: ext as Artifact["type"],
    size,
    createdAt: Date.now(),
    path,
    conversationId: meta?.conversationId,
    skillUsed: meta?.skillUsed,
  };

  // Try to save to filesystem via Tauri
  let savedToFs = false;
  try {
    const { isTauriAvailable } = await import("./tauri-bridge");
    if (isTauriAvailable()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const workDir = await getWorkDir();
      if (workDir) {
        const fullDir = `${workDir}/artifacts/${dateDir}`;
        // Create directory
        await invoke("execute_command", { command: `mkdir -p "${fullDir}"` });
        // Write file
        const textContent = typeof content === "string"
          ? content
          : await content.text();
        await invoke("write_file", {
          path: `${fullDir}/${safeName}`,
          content: textContent,
          allowedDirs: [workDir],
        });
        savedToFs = true;
      }
    }
  } catch { /* Tauri not available or write failed */ }

  // Fallback: trigger browser download
  if (!savedToFs) {
    const blob = typeof content === "string"
      ? new Blob([content], { type: getMimeType(ext) })
      : content;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Register in artifact list
  const registry = loadRegistry();
  registry.push(artifact);
  saveRegistry(registry);

  // Audit log
  audit("export", "system", safeName, `Saved artifact: ${path} (${formatSize(size)})`, { ok: true });

  return artifact;
}

/**
 * List all artifacts, newest first.
 */
export function listArtifacts(limit: number = 50): Artifact[] {
  return loadRegistry().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/**
 * List artifacts grouped by date.
 */
export function listArtifactsByDate(): Record<string, Artifact[]> {
  const all = loadRegistry().sort((a, b) => b.createdAt - a.createdAt);
  const groups: Record<string, Artifact[]> = {};
  for (const a of all) {
    const date = new Date(a.createdAt).toISOString().slice(0, 10);
    if (!groups[date]) groups[date] = [];
    groups[date].push(a);
  }
  return groups;
}

/**
 * Get artifact count.
 */
export function getArtifactCount(): number {
  return loadRegistry().length;
}

/**
 * Clear artifact registry (doesn't delete files).
 */
export function clearArtifactRegistry(): void {
  saveRegistry([]);
}

// ═══════════ Helpers ═══════════

async function getWorkDir(): Promise<string | null> {
  try {
    const raw = localStorage.getItem("agent-config");
    if (!raw) return null;
    const config = JSON.parse(raw);
    return config.workDir || null;
  } catch { return null; }
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    html: "text/html",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
  };
  return types[ext] || "application/octet-stream";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
