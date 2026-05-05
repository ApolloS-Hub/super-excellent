# DESIGN.md — Super Excellent Visual System

9-section design specification following the Open Design `DESIGN.md`
schema. This is the single source of truth for all visual decisions.
Direction: **Linear / Claude.ai / Raycast** — tight chrome, system
fonts, restrained color, deliberate elevation.

---

## 1. Color

OKLCH color space (perceptually uniform). One accent hue; everything
else is neutral gray with chroma near zero.

### Light mode

| Token | Value | Use |
|-------|-------|-----|
| `--accent` | `oklch(56% 0.19 262)` | Primary actions, links, active states |
| `--accent-hover` | `oklch(50% 0.2 262)` | Hover on accent elements |
| `--accent-soft` | `oklch(96% 0.02 262)` | Wash / highlight background |
| `--accent-ring` | `oklch(56% 0.19 262 / 0.25)` | Focus ring |
| `--fg` | `oklch(18% 0.01 265)` | Primary text |
| `--fg-muted` | `oklch(48% 0.01 265)` | Secondary text (WCAG AA) |
| `--fg-subtle` | `oklch(62% 0.01 265)` | Tertiary / placeholder |
| `--bg` | `oklch(100% 0 0)` | Page background |
| `--surface` | `oklch(98.5% 0.002 265)` | Inset panels, cards |
| `--surface-raised` | `oklch(100% 0 0)` | Elevated cards, popovers |
| `--border` | `oklch(92% 0.004 265)` | Default borders |
| `--border-strong` | `oklch(86% 0.006 265)` | Emphasized borders |
| `--success` | `oklch(56% 0.13 155)` | Green / positive |
| `--warning` | `oklch(72% 0.16 80)` | Amber / caution |
| `--danger` | `oklch(58% 0.2 25)` | Red / error |

### Dark mode

Surface lightness ladder: bg 13% → surface 18% → surface-raised 22%.
Border: 28% → 34%. Fg: 95% → 76% → 62%. Accent shifts brighter
(70% lightness) to maintain contrast on dark backgrounds.

### Rules
- Accent is for **calls-to-action only**. Do not spray it on
  decorative elements, badges, or backgrounds.
- Never use raw hex or rgb(). Always use `var(--token)`.
- Status colors (success/warning/danger) are semantic — do not
  use them for decoration.
- `color-mix(in oklch, var(--accent) N%, transparent)` for
  translucent accent washes.

---

## 2. Typography

System font stack. No web fonts to load.

| Token | Stack | Use |
|-------|-------|-----|
| `--font-body` | SF Pro Text, Inter, Segoe UI, PingFang SC, Microsoft YaHei, Roboto | Body text |
| `--font-display` | SF Pro Display, Inter, Segoe UI, PingFang SC, Microsoft YaHei, Roboto | Headings |
| `--font-mono` | SF Mono, JetBrains Mono, Menlo, Fira Code, Consolas | Code, timestamps |

### Type scale (from main.tsx)

| Level | Size | Line height | Weight |
|-------|------|-------------|--------|
| h1 | 1.75rem | 1.25 | 650 |
| h2 | 1.375rem | 1.3 | 640 |
| h3 | 1.125rem | 1.35 | 630 |
| h4 | 1rem | 1.4 | 620 |
| body | 14.5px | 1.5 (default) | 400 |
| small / caption | 12px | 1.4 | 400 |
| badge / label | 11px | 1.2 | 500-600 |

### Rules
- **No serif fonts** in app chrome. Serif is for long-form content only.
- Body text is 14.5px — do not go smaller except for labels/badges.
- Headings use `--font-display`, body uses `--font-body`.
- Monospace for: code blocks, timestamps, IDs, technical values.
- Chinese text must render cleanly — PingFang SC / Microsoft YaHei in stack.

---

## 3. Spacing

Calibrated scale from main.tsx Mantine theme:

| Token | Value | Use |
|-------|-------|-----|
| xs | 6px | Tight gaps (icon+label, badge clusters) |
| sm | 10px | Between related elements |
| md | 14px | Default padding, section gaps |
| lg | 20px | Card padding, section separation |
| xl | 28px | Page-level breathing room |

### Rules
- Use Mantine `gap`, `p`, `m` props with token names, not pixel values.
- Vertical rhythm: content sections separated by `lg` or `xl`.
- Horizontal rhythm: card padding is `md` to `lg`.
- Never use 0 padding on content-bearing elements.

---

## 4. Layout

| Element | Spec |
|---------|------|
| App max-width | Fluid (fills window) |
| Sidebar | 256px fixed, collapsible |
| Header | 46px height |
| Content max-width | 820px (centered) for MonitorPage/SettingsPage |
| Chat messages | Full width within content area, max 720px per bubble |
| Chat input | Full width, 46px min-height, expands with content |
| Split screen | 50/50 with 2px divider using `--border` |

### Rules
- Content areas always have `px="md"` or `px="lg"` horizontal padding.
- No full-bleed content touching the window edge.
- Cards use `radius="md"` (8px). Buttons use `radius="md"`.

---

## 5. Components

### Message bubble
- User: solid `--accent-soft` background, no border. Text `--fg`.
- Assistant: transparent / `--surface`, subtle `--border` bottom.
- System / thinking: `--surface` background, `--fg-muted` text, italic.
- Timestamp: `--fg-subtle`, monospace, right-aligned.

### Input area
- Container: `--surface-raised` background, `1px solid var(--border)`.
- Focus state: `box-shadow: var(--shadow-ring)`.
- Send button: `--accent` filled, icon-only, 32px square.
- Placeholder text: `--fg-subtle`.

### Cards (Paper)
- Background: `--surface-raised` (light) / Mantine dark default (dark).
- Border: `1px solid var(--border)`.
- Radius: `md` (8px).
- Elevation: `--shadow-xs` for flat cards, `--shadow-sm` for raised.

### Badges
- Default: `variant="light"`, `color` from Mantine semantic colors.
- Status indicators use `variant="dot"` for minimal chrome.
- Never use emoji as `leftSection`. Use `<Icon>` or nothing.

### Navigation items
- Inactive: `--fg-muted`, no background.
- Hover: `--accent-soft` background.
- Active: `--accent` text, `--accent-soft` background, left 3px accent rail.
- Transition: `var(--dur-fast) var(--ease)`.

---

## 6. Motion

| Token | Value | Use |
|-------|-------|-----|
| `--ease` | `cubic-bezier(0.32, 0.72, 0, 1)` | All transitions |
| `--dur-fast` | 140ms | Hover, focus, toggle |
| `--dur` | 200ms | Panel open/close, page transition |

### Animations
- `pulse-soft` — working indicator (worker cards).
- `typing-dot` — assistant thinking dots.
- `fade-in` / `slide-up` — content appearance.

### Rules
- No parallax. No animated backgrounds. No confetti.
- Transitions are functional (indicate state change), not decorative.
- Loading states use subtle pulse or dots, never spinners with percentages.

---

## 7. Voice & Tone

- **UI text**: Direct, concise. "Send" not "Submit your message".
- **Error messages**: What went wrong + what to do. Never just "Error".
- **Empty states**: One sentence + one action. "No conversations yet. Start one."
- **Labels**: Sentence case, not Title Case. "Model config" not "Model Config".
- **Buttons**: Verb-first. "Save settings", "Connect account", "Start bridge".
- **No marketing language** in UI copy. No "powerful", "seamless", "intuitive".
- **Bilingual**: All UI text via i18n. zh-CN as primary, en-US as fallback.

---

## 8. Brand

- **Product name**: Super Excellent / 超优秀
- **Logo mark**: Diamond shape via `Icon name="logo"` (24px grid, stroke-based).
- **Brand color**: Indigo (`--accent`). Not blue. Not purple. Indigo.
- **App icon style**: Stroke-based, 1.75px stroke, round caps and joins.
- **No mascot**. No illustration style. Photo-realistic imagery if needed.

---

## 9. Anti-Patterns

Things that are **explicitly forbidden**:

| Anti-pattern | Why |
|-------------|-----|
| Purple-pink gradients | Overused in AI products; signals lazy design |
| Emoji as functional icons | Inconsistent rendering across OS; use Icon component |
| Inter font as sole "modern" choice | We use system fonts; Inter is a web fallback only |
| Cartoon-y drop shadows | Breaks the "tight chrome" direction |
| Animated backgrounds or particles | Distraction, not function |
| Gratuitous dark-mode-only design | Both modes must work equally well |
| Rainbow / multi-color badge sets | One accent hue + neutral grays only |
| Serif fonts in app chrome | Reserved for long-form reading content only |
| Loading spinners with percentages | Use indeterminate subtle animation |
| "Powered by AI" badges | The entire app is AI; no need to label it |
| Full-bleed hero sections | This is a productivity tool, not a landing page |
| Hardcoded hex/rgb colors | Always use CSS custom properties |
| Marketing adjectives in UI copy | No "powerful", "seamless", "revolutionary" |
