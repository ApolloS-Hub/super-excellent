/**
 * ai-slop-cleaner.ts — Pattern-based AI output sanitizer (oh-my-codex pattern)
 *
 * Strips telltale LLM artifacts from generated code:
 * - "As an AI, I..." / "Certainly! Here's..." preambles
 * - Redundant comments that restate the obvious (// increment x above x++)
 * - Emoji-laden log strings the user didn't ask for
 * - "TODO: implement" style placeholders paired with empty bodies
 *
 * All rules are conservative and idempotent: running the cleaner twice
 * produces the same output as running it once.
 */

export interface SlopFinding {
  line: number;
  rule: string;
  original: string;
  replacement: string;
}

export interface CleanResult {
  original: string;
  cleaned: string;
  findings: SlopFinding[];
}

interface Rule {
  name: string;
  /** Operate on the whole file (rarely needed). */
  whole?: (text: string) => string;
  /** Operate line-by-line. Return null to delete the line, or the new line. */
  line?: (line: string, index: number) => string | null;
}

const REDUNDANT_COMMENT_PATTERNS = [
  /^\s*\/\/\s*(increment|decrement|set|assign|call|return|check|loop|iterate over|add|subtract|multiply|divide)\b/i,
  /^\s*\/\/\s*this (is|returns|does|sets|gets|creates|handles)\b.*/i,
  /^\s*#\s*(increment|decrement|set|assign|return|loop over|iterate over)\b/i,
];

const AI_PREAMBLE_PATTERNS = [
  /^\s*\/\/\s*(certainly|of course|here(?:'s| is)|sure|absolutely)[!,.]?\s/i,
  /^\s*\/\*+\s*(certainly|of course|here(?:'s| is)|sure|absolutely)[!,.]?.*\*\/\s*$/i,
  /^\s*\/\/\s*as an ai\b.*/i,
  /^\s*#\s*as an ai\b.*/i,
];

const EMOJI_LOG_PATTERN = /console\.(log|info|warn|error)\(\s*["'`](?:🎉|✨|🚀|🔥|💯|🎊|🌟)/;

const RULES: Rule[] = [
  {
    name: "trailing-whitespace",
    line: (line) => line.replace(/\s+$/, ""),
  },
  {
    name: "ai-preamble",
    line: (line) => (AI_PREAMBLE_PATTERNS.some(r => r.test(line)) ? null : line),
  },
  {
    name: "redundant-comment",
    line: (line) => (REDUNDANT_COMMENT_PATTERNS.some(r => r.test(line)) ? null : line),
  },
  {
    name: "emoji-log",
    line: (line) => (EMOJI_LOG_PATTERN.test(line) ? null : line),
  },
  {
    name: "empty-todo-stub",
    line: (line) => (/^\s*\/\/\s*TODO:\s*implement(\s+this)?\s*$/i.test(line) ? null : line),
  },
  {
    name: "collapse-blank-lines",
    whole: (text) => text.replace(/\n{3,}/g, "\n\n"),
  },
];

export function cleanSlop(source: string): CleanResult {
  const findings: SlopFinding[] = [];
  const originalLines = source.split("\n");
  let lines: Array<string | null> = [...originalLines];

  for (const rule of RULES) {
    if (!rule.line) continue;
    lines = lines.map((line, i) => {
      if (line == null) return null;
      const out = rule.line!(line, i);
      if (out !== line) {
        findings.push({
          line: i + 1,
          rule: rule.name,
          original: line,
          replacement: out ?? "(deleted)",
        });
      }
      return out;
    });
  }

  let cleaned = lines.filter((l): l is string => l !== null).join("\n");
  for (const rule of RULES) {
    if (!rule.whole) continue;
    const next = rule.whole(cleaned);
    if (next !== cleaned) {
      findings.push({
        line: 0,
        rule: rule.name,
        original: "(whole-file transform)",
        replacement: "(applied)",
      });
      cleaned = next;
    }
  }

  return { original: source, cleaned, findings };
}

export function summarizeFindings(result: CleanResult): string {
  if (result.findings.length === 0) return "✨ No AI slop detected.";
  const byRule = new Map<string, number>();
  for (const f of result.findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const lines = ["## 🧹 AI Slop Cleaner", "", `Removed **${result.findings.length}** issue(s):`, ""];
  for (const [rule, count] of byRule) lines.push(`- \`${rule}\`: ${count}`);
  return lines.join("\n");
}
