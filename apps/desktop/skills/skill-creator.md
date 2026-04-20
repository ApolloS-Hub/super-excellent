---
name: skill-creator
description: Use when the user asks to add a new skill, create a workflow, or teach the agent a new repeatable task. Produces a complete SKILL.md file.
phase: define
category: meta
tags: [skill, workflow, template, meta]
triggers: [新技能, 创建技能, create skill, new skill, add workflow, 添加工作流]
workers: [writer, product, architect]
command: /new-skill
---

# Skill Creator

## Overview
Users often have repeatable tasks they'd like to "teach" the AI Secretary. This skill guides the creation of a new `SKILL.md` file from a natural-language description of the workflow.

## When to Use
- User says "teach yourself how to X" / "帮我加一个 X 技能"
- User repeats the same multi-step ask in different sessions
- User describes a workflow they want documented as a reusable pattern

## Process

### 1. Clarify the workflow
Ask the user (one turn):
- **Name** of the skill (short, lowercase-hyphen)
- **Goal**: what does a successful run look like?
- **Trigger words**: what phrases should activate it?
- **Which worker(s)** should execute it? (developer / tester / writer / ...)
- **Which existing tools** does it use? (web_search, file_write, lark_calendar, ...)

### 2. Sketch the workflow steps
Draft 3-7 concrete steps:
- Each step starts with a verb
- Each step has a verifiable "done" condition
- Note dependencies between steps

### 3. Identify red flags
Common failure modes — things the agent must NOT do:
- Skipping verification
- Silently falling back to defaults
- Proceeding without required inputs

### 4. Generate the SKILL.md file

Save to `apps/desktop/skills/{name}.md` using this template:

```markdown
---
name: {lowercase-hyphen-name}
description: One paragraph: when to use this skill and what it accomplishes.
phase: define|plan|build|verify|review|ship|business
category: {efficiency|content|data|quality|business}
tags: [tag1, tag2, tag3]
triggers: [中文关键词, english keyword, another one]
workers: [worker_id1, worker_id2]
command: /optional-slash
---

# {Skill Title}

## Overview
{One paragraph: problem this skill solves + core principle}

## When to Use
- {Scenario 1}
- {Scenario 2}
- {Scenario 3}

## Process

### 1. {First step verb}
{What to do, with specifics}

### 2. {Second step verb}
{...}

### 3. {Final step: verify}
{...}

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "{Common shortcut excuse}" | "{Why it's wrong}" |

## Red Flags
- {Warning sign 1}
- {Warning sign 2}

## Verification
- [ ] {Checkpoint 1}
- [ ] {Checkpoint 2}
- [ ] {Checkpoint 3}
```

### 5. Test the skill
After creation, the user should be able to trigger it by:
- Typing any of the listed `triggers` in natural language
- OR typing the `command` slash shortcut (if defined)
- OR restarting the app (skills load on startup)

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "The description is obvious" | A vague description means it won't trigger reliably |
| "I'll add triggers later" | Without triggers, the skill never activates |
| "Red flags are nitpicking" | Red flags are the reason skills beat raw prompts |
| "Just copy an existing skill" | Copying hides design decisions — think through each field |

## Red Flags
- `description` under 1 sentence
- No triggers at all
- Process steps without verifiable "done" criteria
- Same skill as an existing one (check listMarkdownSkills first)
- No Red Flags or Verification sections

## Verification
- [ ] `name` is unique (not already in apps/desktop/skills/)
- [ ] `description` explains both WHEN and WHAT
- [ ] At least 3 triggers (mix of zh + en)
- [ ] At least 3 process steps with verbs
- [ ] Red Flags section has at least 2 entries
- [ ] Verification checklist has at least 3 items
- [ ] File saved to `apps/desktop/skills/{name}.md`
