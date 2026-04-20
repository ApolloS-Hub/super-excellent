---
name: planning-and-task-breakdown
description: Use when faced with a vague or multi-step task. Turns user intent into a concrete plan with ordered steps, dependencies, and acceptance criteria.
phase: plan
category: quality
tags: [plan, breakdown, task, wbs, estimate]
triggers: [规划, 计划, plan, breakdown, how to, how do, steps, 步骤, 方案]
workers: [project_manager, product, architect, developer]
---

# Planning and Task Breakdown

## Overview
A plan is not a wish list. It's an ordered set of concrete, verifiable steps, each small enough to start on today, with clear acceptance criteria and known dependencies.

## When to Use
- User request is vague ("make it faster", "add social features")
- Task will touch multiple systems or take more than 2 hours
- Request has hidden ambiguity (what exactly should the final result look like?)
- Multiple people / workers need to coordinate

## Process

### 1. Clarify the outcome (DEFINE)
Before planning HOW, agree on WHAT. Answer in writing:
- What does success look like? (concrete, observable, measurable)
- Who is the user of this outcome?
- What is explicitly OUT of scope?
- What is the deadline / constraint?

If you can't answer these, the plan will be wrong. Ask.

### 2. Identify the phases
Most work has natural phases. Name them:
- Discovery / research
- Design / API
- Build (often multiple sub-phases)
- Test / verify
- Deploy / document

### 3. Break each phase into tasks
Each task should:
- Start with a verb (Build, Verify, Migrate, Document)
- Have a clear "done" criterion
- Take 2 hours — 2 days (if bigger, break further)
- Name any other task it depends on

### 4. Identify the critical path
Which tasks are on the critical path (delaying them delays the whole project)?
Which can be parallelized?

### 5. Anticipate risks
For each phase, list 2-3 things that could go wrong and what you'd do if they did.

## Output Template

```markdown
# Plan: {Feature Name}

## Outcome
{One paragraph: what success looks like}

## Out of Scope
- {Explicitly not doing X}
- {Explicitly not doing Y}

## Tasks

### Phase 1: {Name}
- [ ] T1: {Task} — Owner: {role}, Depends on: —, Done when: {criterion}
- [ ] T2: {Task} — Owner: {role}, Depends on: T1, Done when: {criterion}

### Phase 2: {Name}
- [ ] T3: {Task} — Owner: {role}, Depends on: T2, Done when: {criterion}

## Critical Path
T1 → T2 → T3 → ...

## Risks & Mitigations
- R1: {Risk} → {What we'll do}
- R2: {Risk} → {What we'll do}

## Open Questions (needs user decision)
- Q1: {Question}
```

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "I'll figure it out as I go" | And forget half the requirements |
| "The user knows what they want" | They know the outcome, not the steps |
| "Planning is bureaucracy" | 30 minutes of planning saves 30 hours of rework |
| "I'll skip the small tasks" | Small tasks hide big blockers |

## Red Flags
- Plan has a single task: "build the feature"
- No "Done when" criteria on tasks
- No "Out of Scope" section (scope will creep)
- All tasks estimated at "1 week" (hidden uncertainty)
- Zero risks listed (you didn't think hard enough)

## Verification
- [ ] Outcome statement is concrete and observable
- [ ] Out-of-scope list documented
- [ ] Each task has a verifiable "done when" criterion
- [ ] Dependencies between tasks marked
- [ ] Critical path identified
- [ ] At least 3 risks with mitigations listed
- [ ] Open questions surfaced to the user
