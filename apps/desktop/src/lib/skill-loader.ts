/**
 * Skill Loader — parses markdown skill files with YAML frontmatter
 *
 * Inspired by addyosmani/agent-skills.
 * Each skill is a .md file with YAML frontmatter describing metadata,
 * followed by markdown body containing the workflow guidance.
 *
 * Format:
 * ---
 * name: skill-name-slug
 * description: When to use this skill (used for auto-triggering)
 * phase: define|plan|build|verify|review|ship|business
 * category: efficiency|content|market|data|...
 * tags: [tag1, tag2]
 * workers: [developer, tester]   # which workers benefit
 * ---
 *
 * # Skill Title
 *
 * ## Overview
 * ## When to Use
 * ## Process
 * ## Rationalizations
 * ## Red Flags
 * ## Verification
 */

export interface SkillFrontmatter {
  name: string;
  description: string;
  phase?: "define" | "plan" | "build" | "verify" | "review" | "ship" | "business" | "reflect";
  category?: string;
  tags?: string[];
  workers?: string[];
  triggers?: string[];
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  /** Concatenated title + description for matching */
  searchText: string;
}

/**
 * Parse a markdown skill file into frontmatter + body.
 * Returns null if frontmatter is missing or malformed.
 */
export function parseSkillMarkdown(markdown: string): ParsedSkill | null {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith("---")) return null;

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) return null;

  const frontmatterText = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trim();

  const frontmatter = parseYamlFrontmatter(frontmatterText);
  if (!frontmatter || !frontmatter.name || !frontmatter.description) return null;

  return {
    frontmatter,
    body,
    searchText: `${frontmatter.name} ${frontmatter.description} ${(frontmatter.tags || []).join(" ")} ${(frontmatter.triggers || []).join(" ")}`.toLowerCase(),
  };
}

/**
 * Minimal YAML frontmatter parser.
 * Supports: string values, arrays (inline or multiline), booleans, numbers.
 * Does NOT support nested objects.
 */
function parseYamlFrontmatter(text: string): SkillFrontmatter | null {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Skip empty/comment lines
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    const rawValue = match[2].trim();

    // Inline array: [a, b, c]
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      result[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map(s => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      i++;
      continue;
    }

    // Multi-line array
    if (rawValue === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const itemMatch = nextLine.match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
          j++;
        } else if (nextLine.trim() === "") {
          j++;
        } else {
          break;
        }
      }
      if (items.length > 0) {
        result[key] = items;
        i = j;
        continue;
      }
    }

    // Quoted string
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      result[key] = rawValue.slice(1, -1);
      i++;
      continue;
    }

    // Multi-line continuation (description lines starting with indent)
    if (rawValue && !rawValue.match(/^(true|false|\d+)$/)) {
      let fullValue = rawValue;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine.match(/^(\w[\w-]*):/) || nextLine.trim() === "") break;
        if (nextLine.startsWith("  ")) {
          fullValue += " " + nextLine.trim();
          j++;
        } else {
          break;
        }
      }
      result[key] = fullValue;
      i = j;
      continue;
    }

    // Boolean / number
    if (rawValue === "true") result[key] = true;
    else if (rawValue === "false") result[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) result[key] = Number(rawValue);
    else result[key] = rawValue;

    i++;
  }

  if (!result.name || !result.description) return null;
  return result as unknown as SkillFrontmatter;
}

/**
 * Extract a specific section from a markdown body (e.g., "Process", "When to Use").
 * Returns the section content (without heading), or null if not found.
 */
export function extractSection(body: string, sectionName: string): string | null {
  const lines = body.split("\n");
  const re = new RegExp(`^#{1,4}\\s+${sectionName}\\s*$`, "i");

  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      startIdx = i + 1;
      const m = lines[i].match(/^(#+)/);
      startLevel = m ? m[1].length : 2;
      break;
    }
  }
  if (startIdx === -1) return null;

  const content: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const h = lines[i].match(/^(#+)\s/);
    if (h && h[1].length <= startLevel) break;
    content.push(lines[i]);
  }
  return content.join("\n").trim() || null;
}

/**
 * Match skills against a user message. Returns skills sorted by relevance.
 */
export function matchSkills(userMessage: string, skills: ParsedSkill[], limit: number = 2): ParsedSkill[] {
  const msg = userMessage.toLowerCase();
  const terms = msg.split(/\s+/).filter(t => t.length > 1);

  const scored = skills.map(skill => {
    let score = 0;
    const hay = skill.searchText;

    // Exact tag/trigger matches are worth more
    for (const tag of skill.frontmatter.tags || []) {
      if (msg.includes(tag.toLowerCase())) score += 5;
    }
    for (const trigger of skill.frontmatter.triggers || []) {
      if (msg.includes(trigger.toLowerCase())) score += 10;
    }

    // Word-level matches in description
    for (const term of terms) {
      if (term.length < 3) continue;
      if (hay.includes(term)) score += 1;
    }

    return { skill, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.skill);
}

/**
 * Build a compact skill prompt section to inject into worker system prompt.
 * Returns the Overview + Process + Red Flags + Verification, truncated.
 */
export function buildSkillPromptSection(skill: ParsedSkill, maxChars: number = 2000): string {
  const overview = extractSection(skill.body, "Overview") || "";
  const process = extractSection(skill.body, "Process") || extractSection(skill.body, "Approach") || "";
  const redFlags = extractSection(skill.body, "Red Flags") || "";
  const verification = extractSection(skill.body, "Verification") || "";

  const parts: string[] = [];
  parts.push(`## Skill: ${skill.frontmatter.name}`);
  if (overview) parts.push(`### Overview\n${overview}`);
  if (process) parts.push(`### Process\n${process}`);
  if (redFlags) parts.push(`### Red Flags\n${redFlags}`);
  if (verification) parts.push(`### Verification\n${verification}`);

  const full = parts.join("\n\n");
  if (full.length <= maxChars) return full;
  return full.slice(0, maxChars) + "\n\n*(truncated)*";
}
