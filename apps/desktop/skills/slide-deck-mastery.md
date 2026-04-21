---
name: slide-deck-mastery
description: Use when creating presentations, pitch decks, or any slide-based deliverable. Enforces the 30-word rule, narrative arc, and proper slide architecture rather than text dumps.
phase: build
category: content
tags: [slide, deck, presentation, ppt, pitch, keynote]
triggers: [PPT, 幻灯片, presentation, slide, deck, pitch, keynote, 演讲, 汇报, 做个报告]
workers: [writer, ux_designer, content_operations, product]
command: /slides
---

# Slide Deck Mastery

## Overview
A presentation is not a document projected on a wall. Slides are visual aids for a SPEAKER — they should amplify the message, not replace it. Every slide with more than 30 words is a document pretending to be a slide.

## When to Use
- Creating a meeting presentation
- Building a pitch deck
- Making a project status report
- Producing a training/onboarding deck

## The 30-Word Rule
**No slide may contain more than 30 words of body text.**
- Title: ≤8 words
- Body: ≤22 words
- If you need more words, you need another slide

Exception: data tables can exceed this if every cell is essential.

## Slide Architecture

### The 7-Slide Narrative Arc
Most presentations follow this structure:

| # | Slide Type | Purpose | Word Budget |
|---|-----------|---------|-------------|
| 1 | **Title** | Topic + presenter + date | 10 |
| 2 | **Hook** | Why should the audience care? | 20 |
| 3-N | **Body** | Key points (1 per slide) | 30 each |
| N+1 | **Data** | Evidence supporting the key point | 15 + chart |
| N+2 | **Summary** | What we covered (3 bullets max) | 25 |
| N+3 | **CTA** | What the audience should do next | 15 |
| Last | **Thank You** | Contact info or Q&A prompt | 10 |

### Slide Types (pick per slide)

**Statement slide**: One big sentence. Period.
```
┌─────────────────────────────┐
│                             │
│   Revenue grew 3× in Q3.   │
│                             │
│          — Finance Team     │
└─────────────────────────────┘
```

**Data slide**: Chart dominates, 1-line insight above.
```
┌─────────────────────────────┐
│  Mobile overtook desktop    │
│  ┌─────────────────────┐    │
│  │   📊 Line chart     │    │
│  │   (full width)      │    │
│  └─────────────────────┘    │
│  Source: Analytics Q3 2025  │
└─────────────────────────────┘
```

**Comparison slide**: 2-3 columns, parallel structure.
```
┌─────────────────────────────┐
│  Before          After      │
│  ─────────  vs  ─────────   │
│  3 servers      12 pods     │
│  Manual deploy  CI/CD       │
│  4h downtime    99.9% SLA   │
└─────────────────────────────┘
```

**Image slide**: Full-bleed photo + text overlay.
```
┌─────────────────────────────┐
│  ┌───────────────────────┐  │
│  │                       │  │
│  │    [Full photo]       │  │
│  │                       │  │
│  │   "Quote or headline" │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

## HTML Slide Engine

Single-file HTML with keyboard navigation:

```html
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { font-family: var(--font-body); overflow: hidden; }
  .slide {
    width: 100vw; height: 100vh;
    display: none; place-items: center;
    padding: 5vw;
  }
  .slide.active { display: grid; }
  h1 { font-family: var(--font-display); font-size: 4vw; text-wrap: balance; }
  p { font-size: 2vw; color: #555; max-width: 60ch; text-wrap: pretty; }
  .slide-counter {
    position: fixed; bottom: 2vh; right: 3vw;
    font-size: 1.2vw; color: #999;
  }
</style>
</head>
<body>

<section class="slide active" id="s1">
  <div>
    <h1>Presentation Title</h1>
    <p>Subtitle — Date</p>
  </div>
</section>

<section class="slide" id="s2">
  <div>
    <h1>The Key Insight</h1>
    <p>One sentence that makes the audience lean forward.</p>
  </div>
</section>

<!-- More slides... -->

<div class="slide-counter"><span id="current">1</span> / <span id="total"></span></div>

<script>
const slides = document.querySelectorAll('.slide');
let idx = 0;
document.getElementById('total').textContent = slides.length;
function go(n) {
  slides[idx].classList.remove('active');
  idx = Math.max(0, Math.min(n, slides.length - 1));
  slides[idx].classList.add('active');
  document.getElementById('current').textContent = idx + 1;
}
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ') go(idx + 1);
  if (e.key === 'ArrowLeft') go(idx - 1);
});
document.addEventListener('click', e => {
  if (e.clientX > window.innerWidth / 2) go(idx + 1);
  else go(idx - 1);
});
</script>
</body>
</html>
```

## Color Rules for Slides
- **Light background**: white or near-white. Dark text.
- **Dark background**: only for dramatic/hero slides. White text.
- **Accent**: ONE brand color for highlights. Not every slide.
- **Charts**: max 5 data series colors. Colorblind-safe palette.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "I need all this text for context" | That's a handout, not a slide. Make a separate doc |
| "The audience needs to read along" | The audience needs to LISTEN. Slides support, not replace |
| "Bullet points are standard" | Bullet points are a crutch. Use complete short sentences |
| "More slides = longer presentation" | 30 focused slides beat 10 bloated ones |

## Red Flags
- Any slide >30 words
- Wall of bullet points (5+ on one slide)
- Inconsistent fonts between slides
- Chart without axis labels or legend
- Title slide with no date
- No summary slide before CTA
- ALL CAPS for more than 3 words

## Verification
- [ ] Every slide ≤30 words (title + body combined)
- [ ] Narrative follows Hook → Body → Evidence → Summary → CTA
- [ ] 1 idea per slide (if you need "and" in the title, split it)
- [ ] Charts have labels, legends, and a 1-line insight
- [ ] Font size readable at 3m distance (≥24pt equivalent)
- [ ] Keyboard navigation works (← → or Space)
- [ ] Color contrast passes on all text
