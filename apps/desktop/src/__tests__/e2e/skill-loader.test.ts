import { describe, it, expect } from "vitest";
import {
  parseSkillMarkdown,
  extractSection,
  matchSkills,
  buildSkillPromptSection,
} from "../../lib/skill-loader";

const SAMPLE_SKILL = `---
name: test-skill
description: Use when writing tests. Enforces RED-GREEN-REFACTOR cycle.
phase: build
category: quality
tags: [test, tdd, unit-test]
triggers: [测试, tdd]
workers: [developer, tester]
---

# Test Skill

## Overview
This is the overview.

## When to Use
- Scenario 1
- Scenario 2

## Process

### Step 1: First
Do the first thing.

### Step 2: Second
Do the second thing.

## Red Flags
- Bad sign 1
- Bad sign 2

## Verification
- [ ] Check one
- [ ] Check two
`;

describe("parseSkillMarkdown", () => {
  it("parses frontmatter correctly", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.name).toBe("test-skill");
    expect(parsed!.frontmatter.description).toContain("RED-GREEN-REFACTOR");
    expect(parsed!.frontmatter.phase).toBe("build");
    expect(parsed!.frontmatter.tags).toEqual(["test", "tdd", "unit-test"]);
    expect(parsed!.frontmatter.workers).toEqual(["developer", "tester"]);
  });

  it("extracts body separately from frontmatter", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL);
    expect(parsed!.body).toContain("# Test Skill");
    expect(parsed!.body).toContain("## Overview");
    expect(parsed!.body).not.toContain("name: test-skill");
  });

  it("builds searchText for matching", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL);
    expect(parsed!.searchText).toContain("test-skill");
    expect(parsed!.searchText).toContain("tdd");
    expect(parsed!.searchText).toContain("red-green");
  });

  it("returns null without frontmatter", () => {
    expect(parseSkillMarkdown("# Just a heading")).toBeNull();
  });

  it("returns null with malformed frontmatter", () => {
    expect(parseSkillMarkdown("---\nno name\n---\nbody")).toBeNull();
  });

  it("handles inline array syntax", () => {
    const md = `---
name: s
description: d
tags: [a, b, c]
---

body`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed!.frontmatter.tags).toEqual(["a", "b", "c"]);
  });

  it("handles multi-line array syntax", () => {
    const md = `---
name: s
description: d
tags:
  - a
  - b
  - c
---

body`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed!.frontmatter.tags).toEqual(["a", "b", "c"]);
  });
});

describe("extractSection", () => {
  it("extracts a section content without the heading", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL)!;
    const overview = extractSection(parsed.body, "Overview");
    expect(overview).toBe("This is the overview.");
  });

  it("extracts a section with subsections", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL)!;
    const process = extractSection(parsed.body, "Process");
    expect(process).toContain("### Step 1: First");
    expect(process).toContain("### Step 2: Second");
  });

  it("returns null for nonexistent section", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL)!;
    expect(extractSection(parsed.body, "Nonexistent")).toBeNull();
  });

  it("stops at next same-level heading", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL)!;
    const redFlags = extractSection(parsed.body, "Red Flags");
    expect(redFlags).not.toContain("Verification");
  });
});

describe("matchSkills", () => {
  const s1 = parseSkillMarkdown(SAMPLE_SKILL)!;
  const s2 = parseSkillMarkdown(`---
name: debugging-skill
description: Use when fixing bugs or debugging failures.
tags: [debug, error, bug]
triggers: [bug, debug, error]
---

body`)!;

  it("matches by trigger keyword", () => {
    const matched = matchSkills("I need to debug this", [s1, s2]);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].frontmatter.name).toBe("debugging-skill");
  });

  it("matches by tag", () => {
    const matched = matchSkills("how to write unit-test", [s1, s2]);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].frontmatter.name).toBe("test-skill");
  });

  it("returns empty when no match", () => {
    const matched = matchSkills("completely unrelated topic", [s1, s2]);
    expect(matched.length).toBe(0);
  });

  it("respects limit parameter", () => {
    const matched = matchSkills("test debug bug tdd", [s1, s2], 1);
    expect(matched.length).toBeLessThanOrEqual(1);
  });
});

describe("buildSkillPromptSection", () => {
  it("builds a compact prompt section", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL)!;
    const section = buildSkillPromptSection(parsed);
    expect(section).toContain("## Skill: test-skill");
    expect(section).toContain("### Overview");
    expect(section).toContain("### Process");
    expect(section).toContain("### Red Flags");
    expect(section).toContain("### Verification");
  });

  it("truncates when over maxChars", () => {
    const parsed = parseSkillMarkdown(SAMPLE_SKILL)!;
    const short = buildSkillPromptSection(parsed, 100);
    expect(short.length).toBeLessThanOrEqual(150);
    expect(short).toContain("truncated");
  });
});
