/**
 * Skills System — On-demand knowledge loading
 * Aligned with ref-s05: SkillMeta with trigger-based matching + system prompt injection.
 *
 * Two sources:
 * 1. Built-in hardcoded skills (below, simple topics)
 * 2. Bundled markdown skills in apps/desktop/skills/*.md (rich workflows
 *    with frontmatter, inspired by addyosmani/agent-skills)
 */

import i18n from "../i18n";
import { parseSkillMarkdown, buildSkillPromptSection, matchSkills as matchMarkdownSkills } from "./skill-loader";
import type { ParsedSkill } from "./skill-loader";
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

// ═══════════ Types ═══════════

export interface SkillMeta {
  name: string;
  description: string;
  trigger: string[];   // keywords that activate this skill
  content: string;     // full skill body injected into system prompt
}

// ═══════════ Built-in Skills ═══════════

const BUILTIN_SKILLS: SkillMeta[] = [
  {
    name: "code_review",
    description: "Code review best practices and checklist",
    trigger: ["review", "审查", "code review", "pr review", "代码审查", "pull request"],
    content: `## Skill: Code Review
- Check for correctness, readability, and maintainability
- Look for security vulnerabilities (injection, XSS, CSRF)
- Verify error handling and edge cases
- Check naming conventions and code style consistency
- Assess test coverage and suggest missing tests
- Review performance implications (N+1 queries, memory leaks)
- Ensure backward compatibility when modifying APIs
- Output format: severity (critical/warning/info) + file:line + description + suggestion`,
  },
  {
    name: "testing",
    description: "Testing strategies and patterns",
    trigger: ["test", "测试", "unit test", "e2e", "coverage", "spec", "assert", "jest", "vitest", "mocha"],
    content: `## Skill: Testing
- Use AAA pattern: Arrange → Act → Assert
- Test naming: describe('Module') / it('should <behavior> when <condition>')
- Cover: happy path, edge cases, error cases
- Unit tests: isolate dependencies with mocks/stubs
- Integration tests: test real interactions between modules
- E2E tests: simulate user workflows
- Target ≥80% code coverage for critical paths
- Use test fixtures and factories for consistent test data`,
  },
  {
    name: "debugging",
    description: "Systematic debugging methodology",
    trigger: ["debug", "调试", "bug", "error", "crash", "问题", "报错", "fix", "修复", "排查"],
    content: `## Skill: Debugging
- Step 1: Reproduce the issue consistently
- Step 2: Read the full error message and stack trace
- Step 3: Narrow the scope (binary search / git bisect)
- Step 4: Add targeted logging or breakpoints
- Step 5: Form a hypothesis and test it
- Step 6: Fix the root cause, not the symptom
- Step 7: Add a regression test
- Common patterns: null reference, race condition, state mutation, off-by-one, encoding issue`,
  },
  {
    name: "writing",
    description: "Technical writing and documentation",
    trigger: ["doc", "文档", "readme", "documentation", "写作", "changelog", "api doc", "jsdoc"],
    content: `## Skill: Technical Writing
- README structure: Title → Description → Quick Start → Installation → Usage → API → Contributing
- API docs: endpoint, method, params, request/response examples, error codes
- Use active voice, present tense
- Code examples must be runnable and tested
- Keep sentences short (≤25 words)
- Use headings, lists, and tables for scannability
- Add cross-references and links to related docs
- Version-stamp important docs (last updated date)`,
  },
];

// ═══════════ Registry ═══════════

const skillRegistry: SkillMeta[] = [...BUILTIN_SKILLS];

export function registerSkill(skill: SkillMeta): void {
  const idx = skillRegistry.findIndex(s => s.name === skill.name);
  if (idx >= 0) {
    skillRegistry[idx] = skill;
  } else {
    skillRegistry.push(skill);
  }
}

export function getSkill(name: string): SkillMeta | undefined {
  return skillRegistry.find(s => s.name === name);
}

export function listSkills(): SkillMeta[] {
  return [...skillRegistry];
}

/** Describe available skills compactly (for system prompt catalog) */
export function describeAvailable(): string {
  return skillRegistry
    .map(s => `- **${s.name}**: ${s.description}`)
    .join("\n");
}

// ═══════════ Intent Matching ═══════════

/**
 * Match user intent against skill triggers.
 * Returns matched skills sorted by relevance (most matches first).
 */
export function matchSkills(userMessage: string): SkillMeta[] {
  const lower = userMessage.toLowerCase();
  const scored = skillRegistry
    .map(skill => {
      const hits = skill.trigger.filter(t => lower.includes(t.toLowerCase()));
      return { skill, score: hits.length };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(r => r.skill);
}

/**
 * Build skill injection for system prompt.
 * Analyzes user message and returns content of matched skills.
 */
export function buildSkillPrompt(userMessage: string): string {
  const injected: string[] = [];

  // 1) Match built-in hardcoded skills (short topic helpers)
  const legacy = matchSkills(userMessage).slice(0, 1);
  for (const s of legacy) injected.push(s.content);

  // 2) Match bundled markdown skills (richer workflows with process + red flags + verification)
  const md = matchMarkdownSkills(userMessage, listMarkdownSkills(), 2);
  for (const s of md) injected.push(buildSkillPromptSection(s, 2000));

  if (injected.length === 0) return "";
  return `\n\n# ${t("skills.activatedSkills")}\n` + injected.join("\n\n");
}

// ═══════════ Bundled markdown skills ═══════════
// Vite's import.meta.glob bundles all .md files at build time.
// Each skill is parsed into ParsedSkill (frontmatter + body + searchText).

const markdownSkills: ParsedSkill[] = [];
let markdownSkillsLoaded = false;

/**
 * Load bundled markdown skills (called once on app start).
 * Uses Vite's glob import to inline .md files as raw strings.
 */
export function loadMarkdownSkills(): void {
  if (markdownSkillsLoaded) return;
  try {
    // Eager-loaded so all skills are available immediately.
    const modules = import.meta.glob("../../skills/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    for (const [path, raw] of Object.entries(modules)) {
      const parsed = parseSkillMarkdown(typeof raw === "string" ? raw : String(raw));
      if (parsed) {
        markdownSkills.push(parsed);
      } else {
        console.warn(`[skills] Failed to parse frontmatter: ${path}`);
      }
    }
    markdownSkillsLoaded = true;
    console.log(`[skills] Loaded ${markdownSkills.length} markdown skills`);

    // Auto-register slash commands for skills with a `command:` field
    void import("./commands").then(({ registerCommand }) => {
      for (const skill of markdownSkills) {
        const cmd = skill.frontmatter.command;
        if (!cmd) continue;
        const cleanName = cmd.replace(/^\//, "");
        if (!cleanName) continue;
        registerCommand({
          name: cleanName,
          description: skill.frontmatter.description.slice(0, 120),
          handler: () => {
            const section = buildSkillPromptSection(skill, 3000);
            return `## 📘 ${skill.frontmatter.name}\n\n${section}`;
          },
        });
      }
    }).catch(() => { /* commands module might not be loaded yet */ });
  } catch (e) {
    console.warn("[skills] Markdown glob import failed:", e);
    markdownSkillsLoaded = true; // don't retry in a loop
  }
}

export function listMarkdownSkills(): ParsedSkill[] {
  if (!markdownSkillsLoaded) loadMarkdownSkills();
  return [...markdownSkills];
}

export function getMarkdownSkill(name: string): ParsedSkill | undefined {
  if (!markdownSkillsLoaded) loadMarkdownSkills();
  return markdownSkills.find(s => s.frontmatter.name === name);
}

/** Describe all markdown skills for display in SkillMarketPage */
export interface MarkdownSkillSummary {
  name: string;
  description: string;
  phase?: string;
  category?: string;
  tags: string[];
  workers: string[];
}

export function summarizeMarkdownSkills(): MarkdownSkillSummary[] {
  return listMarkdownSkills().map(s => ({
    name: s.frontmatter.name,
    description: s.frontmatter.description,
    phase: s.frontmatter.phase,
    category: s.frontmatter.category,
    tags: s.frontmatter.tags || [],
    workers: s.frontmatter.workers || [],
  }));
}
