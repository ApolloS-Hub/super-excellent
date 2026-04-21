/**
 * project-wiki.ts — Markdown-first searchable knowledge base (oh-my-codex pattern)
 *
 * Stores notes as plain .md files under <workDir>/wiki/. Slugs are derived
 * from titles (kebab-case, ascii-only). Search is a naive substring + token
 * scan that works without a dependency on any indexer.
 */

import { isTauriAvailable, readFileTauri, writeFileTauri, listDirectoryTauri } from "./tauri-bridge";

export interface WikiEntry {
  slug: string;
  title: string;
  path: string;
  tags: string[];
  updatedAt: number;
  snippet: string;
}

export interface SearchHit {
  entry: WikiEntry;
  score: number;
  matches: string[];
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || `entry-${Date.now()}`;
}

function wikiRoot(workDir: string): string {
  return `${workDir.replace(/\/$/, "")}/wiki`;
}

export function parseFrontmatter(md: string): { tags: string[]; title?: string; body: string } {
  if (!md.startsWith("---")) return { tags: [], body: md };
  const end = md.indexOf("\n---", 3);
  if (end === -1) return { tags: [], body: md };
  const fm = md.slice(3, end).trim();
  const body = md.slice(end + 4).replace(/^\n/, "");
  const tags: string[] = [];
  let title: string | undefined;
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    if (m[1] === "tags") {
      tags.push(...m[2].split(/[,\s]+/).map(s => s.replace(/^#/, "")).filter(Boolean));
    } else if (m[1] === "title") {
      title = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { tags, title, body };
}

export function buildEntry(slug: string, path: string, content: string, updatedAt: number): WikiEntry {
  const fm = parseFrontmatter(content);
  const body = fm.body;
  const firstHeadingMatch = body.match(/^#\s+(.+)$/m);
  const title = fm.title ?? firstHeadingMatch?.[1] ?? slug;
  const snippet = body.replace(/[#*`>]/g, "").split("\n").find(l => l.trim().length > 0) ?? "";
  return {
    slug,
    title,
    path,
    tags: fm.tags,
    updatedAt,
    snippet: snippet.slice(0, 200),
  };
}

export async function listEntries(workDir: string): Promise<WikiEntry[]> {
  if (!isTauriAvailable() || !workDir) return [];
  try {
    const dir = wikiRoot(workDir);
    const entries = await listDirectoryTauri(dir);
    const out: WikiEntry[] = [];
    for (const e of entries) {
      if (e.is_dir || !e.path.endsWith(".md")) continue;
      try {
        const content = await readFileTauri(e.path);
        const slug = e.name.replace(/\.md$/, "");
        out.push(buildEntry(slug, e.path, content, Date.now()));
      } catch { /* skip unreadable */ }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  } catch {
    return [];
  }
}

export async function saveEntry(workDir: string, title: string, body: string, tags: string[] = []): Promise<WikiEntry | null> {
  if (!isTauriAvailable() || !workDir) return null;
  const slug = slugify(title);
  const path = `${wikiRoot(workDir)}/${slug}.md`;
  const fm = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `tags: ${tags.join(", ")}`,
    `updated: ${new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  const full = `${fm}${body}`;
  try {
    await writeFileTauri(path, full);
    return buildEntry(slug, path, full, Date.now());
  } catch {
    return null;
  }
}

export async function getEntry(workDir: string, slug: string): Promise<{ entry: WikiEntry; content: string } | null> {
  if (!isTauriAvailable() || !workDir) return null;
  const path = `${wikiRoot(workDir)}/${slug}.md`;
  try {
    const content = await readFileTauri(path);
    return { entry: buildEntry(slug, path, content, Date.now()), content };
  } catch {
    return null;
  }
}

/**
 * Cheap search: tokenize the query, score each entry by how many tokens
 * appear in its title (weight 3), tags (weight 2), or body snippet (1).
 */
export async function search(workDir: string, query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(t => t.length >= 2);
  const entries = await listEntries(workDir);
  const hits: SearchHit[] = [];

  for (const e of entries) {
    let score = 0;
    const matches: string[] = [];
    const title = e.title.toLowerCase();
    const snip = e.snippet.toLowerCase();
    const tagText = e.tags.join(" ").toLowerCase();
    for (const tok of tokens) {
      if (title.includes(tok)) { score += 3; matches.push(`title:${tok}`); }
      if (tagText.includes(tok)) { score += 2; matches.push(`tag:${tok}`); }
      if (snip.includes(tok)) { score += 1; matches.push(`body:${tok}`); }
    }
    if (score > 0) hits.push({ entry: e, score, matches });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
