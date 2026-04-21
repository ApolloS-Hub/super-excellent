---
name: design-critique
description: Use when reviewing visual design output, UI mockups, slide decks, or any visual deliverable. Applies a 5-dimension evaluation with radar scoring, actionable fixes, and severity categorization.
phase: review
category: content
tags: [design, review, critique, ui, ux, visual, feedback]
triggers: [评审设计, 看看这个设计, review design, critique, 设计评分, design feedback, 评价, 这个好看吗]
workers: [ux_designer, code_reviewer, content_operations]
command: /critique
---

# Design Critique

## Overview
A design critique is not "I like it" / "I don't like it." It's a structured 5-dimension evaluation with specific scores, evidence, and actionable fixes. Each finding gets a severity and a concrete recommendation.

## When to Use
- User shares a screenshot or HTML prototype for feedback
- Reviewing a slide deck before presentation
- Evaluating a landing page or infographic
- Checking design consistency across deliverables

## The 5 Dimensions

### 1. Visual Hierarchy (0-10)
Can you tell what's most important in 3 seconds?
- **Title/headline** clearly dominant (size, weight, or color)
- **Call-to-action** visually distinct from body content
- **Reading flow** follows natural eye path (Z or F pattern)
- **Spacing** creates logical grouping (related things close, unrelated far)

### 2. Typography (0-10)
Is text readable, balanced, and intentional?
- **Font choices**: max 2 families; display vs body distinction
- **Size scale**: consistent ratio between heading levels (1.2-1.5×)
- **Line height**: 1.5-1.7 for body, 1.1-1.3 for headings
- **Line length**: 45-75 characters per line
- **Contrast**: text/background ratio ≥ 4.5:1 (WCAG AA)
- **Orphans/widows**: no single words on a line by themselves

### 3. Color & Contrast (0-10)
Is the palette intentional and accessible?
- **Palette size**: 2-3 brand colors + neutrals + 1 accent
- **Consistency**: same blue doesn't shift between sections
- **Semantic meaning**: red=error, green=success, not reversed
- **Accessibility**: text passes WCAG AA on its background
- **Dark mode**: if applicable, colors don't blow out or flatten

### 4. Layout & Spacing (0-10)
Is the grid clean and breathing?
- **Alignment**: elements snap to a visible or implied grid
- **Whitespace**: generous margins; content doesn't touch edges
- **Consistency**: same padding used across similar components
- **Responsive**: doesn't break at ±20% width change
- **Balance**: visual weight distributed (not all crammed top-left)

### 5. Content Quality (0-10)
Is the copy effective and error-free?
- **Clarity**: each section's purpose is obvious from the heading
- **Brevity**: no paragraph says in 50 words what 15 could
- **Spelling/grammar**: zero errors in final deliverable
- **Data accuracy**: charts match the numbers stated in text
- **CTA clarity**: the user knows what to do next

## Scoring

| Score | Meaning |
|-------|---------|
| 9-10 | Professional / ship-ready |
| 7-8 | Good, minor polish needed |
| 5-6 | Acceptable, several issues |
| 3-4 | Below standard, needs rework |
| 1-2 | Fundamental problems |

**Overall** = weighted average (hierarchy 25%, typography 20%, color 20%, layout 20%, content 15%).

## Output Template

```markdown
## Design Critique

### Radar Score
| Dimension | Score | Notes |
|-----------|-------|-------|
| Visual Hierarchy | 7/10 | Good title dominance, CTA could be stronger |
| Typography | 6/10 | Body line-height too tight; orphan on slide 3 |
| Color & Contrast | 8/10 | Clean palette; button text fails AA on light bg |
| Layout & Spacing | 7/10 | Grid is clean; section 2 cramped |
| Content Quality | 5/10 | Three typos; chart label mismatch |
| **Overall** | **6.7/10** | |

### Critical (must fix)
1. **[Slide 3]** Button text (#fff on #90cdf4) fails WCAG AA contrast. Fix: darken button to #3182ce.

### Important (should fix)
2. **[Section 2]** Paragraph orphan "的。" alone on last line. Fix: add `text-wrap: pretty` or rewrite last sentence.

### Suggestions (nice-to-have)
3. Consider a serif heading font for more visual hierarchy contrast.

### Strengths
- Excellent whitespace management in section 1
- Color palette is cohesive and brand-consistent
```

## Process
1. **First pass**: 3-second scan — what jumps out? What's confusing?
2. **Score each dimension** with specific evidence per score
3. **Categorize findings**: Critical / Important / Suggestion
4. **Cite locations**: page/section/slide number + what to fix
5. **Acknowledge strengths** — at least 2

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Design is subjective" | Hierarchy, contrast, and accessibility are measurable |
| "It looks fine on my screen" | Check at different sizes and color profiles |
| "The content will be finalized later" | Placeholder text hides layout problems |
| "No one reads the small text" | If no one reads it, delete it |

## Red Flags
- "LGTM" critique with zero specifics
- Opinions without evidence ("I don't like the color")
- Ignoring accessibility (contrast, font size)
- Missing section-level citations
- No strengths mentioned (demoralizes the designer)

## Verification
- [ ] All 5 dimensions scored with specific evidence
- [ ] Each finding cites exact location
- [ ] Severity categorized (Critical / Important / Suggestion)
- [ ] At least 2 strengths acknowledged
- [ ] Accessibility checked (contrast ratios, font sizes)
