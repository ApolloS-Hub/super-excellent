/**
 * Learning Engine — extracts patterns from conversations and stores them in mid-term memory.
 *
 * Learns:
 *   - Frequently used commands / tools
 *   - Preferred coding style
 *   - Project structure patterns
 *   - Error-fix patterns
 *
 * Runs once at the end of each conversation turn (analyzeConversation).
 * Extracted patterns are persisted via saveMidTerm (IndexedDB, 30-day TTL).
 */

import { saveMidTerm, pushShortTerm, type MidTermRecord } from "./memory";

// ────────────────────────── Types ──────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

interface ExtractedPattern {
  category: MidTermRecord["category"];
  content: string;
}

// ────────────────────────── Public API ──────────────────────────

/**
 * Analyze a completed conversation and persist learned patterns.
 * Call this at the end of each conversation turn.
 */
export async function analyzeConversation(turns: ConversationTurn[]): Promise<ExtractedPattern[]> {
  const patterns: ExtractedPattern[] = [];

  patterns.push(...extractCommandPatterns(turns));
  patterns.push(...extractStylePreferences(turns));
  patterns.push(...extractProjectPatterns(turns));
  patterns.push(...extractErrorFixPatterns(turns));

  for (const p of patterns) {
    await saveMidTerm({ category: p.category, content: p.content });
  }

  return patterns;
}

/**
 * Ingest a single user message into short-term memory for immediate context.
 */
export function ingestUserMessage(content: string): void {
  pushShortTerm({
    content,
    timestamp: Date.now(),
    source: "user",
    tags: classifyMessage(content),
  });
}

/**
 * Ingest an assistant response into short-term memory.
 */
export function ingestAssistantMessage(content: string): void {
  pushShortTerm({
    content: content.length > 300 ? content.slice(0, 300) + "…" : content,
    timestamp: Date.now(),
    source: "auto",
    tags: ["assistant"],
  });
}

// ────────────────────────── Extractors ──────────────────────────

const TOOL_NAMES = [
  "bash", "file_write", "file_read", "file_edit", "list_dir",
  "web_search", "web_fetch", "grep", "glob", "browser_open",
  "todo_write", "memory_write", "memory_read", "diff_view", "undo",
  "project_detect",
];

function extractCommandPatterns(turns: ConversationTurn[]): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];
  const toolCounts = new Map<string, number>();

  for (const t of turns) {
    if (t.toolName) {
      toolCounts.set(t.toolName, (toolCounts.get(t.toolName) || 0) + 1);
    }

    if (t.role === "user") {
      const bashMatch = t.content.match(/(?:运行|执行|run|exec)\s+[`"]?([a-zA-Z][\w.-]*(?:\s+\S+)*)[`"]?/i);
      if (bashMatch) {
        patterns.push({ category: "command", content: bashMatch[1].trim().slice(0, 120) });
      }
    }
  }

  for (const [tool, count] of toolCounts) {
    if (count >= 2) {
      patterns.push({ category: "command", content: `tool:${tool} (used ${count}× in session)` });
    }
  }

  return patterns;
}

function extractStylePreferences(turns: ConversationTurn[]): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];
  const userTexts = turns.filter((t) => t.role === "user").map((t) => t.content);
  const joined = userTexts.join(" ");

  const styleSignals: Array<[RegExp, string]> = [
    [/(?:用|使用|prefer)\s*(?:TypeScript|TS)/i, "Prefers TypeScript"],
    [/(?:用|使用|prefer)\s*(?:Python|py)/i, "Prefers Python"],
    [/(?:用|使用)\s*(?:函数式|functional)/i, "Prefers functional style"],
    [/(?:用|使用)\s*(?:class|类)/i, "Prefers class style"],
    [/(?:不要|别|避免)\s*(?:any|unknown)/i, "Avoids any/unknown"],
    [/(?:用|使用)\s*(?:async\/await|promise)/i, "Prefers async/await"],
    [/(?:不要|don'?t)\s*(?:注释|comment)/i, "Minimal comments"],
    [/(?:详细|verbose)\s*(?:注释|comment)/i, "Verbose comments"],
    [/(?:简洁|concise|简短)/i, "Prefers concise code"],
  ];

  for (const [re, label] of styleSignals) {
    if (re.test(joined)) {
      patterns.push({ category: "style", content: label });
    }
  }

  return patterns;
}

function extractProjectPatterns(turns: ConversationTurn[]): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];
  const allText = turns.map((t) => t.content).join("\n");

  const pathRe = /(?:\/[\w.-]+){2,}/g;
  const paths = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(allText)) !== null) {
    const p = m[0];
    if (p.length < 200 && !p.includes("node_modules")) {
      paths.add(p);
    }
  }

  for (const p of paths) {
    patterns.push({ category: "path", content: p });
  }

  return patterns;
}

function extractErrorFixPatterns(turns: ConversationTurn[]): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];

  for (let i = 0; i < turns.length - 1; i++) {
    const curr = turns[i];
    const next = turns[i + 1];

    const hasError =
      curr.content.includes("Error") ||
      curr.content.includes("error") ||
      curr.content.includes("失败") ||
      curr.content.includes("failed");

    const hasFix =
      next.content.includes("fix") ||
      next.content.includes("修复") ||
      next.content.includes("解决") ||
      next.content.includes("solved");

    if (hasError && hasFix) {
      const errorSnippet = curr.content.slice(0, 80);
      const fixSnippet = next.content.slice(0, 80);
      patterns.push({
        category: "pattern",
        content: `Error: ${errorSnippet} → Fix: ${fixSnippet}`,
      });
    }
  }

  return patterns;
}

// ────────────────────────── Helpers ──────────────────────────

function classifyMessage(text: string): string[] {
  const tags: string[] = [];
  if (/\?|？|怎么|how|what|why/i.test(text)) tags.push("question");
  if (/(?:创建|create|写|write|生成|generate)/i.test(text)) tags.push("create");
  if (/(?:修|fix|debug|bug|错误|error)/i.test(text)) tags.push("debug");
  if (/(?:搜索|search|找|find|查)/i.test(text)) tags.push("search");

  for (const t of TOOL_NAMES) {
    if (text.toLowerCase().includes(t)) {
      tags.push(`tool:${t}`);
      break;
    }
  }

  return tags.length > 0 ? tags : ["general"];
}
