/**
 * Memory Nudges — Hermes-inspired proactive memory persistence.
 *
 * The secretary doesn't just passively record everything — it actively
 * decides "this is worth remembering" based on conversation patterns.
 * Runs after each assistant response, scanning for signals that indicate
 * durable knowledge (decisions, preferences, facts, commitments).
 */
import { memoryStore, type MemoryCategory } from "./memory-store";
import { addToContext, type ContextSnapshot } from "./context-bootstrap";
import { emitAgentEvent } from "./event-bus";

// ═══════════ Nudge patterns ═══════════

interface NudgePattern {
  category: MemoryCategory;
  contextSection?: keyof ContextSnapshot;
  patterns: RegExp[];
  extract: (match: RegExpMatchArray) => string;
}

const NUDGE_PATTERNS: NudgePattern[] = [
  // Decisions
  {
    category: "fact",
    contextSection: "recentDecisions",
    patterns: [
      /(?:we\s+)?decided\s+(?:to\s+)?(.{10,80})/i,
      /决定(?:了)?\s*[:：]?\s*(.{5,60})/,
      /(?:let'?s\s+)?go\s+with\s+(.{10,60})/i,
      /选择(?:了)?\s*[:：]?\s*(.{5,60})/,
      /the\s+plan\s+is\s+(?:to\s+)?(.{10,80})/i,
      /方案(?:是|为)\s*[:：]?\s*(.{5,60})/,
    ],
    extract: (m) => m[1].trim(),
  },
  // User preferences
  {
    category: "preference",
    patterns: [
      /(?:i\s+)?prefer\s+(.{5,60})/i,
      /(?:i\s+)?(?:like|want)\s+(?:to\s+)?(.{5,60})\s+(?:better|more|instead)/i,
      /我(?:喜欢|偏好|习惯)\s*(.{3,40})/,
      /(?:always|never)\s+(.{5,60})/i,
      /以后(?:都|一直)\s*(.{3,40})/,
    ],
    extract: (m) => m[1].trim(),
  },
  // Commitments / promises
  {
    category: "fact",
    contextSection: "pendingTasks",
    patterns: [
      /(?:i(?:'ll| will)\s+)(.{10,80})\s+(?:by|before|tomorrow|next|this)/i,
      /(?:我|咱们?)(?:会|要|得)\s*(.{5,60})\s*(?:之前|以前|明天|下周|这周)/,
      /remind\s+me\s+to\s+(.{5,60})/i,
      /提醒我\s*(.{5,40})/,
    ],
    extract: (m) => m[1].trim(),
  },
  // Facts / names / contacts
  {
    category: "fact",
    patterns: [
      /(?:my|our)\s+(?:boss|manager|lead|CTO|CEO|director)\s+(?:is\s+)?(\w[\w\s]{2,30})/i,
      /(?:我的?|我们)\s*(?:老板|领导|经理|负责人|主管)\s*(?:是|叫)\s*(.{2,20})/,
      /(?:the\s+)?password\s+(?:is|for)\s+/i, // ANTI-pattern: do NOT store passwords
    ],
    extract: (m) => {
      // Never store password-like content
      if (/password|密码|token|key|secret/i.test(m[0])) return "";
      return m[1].trim();
    },
  },
  // Project names
  {
    category: "project",
    contextSection: "activeProjects",
    patterns: [
      /working\s+on\s+(?:the\s+)?(.{5,40})\s+(?:project|feature|task|app|system)/i,
      /(?:在做|正在开发|负责)\s*(.{3,30})\s*(?:项目|功能|系统|模块)/,
    ],
    extract: (m) => m[1].trim(),
  },
  // Deadlines
  {
    category: "fact",
    contextSection: "upcomingDeadlines",
    patterns: [
      /(?:deadline|due)\s*(?:is|:)?\s*(.{5,40})/i,
      /截止(?:日期|时间)?\s*(?:是|为|:)?\s*(.{5,30})/,
      /(?:due\s+)?(?:by|before)\s+(\w+day|\d{1,2}[/\-]\d{1,2}(?:[/\-]\d{2,4})?)/i,
    ],
    extract: (m) => m[1].trim(),
  },
];

// ═══════════ Nudge engine ═══════════

const COOLDOWN_MS = 30_000; // Don't nudge the same content twice in 30s
const _recentNudges = new Set<string>();

function hashNudge(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").slice(0, 50);
}

/**
 * Scan a user message + assistant response for things worth remembering.
 * Called after each meaningful conversation exchange.
 * Returns the number of items nudged into memory.
 */
export async function nudgeMemory(userMessage: string, assistantResponse: string): Promise<number> {
  const combined = `${userMessage}\n${assistantResponse}`;
  let nudged = 0;

  for (const pattern of NUDGE_PATTERNS) {
    for (const regex of pattern.patterns) {
      // Reset regex state for global patterns
      regex.lastIndex = 0;
      const match = regex.exec(combined);
      if (!match) continue;

      const content = pattern.extract(match);
      if (!content || content.length < 3) continue;

      // Cooldown dedup
      const hash = hashNudge(content);
      if (_recentNudges.has(hash)) continue;
      _recentNudges.add(hash);
      setTimeout(() => _recentNudges.delete(hash), COOLDOWN_MS);

      // Store in memory-store
      try {
        await memoryStore.save({
          key: `nudge_${Date.now()}_${nudged}`,
          content,
          category: pattern.category,
        });
      } catch { /* memory store not available */ }

      // Also update context-bootstrap if applicable
      if (pattern.contextSection) {
        try {
          addToContext(pattern.contextSection, content);
        } catch { /* context not available */ }
      }

      nudged++;
    }
  }

  if (nudged > 0) {
    emitAgentEvent({
      type: "intent_analysis",
      intentType: "memory_nudge",
      text: `Auto-remembered ${nudged} item(s) from conversation`,
    });
  }

  return nudged;
}

/**
 * Check if a piece of text contains sensitive content that should NOT be stored.
 */
export function isSensitive(text: string): boolean {
  const SENSITIVE = /password|密码|token|api.?key|secret|credential|private.?key|ssh|pgp/i;
  return SENSITIVE.test(text);
}
