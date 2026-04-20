/**
 * Instruction Memory — user-curated rules that override agent auto-learning.
 *
 * Inspired by keli-wen/agentic-harness-patterns (Memory Pattern):
 *   "Separate instruction memory (curated), auto-memory (agent-written),
 *    and session extraction — each with different trust levels."
 *
 * Instruction memory is:
 * - Explicitly set by the user ("/remember always use TypeScript")
 * - Never silently overwritten by agent learning
 * - Never expires
 * - Takes priority over conflicting auto-memory
 *
 * Storage: localStorage key `instruction-memory` as JSON array.
 */

export interface InstructionRule {
  id: string;
  rule: string;
  createdAt: number;
  /** Optional category for grouping in UI */
  category?: string;
  /** Optional enabled flag — user can pause without deleting */
  enabled?: boolean;
}

const STORAGE_KEY = "instruction-memory";

function load(): InstructionRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => r && typeof r.id === "string" && typeof r.rule === "string");
  } catch {
    return [];
  }
}

function save(rules: InstructionRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch { /* quota */ }
}

function generateId(): string {
  return `ir_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Add a new instruction rule. Returns the created rule. */
export function addRule(rule: string, category?: string): InstructionRule {
  const rules = load();
  const newRule: InstructionRule = {
    id: generateId(),
    rule: rule.trim(),
    createdAt: Date.now(),
    category,
    enabled: true,
  };
  rules.push(newRule);
  save(rules);
  return newRule;
}

/** Remove a rule by ID. Returns true if removed. */
export function removeRule(id: string): boolean {
  const rules = load();
  const before = rules.length;
  const next = rules.filter(r => r.id !== id);
  if (next.length === before) return false;
  save(next);
  return true;
}

/** Toggle a rule's enabled state */
export function toggleRule(id: string): boolean {
  const rules = load();
  const rule = rules.find(r => r.id === id);
  if (!rule) return false;
  rule.enabled = rule.enabled === false ? true : false;
  save(rules);
  return true;
}

/** List all rules (including disabled) */
export function listRules(): InstructionRule[] {
  return load();
}

/** Get active (enabled) rules only */
export function listActiveRules(): InstructionRule[] {
  return load().filter(r => r.enabled !== false);
}

/** Clear all rules */
export function clearRules(): void {
  save([]);
}

/**
 * Build the instruction prompt section for injection into system prompt.
 * Format:
 *   ## User Instructions (always follow these)
 *   - Rule 1
 *   - Rule 2
 */
export function buildInstructionPrompt(): string {
  const active = listActiveRules();
  if (active.length === 0) return "";

  const byCategory = new Map<string, InstructionRule[]>();
  for (const r of active) {
    const cat = r.category || "general";
    const list = byCategory.get(cat) ?? [];
    list.push(r);
    byCategory.set(cat, list);
  }

  const sections: string[] = ["## User Instructions (always follow these)"];
  for (const [cat, rules] of byCategory) {
    if (cat !== "general") sections.push(`\n### ${cat}`);
    for (const r of rules) {
      sections.push(`- ${r.rule}`);
    }
  }
  return sections.join("\n");
}

/**
 * Check if a string contains any of the instruction rules (for verification).
 * Used by StopHooks to ensure agent didn't violate a rule.
 */
export function violatesAnyRule(text: string): InstructionRule | null {
  const active = listActiveRules();
  const lower = text.toLowerCase();
  for (const rule of active) {
    // Simple heuristic: look for "NEVER X" / "不要 X" patterns in rule
    const neverMatch = rule.rule.match(/(?:never|don't|avoid|不要|禁止|别)\s+(.+?)(?:\.|$)/i);
    if (neverMatch) {
      const forbidden = neverMatch[1].toLowerCase().trim();
      if (forbidden.length > 3 && lower.includes(forbidden)) {
        return rule;
      }
    }
  }
  return null;
}
