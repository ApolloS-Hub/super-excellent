---
name: design-deliverables
description: Use when the user asks for a visual deliverable — presentation slides, clickable prototype, infographic, poster, landing page mockup, or chart. Produces production-ready single-file HTML with clean typography, brand-aware colors, and no AI-slop aesthetics.
phase: build
category: content
tags: [design, prototype, slide, ppt, infographic, poster, mockup, landing, chart]
triggers: [做个PPT, 原型, 幻灯片, 海报, landing page, 信息图, 展示, 设计, prototype, presentation, slide, deck, poster, mockup, infographic, 做个图]
workers: [ux_designer, writer, content_operations, frontend]
command: /design
---

# Design Deliverables

## Overview
Non-designers often need visual output — a slide deck for a meeting, a prototype for a feature idea, an infographic for a report. This skill produces clean, single-file HTML deliverables with professional aesthetics, avoiding the "obviously AI-generated" look.

## When to Use
- "帮我做个 PPT" / "make me a presentation"
- "做一个产品原型" / "create a prototype"
- "生成一张信息图" / "generate an infographic"
- "设计一个 landing page" / "design a landing page"
- "画一个数据图表" / "create a chart"

## Anti-AI-Slop Rules

NEVER produce output that looks obviously AI-generated:

### Colors
- ❌ Purple-to-blue gradients (the universal "AI made this" signal)
- ❌ Neon accents on dark backgrounds
- ✅ Use OKLCH color space for perceptual uniformity
- ✅ Extract brand colors from user's existing materials if available
- ✅ Limit palette to 2-3 colors + neutrals

### Typography
- ❌ Default system font everywhere (Inter/Roboto as the only font)
- ❌ All text the same weight
- ✅ Pair a display font (headings) with a body font (paragraphs)
- ✅ Use `text-wrap: pretty` to prevent orphans/widows
- ✅ Hierarchy through size AND weight AND color (not just size)
- ✅ Chinese: use PingFang SC / Microsoft YaHei for body, serif for display
- ✅ English: system serif for display, system sans for body

### Layout
- ❌ Everything centered with equal margins (the "PowerPoint template" look)
- ❌ Cramming too many elements into one view
- ✅ CSS Grid for precision layout
- ✅ Generous whitespace (empty space IS design)
- ✅ Asymmetric layouts for visual interest
- ✅ Max 3-4 content blocks per view/slide

### Graphics
- ❌ Emoji as icons in professional deliverables
- ❌ SVG faces or cartoon illustrations
- ❌ Clip art
- ✅ Simple geometric shapes and lines
- ✅ Data visualization (real charts, not decorative)
- ✅ Photography (recommend Unsplash URLs) for hero sections

## Process

### 1. Clarify the deliverable type

| Type | Output | Key constraint |
|------|--------|---------------|
| Slide deck | Single HTML with sections | 1 idea per slide, max 30 words |
| Prototype | Clickable HTML with states | iPhone/desktop frame, real interactions |
| Infographic | Vertical HTML, print-ready | Data hierarchy, scannable in 30s |
| Landing page | Single-page HTML | Clear CTA, above-fold hook |
| Chart/diagram | SVG or Canvas | Accurate data, labeled axes |

### 2. Establish visual direction
Before building, propose 2-3 directions:
- **Clean corporate**: Navy + white, sans-serif, grid layout
- **Bold startup**: Bright accent + dark, large type, asymmetric
- **Minimal editorial**: Lots of white, serif headings, thin lines

Ask user which direction (or blend).

### 3. Build the HTML

Structure for all deliverables:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{Deliverable Title}</title>
  <style>
    /* ═══ Reset + Variables ═══ */
    :root {
      --brand-primary: oklch(55% 0.15 250);   /* NOT hex purple */
      --brand-accent: oklch(70% 0.12 150);
      --text-primary: oklch(25% 0.01 250);
      --text-secondary: oklch(55% 0.01 250);
      --bg: oklch(99% 0.005 250);
      --font-display: 'Georgia', 'Songti SC', serif;
      --font-body: -apple-system, 'PingFang SC', sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; }
    body { font-family: var(--font-body); color: var(--text-primary); background: var(--bg); }
    h1, h2, h3 { font-family: var(--font-display); text-wrap: pretty; }
    p { text-wrap: pretty; line-height: 1.65; }

    /* ═══ Layout ═══ */
    .container { max-width: 960px; margin: 0 auto; padding: 2rem; }
    .grid { display: grid; gap: 1.5rem; }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: 1fr 1fr 1fr; }

    /* ═══ Component styles go here ═══ */
  </style>
</head>
<body>
  <!-- Content -->
</body>
</html>
```

### 4. For SLIDES specifically

Each slide is a `<section>`:
```html
<section class="slide">
  <h2>Slide Title</h2>
  <p>One core message. Max 30 words.</p>
  <!-- Optional: one chart OR one image OR one grid of stats -->
</section>
```

Rules:
- Title slide: big title + subtitle + date only
- Content slides: 1 idea per slide
- Data slides: chart first, explanation second
- Closing slide: single CTA or takeaway
- Navigation: arrow keys or click to advance (add JS)

### 5. For PROTOTYPES specifically

Wrap in a device frame:
```html
<div class="phone-frame">
  <div class="screen" id="screen-home">
    <!-- Screen content -->
    <button onclick="showScreen('screen-detail')">View Details</button>
  </div>
  <div class="screen hidden" id="screen-detail">
    <!-- Detail content -->
    <button onclick="showScreen('screen-home')">← Back</button>
  </div>
</div>
```

Include a `showScreen()` JS function for navigation between states.

### 6. Verify before delivering
- Open in browser to confirm rendering
- Check: text readable? colors accessible? layout balanced?
- Verify interactive elements work (slides navigate, prototype clicks)

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Purple gradient looks modern" | It looks like every other AI output in 2025 |
| "Emoji icons save time" | They signal amateur; use CSS shapes instead |
| "One font is enough" | Contrast between display and body creates hierarchy |
| "The user didn't specify a style" | Propose 2-3 options. Don't default to generic |
| "It's just a draft" | The user will share this. Make it presentable |

## Red Flags
- Output uses purple-blue gradient as primary
- All text is the same size
- Emoji used as section icons in a professional deck
- No whitespace — every pixel filled
- Slide has more than 40 words
- Prototype has no clickable interactions
- Chart has no axis labels

## Verification
- [ ] Colors are NOT default AI purple/blue gradient
- [ ] At least 2 distinct font weights used
- [ ] `text-wrap: pretty` applied to paragraphs
- [ ] Layout uses CSS Grid (not just flexbox centering)
- [ ] Max 30 words per slide
- [ ] Interactive elements actually work in browser
- [ ] HTML is a single self-contained file (no external deps)
- [ ] Output includes the actual content, not placeholders
