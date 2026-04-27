# CLAUDE.md — Super Excellent AI Secretary

Behavioral contract for any AI agent working in this repository.
Every principle here was earned from real implementation experience
and tested across 12 open-source projects studied in production.

## Identity

This is a **Tauri 2.x + React 19 desktop AI Secretary app**. The user
talks to a secretary, the secretary dispatches work to 20 specialized
AI workers (12 engineering + 8 business roles), and delivers results.

Stack: TypeScript frontend, Mantine 7 UI, IndexedDB persistence,
Rust backend (Tauri), 10 LLM providers, Lark integration via direct
HTTP (not CLI), 35 bundled skills, 41 test files / 566+ tests.

## 1. Core Operating Principles (Karpathy)

These 4 rules apply to EVERY piece of work, no exceptions:

**THINK BEFORE ACTING** — If anything is unclear, surface the
ambiguity and ask. Never assume silently. State your reasoning
before producing output.

**SIMPLICITY FIRST** — Deliver exactly what was requested, nothing
more. Do not add speculative features, unnecessary abstractions, or
"nice to have" extras unless explicitly asked. Three similar lines
are better than a premature abstraction.

**SURGICAL CHANGES** — Touch only what the task requires. Do not
make orthogonal edits, reformat unrelated code, rename things
"while you're at it," or add cleanup that wasn't asked for.

**GOAL-DRIVEN** — Convert tasks into success criteria. Verify your
output meets those criteria before delivering. If it doesn't, revise
— don't explain why it's close enough.

## 2. Code Quality Standards

### Tests are non-negotiable
- Every new module gets a test file in `src/__tests__/e2e/`
- Every PR must maintain or increase test count (currently 566+)
- Run `npx tsc -b && pnpm test && pnpm build` before every commit
- If a test fails, fix it before moving on — never skip

### No silent error swallowing
```typescript
// WRONG — hides real bugs
catch { }
catch { /* ignore */ }

// RIGHT — bugs surface
catch (e) { console.warn("context: what failed", e); }
```

### No emoji in UI code
The app uses a stroke-based `Icon` component (`src/components/Icon.tsx`).
Do NOT use emoji (🔧 ✅ ❌ 📊 💰 etc.) in any `.tsx` or `.css` file.
Use `<Icon name="check" />` etc. Emoji in skill markdown files is OK.

### No "飞书" / "Feishu" / "lark-cli" references
The Lark integration was rewritten to direct HTTP. All Chinese brand
names were replaced with "Lark". Do not re-introduce old names.

### Design tokens, not hardcoded colors
Use CSS custom properties from `styles.css`:
- `var(--accent)`, `var(--fg)`, `var(--surface)`, `var(--border)`
- OKLCH color space (perceptually uniform)
- Dark mode overrides in `[data-mantine-color-scheme="dark"]`

### TypeScript strictness
- Minimize `as any`. Currently 4 instances — don't add more.
- No `@ts-ignore` or `@ts-expect-error`.
- Mark unused function params with `_` prefix.

## 3. Architecture Patterns

### Framework-First Scaffolding (product-playbook)
Common tasks have structured multi-step scenarios, not ad-hoc chat.
The `scenario-engine.ts` has 6 built-in scenarios (weekly planning,
meeting prep, email triage, daily standup, doc review, spec-driven).
When adding new workflows, register them as scenarios with explicit
steps, worker assignments, and IO contracts.

### Change Propagation (product-playbook)
`artifact-graph.ts` maintains a DAG of artifacts. When an upstream
artifact changes, all downstream dependents are marked stale via BFS.
Use `addDependency(from, to)` when artifacts are related.

### Progressive Disclosure (claude-mem)
Memory retrieval uses 3 layers — compact index → timeline → details.
Never dump full history into prompts. Use `observationLog.search()`
for L1, `timelineAround()` for L2, `getObservations()` for L3.

### Experience Recall (AgentEvolver)
Before each worker dispatch, the coordinator searches observation-log
for past successful approaches to similar tasks and injects them as
`[Past experience]`. This makes the secretary improve with use.

### Spec-Driven Pipeline (OpenSpec)
`/propose` → `/apply` → `/archive` turns vague ideas into traceable
artifacts. Each step becomes a node in the artifact graph. New
commands should follow this pattern: generate → execute → archive.

### Strategy Presets (Evolver)
The secretary has 4 "moods": balanced / innovate / harden / repair.
These affect quality-gate threshold, retry count, and creativity.
Use `getStrategy()` to read, `/strategy` to switch.

### Bounded Context (garden-skills)
Long conversations auto-trigger a summary hint at 15 turns or ~50K
tokens. Scenarios cap at 10 steps. This prevents token waste.

## 4. Error Handling Philosophy (EmptyOS)

**Human-as-fallback**: When something fails, don't just return an
error message. Return the error PLUS actionable suggestions for
what the user can do manually. The `buildHumanFallback()` function
in coordinator.ts classifies errors (timeout / auth / network /
quota / Lark / generic) and produces tailored guidance.

The secretary should NEVER just say "error" and stop. It should
always offer a path forward.

## 5. Memory & Context Rules

### Memory Nudges (Hermes)
The app proactively detects "worth remembering" signals in
conversations: decisions, preferences, commitments, project names,
deadlines. These auto-persist to memory-store + context-bootstrap.
Do NOT store passwords, API keys, or tokens.

### Context Bootstrap
`context-bootstrap.ts` maintains a structured snapshot (projects,
tasks, decisions, preferences, focus, blockers, deadlines). This
is injected into every worker's prompt. Keep it lean — sections
with no content are omitted.

### Observation Log
`observation-log.ts` auto-captures events from the event bus.
Supports `<private>...</private>` tags for content the user doesn't
want stored. Jaccard dedup prevents storing the same thing twice.

### Stagnation Detection (Evolver)
If a worker fails quality-gate 3+ times in 10 minutes, the system
detects stagnation and auto-switches to a fallback worker via role
affinity mapping. Don't add retry loops — use this mechanism.

## 6. Lark Integration Rules

### Endpoints
ALL Lark API calls go to `https://open.larksuite.com`. OAuth
authorization goes to `https://accounts.larksuite.com`. Never use
`open.feishu.cn` or any other domain.

### Token model
- `tenant_access_token` (app credentials) → bot-scope: IM only
- `user_access_token` (browser OAuth) → personal: calendar, docs,
  tasks, approval, sheets, email

### Tool gating
User-scope tools (6 of 7) are only registered when a valid user
OAuth token exists. `lark_im` is always available. Check token
status with `hasUserAccess()` / `hasTenantAccess()`.

### Doc operations
Lark docs use a block model. Use `driveReplaceDocContent()` for full
rewrites (it lists → deletes → recreates blocks). Use `append` for
additions. Always show current content before overwriting.

### OAuth scopes
Currently: `contact:user.base:readonly`, `im:message`,
`docx:document`, `drive:drive`. Add new scopes to `buildOAuthUrl()`
in lark-client.ts AND document them here.

## 7. UI Standards

### Design direction
Linear / Claude.ai / Raycast: tight chrome, system fonts, restrained
color, deliberate elevation. No cartoon-y shadows, no serif fonts,
no rainbow gradients.

### Dark mode
All custom colors must work in both light and dark. Test both.
Use `var(--fg)` not `color: black`. Use `var(--surface)` not
`background: white`.

### Component library
Mantine 7 with overridden theme in `main.tsx`. Use Mantine components
(Button, Badge, Paper, etc.) with our theme — don't reinvent.

### Icon component
`<Icon name="check" size={14} stroke={1.75} />` — 36 built-in
glyphs. Add new ones to `Icon.tsx` PATHS record if needed.

## 8. Skills

Skills live in `apps/desktop/skills/*.md`, bundled at build time
via Vite glob import. Each has YAML frontmatter:

```yaml
---
name: skill-name
description: When to use this skill (one sentence)
phase: build|plan|define|verify|review|ship|business|reflect
category: quality|efficiency|content|business|data
tags: [keyword1, keyword2]
triggers: [trigger1, 中文触发词]
workers: [developer, tester]
command: /slash-command
---
```

Body sections: Overview, When to Use, Process, Rationalizations,
Red Flags, Verification. Follow existing skills as templates.

Currently 35 skills. Do not delete existing ones without asking.

## 9. Git Workflow

- Develop on `claude/complete-agent-system-iOqvq` branch
- Merge to `main` with `--no-ff` for clean history
- Commit messages: `type(scope): description` (feat/fix/chore/test/refactor)
- Always verify before commit: `npx tsc -b && pnpm test && pnpm build`
- Never force-push to main
- Never skip pre-commit hooks

## 10. Slash Commands Reference

| Command | Source | Purpose |
|---------|--------|---------|
| `/recall [kw]` | claude-mem | Search observation log (L1 compact index) |
| `/recall-timeline <id>` | claude-mem | Chronological context (L2) |
| `/recall-details <id>` | claude-mem | Full detail fetch (L3) |
| `/propose <idea>` | OpenSpec | Generate proposal → spec → design → tasks → review |
| `/apply` | OpenSpec | Execute task list from last /propose |
| `/archive` | OpenSpec | Archive proposal to historical decisions |
| `/strategy [preset]` | Evolver | View or change strategy (balanced/innovate/harden/repair) |
| `/schedule <desc>` | Hermes | Natural-language cron task scheduling |
| `/schedule list` | Hermes | List all scheduled tasks |
| `/schedule cancel <id>` | Hermes | Cancel a task |
| `/meeting` | lenny-skills | Running effective meetings skill |
| `/hard-talk` | lenny-skills | Difficult conversations skill |
| `/write` | lenny-skills | Written communication skill |
| `/decide` | lenny-skills | Decision frameworks skill |
| `/prioritize` | lenny-skills | Prioritization skill |
| `/focus` | lenny-skills | Energy and focus management skill |
| `/feedback` | lenny-skills | Giving feedback skill |
| `/weekly-review` | lenny-skills | Weekly review ritual |
| `/inbox` | lenny-skills | Inbox zero methodology |
| `/say-no` | lenny-skills | Saying no skill |

## 11. Provenance Map

Every major system traces back to an open-source project we studied:

| System | Inspired By | Files |
|--------|-------------|-------|
| Scenario Engine | product-playbook | scenario-engine.ts |
| Artifact Graph | product-playbook | artifact-graph.ts |
| Context Bootstrap | product-playbook | context-bootstrap.ts |
| Quality Gates | product-playbook | quality-gate.ts |
| Environment Scanner | product-playbook | env-scanner.ts |
| Observation Log | claude-mem | observation-log.ts |
| Spec Pipeline | OpenSpec | commands.ts (/propose /apply /archive) |
| 11 PM Skills | lenny-skills | skills/*.md |
| Subagent Visibility | openclaw-managed-agents | coordinator.ts |
| Cost Quota | openclaw-managed-agents | coordinator.ts |
| Durable Scenario Queue | openclaw-managed-agents | scenario-engine.ts |
| Strategy Presets | EvoMap/evolver | strategy-presets.ts |
| Stagnation Detection | EvoMap/evolver | strategy-presets.ts |
| Experience Recall | AgentEvolver | coordinator.ts |
| Memory Nudges | hermes-agent | memory-nudge.ts |
| Schedule Commands | hermes-agent | commands.ts (/schedule) |
| Graceful Degradation | emptyos | coordinator.ts |
| Bounded Context | garden-skills | bounded-context.ts |
| Karpathy Principles | andrej-karpathy-skills | coordinator.ts |
| Lark HTTP + OAuth | original (replaced lark-cli) | lark-client.ts, lark-token-store.ts |
| Icon System | original (replaced emoji) | Icon.tsx |
| Dark Mode Fix | original | styles.css |
