---
name: prioritization
description: Use when the user has too much to do and needs to sequence / cut / rank. Applies Eisenhower, RICE, ICE, and opportunity cost frameworks.
phase: plan
category: efficiency
tags: [prioritization, priority, roadmap, 优先级, 排期, 取舍]
triggers: [prioritize, priority, 优先级, 排序, 取舍, cut scope, what should I do first, 先做什么, backlog, roadmap]
workers: [project_manager, product, ops_director]
command: /prioritize
---

# Prioritization

## Overview
You will always have more to do than time allows. Prioritization is not a productivity trick — it's the job. The hardest part isn't choosing what to do; it's choosing what *not* to do, and being at peace with it.

## When to Use
- Planning a week / sprint / quarter with too many items
- Ranking a backlog of feature requests or ideas
- Deciding what to cut when time shrinks
- Explaining to a stakeholder why their thing is #7 not #1
- Reviewing progress and re-prioritizing mid-flight

## Process

### 1. Start with the Eisenhower matrix
Every item goes into one quadrant:

|                | Urgent              | Not Urgent          |
|----------------|---------------------|---------------------|
| **Important**  | Do now              | Schedule            |
| **Not Important** | Delegate or batch | Delete              |

- **Important + Urgent**: crisis mode; do today. (Goal: minimize time spent here)
- **Important + Not Urgent**: the highest-leverage quadrant; most growth lives here
- **Not Important + Urgent**: other people's priorities; delegate or batch
- **Not Important + Not Urgent**: delete without guilt

Most people over-spend in Urgent+Not Important because it *feels* productive.

### 2. For ranked lists — RICE or ICE

**RICE** (for features / initiatives):
```
Score = (Reach × Impact × Confidence) / Effort
```
- **Reach**: how many people affected in period (N users / quarter)
- **Impact**: per-person impact (3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal)
- **Confidence**: how sure are we? (100% / 80% / 50%)
- **Effort**: person-months

**ICE** (lighter, for personal tasks):
```
Score = Impact × Confidence × Ease
```
Each on 1-10. Sum, rank. Good for weekly planning.

### 3. Ask the killer question
For the top 3 candidates: "If we could only do one, which would it be?" Your gut answers faster than any matrix. If your gut disagrees with your matrix, investigate why.

### 4. Name what you're cutting
The best prioritization writeup has two sections:
- **Doing**: top N items, briefly
- **Not doing**: items we considered and deprioritized, with one-line *why*

The "not doing" list is where the work is. It prevents people from feeling ignored and prevents zombie re-litigation later.

### 5. Opportunity cost check
For each "yes", name the "no". If you can't name what you're giving up, you haven't actually prioritized — you've wishfully added.

### 6. Accept the regret tax
You will sometimes deprioritize something that turned out to matter. That's normal. The alternative (trying to do everything) fails worse. Re-plan monthly with fresh info.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Everything is P0" | Then nothing is. Pick top 3 |
| "I'll just do the small stuff first to clear the decks" | Small stuff expands to fill time; big stuff gets pushed |
| "Let's not cut; we'll find a way" | You'll find a way by quietly dropping things anyway. Do it consciously |
| "I can't deprioritize this — the VP cares" | Then surface the trade-off to the VP. Make them choose |
| "RICE is too formal" | Use ICE or Eisenhower. Just use *something* |

## Red Flags
- Priority list longer than 10 items
- No "not doing" section
- Same items carrying over week after week (that's a cut, not a carry)
- Scores show a clear #1, but gut picks something else, and no reconciliation happens
- Ranking done alone when it affects a team
- Re-ranking mid-sprint for every new shiny request

## Verification
- [ ] Items classified by Eisenhower or scored with RICE/ICE
- [ ] Top 3 explicitly named
- [ ] "Not doing" list exists with one-line rationale per item
- [ ] Opportunity cost named for the top 3 yeses
- [ ] If team-affected: communicated to team with trade-offs visible
- [ ] Review date scheduled (weekly or bi-weekly)
