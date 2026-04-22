---
name: decision-frameworks
description: Use when the user is stuck on a decision, weighing options, or needs to evaluate trade-offs. Applies Type 1/Type 2, 10-10-10, and pre-mortem frameworks.
phase: plan
category: business
tags: [decision, tradeoff, 决策, 权衡, framework]
triggers: [decide, decision, 决定, 决策, 选择, choose between, trade-off, 权衡, should I, 该不该, 要不要]
workers: [product, architect, risk_analyst, project_manager]
command: /decide
---

# Decision Frameworks

## Overview
Most bad decisions come from treating all decisions the same. The key move is classifying the decision first, then applying the right framework. Reversible, low-stakes decisions deserve 2 minutes; irreversible, high-stakes ones deserve 2 days.

## When to Use
- "Should we do X or Y?"
- Stuck weighing options with no clear winner
- Need to justify a choice to stakeholders
- Committing to something hard to undo
- Reviewing a past decision that went sideways

## Process

### 1. Classify the decision — Type 1 or Type 2?
From Jeff Bezos' framework:
- **Type 1 (irreversible)**: hard or impossible to undo. Hire/fire, raise, public launch, platform choice, pricing changes. *Move slowly. Require high certainty.*
- **Type 2 (reversible)**: easy to undo. Feature flag, tactical experiment, copy change, scheduling. *Move fast. Act on 70% info.*

Most decisions are Type 2. Teams that treat Type 2 like Type 1 move too slowly; teams that treat Type 1 like Type 2 accumulate damage.

### 2. For Type 2 — just decide
Use a 2-minute heuristic:
- Which option has the lowest downside if wrong?
- Pick it. Move on. Revisit in a week.

Don't over-engineer reversible decisions.

### 3. For Type 1 — run the full kit

**A. 10/10/10 rule (Suzy Welch):**
How will I feel about this in…
- 10 minutes? (emotional signal)
- 10 months? (execution reality)
- 10 years? (long-term arc)

If short-term pain but long-term fit → probably the right call.

**B. Pre-mortem (Gary Klein):**
Imagine it's 1 year from now and this decision failed badly. Write:
- What were the top 3 reasons it failed?
- What early signals would have warned us?
- What's our kill-criteria threshold?

If you can clearly imagine failure modes, you can design around them. If you *can't* imagine failure, you haven't thought hard enough.

**C. Second-order effects:**
Ask "and then what?" three times.
- We launch the feature. → And then what?
- Users adopt it. → And then what?
- Support tickets 2x. → Is our team ready? Is that cost acceptable?

Many decisions look fine first-order and awful third-order.

**D. Regret minimization:**
Which choice would you regret more in 5 years: doing it, or not doing it?

### 4. Name the decider
If there's no single accountable owner, you don't have a decision — you have a committee. Name them explicitly before closing.

### 5. Write it down
Document the decision with: chosen option, key alternatives, rationale, kill-criteria (what would make us reverse it). Makes future you smarter and accountability clearer.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Let's wait for more data" | You'll never have all the data. Decide with what you have |
| "Let's A/B test everything" | A/B tests are for Type 2; don't A/B test your strategy |
| "Let's get everyone's input" | Consensus ≠ correctness; name the decider |
| "I don't want to commit until we're sure" | Not deciding is a decision (usually the worst one) |
| "We can always change our mind later" | Sometimes true (Type 2), sometimes not (Type 1). Know which |

## Red Flags
- Can't articulate the options clearly
- No clear decider named
- "We should really look into this more" (repeated)
- Choosing based on who advocates loudest, not logic
- No kill-criteria or reversal plan
- Treating an irreversible decision casually because "we'll iterate"

## Verification
- [ ] Decision classified: Type 1 (slow) or Type 2 (fast)
- [ ] Single named decider
- [ ] For Type 1: pre-mortem done, second-order effects traced
- [ ] Kill-criteria defined (what would make us reverse?)
- [ ] Decision written down with rationale
- [ ] Timeline for review scheduled
