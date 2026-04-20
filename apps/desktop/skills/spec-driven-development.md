---
name: spec-driven-development
description: Use when starting a non-trivial feature. Forces writing a concrete spec BEFORE code, turning fuzzy ideas into contracts with clear inputs, outputs, and edge cases.
phase: define
category: quality
tags: [spec, design, prd, requirements]
triggers: [需求, prd, 设计, spec, specification, requirements, 规格]
workers: [product, architect, developer]
---

# Spec-Driven Development

## Overview
Code without a spec is guessing. A spec is a written contract: given these inputs, under these conditions, the system produces these outputs, within these constraints. Write it before you code — you'll find half the bugs while writing.

## When to Use
- Any new public API or endpoint
- Any feature that will have users outside your immediate team
- Any interface between two systems
- Any change where "it depends" came up more than once

## The Spec Format

```markdown
# Spec: {Name}

## Problem
{One paragraph: what user pain does this solve?}

## Non-Goals
{What we are explicitly NOT solving here}

## Proposal
{One paragraph: what we'll build}

## Interface

### Inputs
- {field}: type, constraints, example

### Outputs
- {field}: type, constraints, example

### Errors
- {condition} → {error code + message}

## Behavior
### Happy Path
1. ...
### Edge Cases
- What if input is empty?
- What if input is malformed?
- What if concurrent request?
- What if retry after partial failure?

## Constraints
- Performance: {p95 latency budget}
- Scale: {expected RPS / data volume}
- Compatibility: {back-compat promises}

## Open Questions
- {Decisions still needed}
```

## Process

### 1. Write the Problem in one paragraph
No code yet. If you can't describe the problem, you don't understand it.

### 2. Write the Interface
- What does the user / caller see?
- What are the exact inputs and outputs?
- What error modes are possible?

### 3. Walk through scenarios in prose
- Happy path: step-by-step, what happens?
- Edge cases: for each weird input, what should happen?
- Race conditions: two callers at once?

### 4. Identify open questions
Things you realized you don't know. These are requirements in disguise — surface them.

### 5. Review with user BEFORE coding
If the spec is wrong, 5 minutes of talking fixes it.
If the code is wrong, 5 days of rework fixes it.

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "The spec is obvious" | Obvious to whom? Write it. |
| "I'll document it after I build it" | You'll document what you built, not what's needed |
| "Specs get out of date" | Old specs are still better than no specs |
| "The code IS the spec" | Only for the one reader who already understood |

## Red Flags
- Spec is one sentence ("add a search feature")
- No "non-goals" section (scope will creep)
- Edge cases section is empty
- No open questions ("I know everything" is always wrong)
- Spec was written AFTER the code

## Verification
- [ ] Problem stated in one paragraph
- [ ] Non-goals documented
- [ ] Inputs + outputs with types and examples
- [ ] At least 3 edge cases covered
- [ ] Open questions surfaced and resolved with user
- [ ] Spec reviewed before implementation started
