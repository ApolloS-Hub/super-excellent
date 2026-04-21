---
name: animation-patterns
description: Use when creating animated content, motion graphics, transitions, or interactive elements. Covers timing, easing, choreography, and common motion pitfalls.
phase: build
category: content
tags: [animation, motion, transition, easing, interactive, video]
triggers: [动画, animation, 动效, motion, transition, 过渡, animate, 动态效果]
workers: [ux_designer, frontend, content_operations]
command: /animation
---

# Animation Patterns

## Overview
Motion is a language. Good animation guides the eye, confirms actions, and creates continuity. Bad animation distracts, delays, and nauseates. This skill covers the principles that separate the two.

## When to Use
- Adding transitions to a prototype or web page
- Creating animated content (explainer, demo, showcase)
- Building micro-interactions (button states, loading, success)
- Reviewing existing animations for quality

## Core Principles

### 1. Purpose First
Every animation must answer: "What does this help the user understand?"
- **Entrance**: where did this come from? (slide-up = from below the fold)
- **Exit**: where is this going? (fade-out = no longer relevant)
- **Feedback**: what just happened? (success pulse = action confirmed)
- **Continuity**: how are these related? (shared-element transition)

If you can't name the purpose, delete the animation.

### 2. Timing Rules

| Duration | Use for |
|----------|---------|
| 100-150ms | Micro-feedback (hover, press, toggle) |
| 200-300ms | Standard transitions (page change, modal) |
| 300-500ms | Emphasis (attention-drawing, celebration) |
| 500-1000ms | Choreographed sequences (onboarding, hero) |
| >1000ms | Background ambient only (subtle breathing) |

**Rule**: if the user has to WAIT for the animation, it's too slow.

### 3. Easing Functions

| Easing | When |
|--------|------|
| `ease-out` (decelerate) | **Default** — entering elements |
| `ease-in` (accelerate) | Exiting elements (leaving the viewport) |
| `ease-in-out` | Elements moving between positions |
| `linear` | Never for UI (feels robotic) |
| `spring` | Playful interactions, toggles, bounces |
| `cubic-bezier(0.4, 0, 0.2, 1)` | Material Design standard |

### 4. CSS Implementation

```css
/* ── Entrance: slide-up + fade ── */
@keyframes slide-up {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
.enter { animation: slide-up 0.3s ease-out forwards; }

/* ── Exit: fade-out ── */
@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
.exit { animation: fade-out 0.2s ease-in forwards; }

/* ── Micro-feedback: button press ── */
.btn:active { transform: scale(0.97); transition: transform 0.1s ease-out; }

/* ── Success pulse ── */
@keyframes pulse-success {
  0% { box-shadow: 0 0 0 0 oklch(65% 0.15 155 / 0.4); }
  70% { box-shadow: 0 0 0 10px oklch(65% 0.15 155 / 0); }
  100% { box-shadow: 0 0 0 0 oklch(65% 0.15 155 / 0); }
}

/* ── Staggered entrance: items appear one-by-one ── */
.stagger > * { opacity: 0; animation: slide-up 0.3s ease-out forwards; }
.stagger > *:nth-child(1) { animation-delay: 0s; }
.stagger > *:nth-child(2) { animation-delay: 0.05s; }
.stagger > *:nth-child(3) { animation-delay: 0.1s; }

/* ── Skeleton loading shimmer ── */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
```

### 5. Choreography Rules
When multiple elements animate:
- **Stagger**: 50-80ms between items (not simultaneous)
- **Direction**: all enter from the same side
- **Primary first**: the most important element starts, others follow
- **Exit together**: exits can be simultaneous (no one watches exits)

## Common Pitfalls

### ❌ Pitfall 1: Animation blocking interaction
User clicks a button → 500ms animation plays → THEN the action happens.
Fix: start the action immediately; animation is visual confirmation, not prerequisite.

### ❌ Pitfall 2: Bouncing everything
Spring/bounce easing on EVERY element = visual chaos.
Fix: reserve bounce for ONE celebratory moment per flow.

### ❌ Pitfall 3: Reduced motion ignored
Some users have `prefers-reduced-motion: reduce`.
Fix: always include:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### ❌ Pitfall 4: Layout shift during animation
Animating `width`/`height` causes reflow.
Fix: only animate `transform` and `opacity` (GPU-composited, no reflow).

### ❌ Pitfall 5: Infinite loops on non-loading elements
A spinner is fine. A card that pulses forever is not.
Fix: infinite animation ONLY for: loading states, ambient backgrounds.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Animation makes it look premium" | Gratuitous animation looks amateur |
| "The bounce is fun" | Fun once; annoying 100 times |
| "Linear is fine" | Linear feels broken; always use easing |
| "Users don't notice animation" | They notice bad animation. Good animation is invisible |

## Red Flags
- Any animation >500ms that the user must wait through
- `linear` easing on UI elements
- Missing `prefers-reduced-motion` handling
- Animating `width`, `height`, `top`, `left` (use `transform`)
- Every single element bounces on page load
- Infinite animation on non-loading elements

## Verification
- [ ] Every animation has a named purpose (entrance/exit/feedback/continuity)
- [ ] Duration appropriate for the category (see timing table)
- [ ] Easing function chosen intentionally (not default)
- [ ] `prefers-reduced-motion` media query present
- [ ] Only `transform` and `opacity` animated (no layout properties)
- [ ] Stagger delay between sequential elements (50-80ms)
