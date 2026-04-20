---
name: documentation-and-adrs
description: Use when adding new features, making architectural decisions, or onboarding new code. Produces README updates, inline docs, and Architecture Decision Records.
phase: ship
category: quality
tags: [docs, readme, adr, documentation]
triggers: [文档, doc, readme, adr, 说明, documentation]
workers: [writer, developer, architect]
---

# Documentation and ADRs

## Overview
Good docs are not prose — they're navigational aids for people in a hurry. Aim for scannable lists, concrete examples, and explicit constraints, not narrative.

## When to Use
- After adding a feature a user will touch (update user docs)
- After making an architectural decision (write ADR)
- Before a release (changelog)
- When onboarding a new contributor (README, CONTRIBUTING)

## Three Types of Documentation

### 1. How-to (User-facing)
"How do I do X with this tool?"
- Opens with the goal in one line
- Each step is a concrete command or click
- Includes expected output so reader can verify
- Troubleshooting section for common failures

### 2. Reference (API / Config)
"What does X mean?"
- Alphabetical or grouped by concern
- One entry per thing, scannable
- Every field has: type, default, required/optional, example
- No hidden behavior — document all side effects

### 3. Rationale (ADRs)
"Why did we build it this way?"
- Records decisions so future team can know the trade-offs
- Includes alternatives considered
- Dated, numbered, immutable (supersede, don't edit)

## ADR Template

```markdown
# ADR-NNNN: {Short decision name}

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by ADR-NNNN

## Context
{1-2 paragraphs: what situation forced a decision?}

## Decision
{One sentence: what we decided.}

## Alternatives Considered
- Option A: {description}. Rejected because ...
- Option B: {description}. Rejected because ...

## Consequences
- Positive: ...
- Negative: ...
- Unknown / to-monitor: ...
```

## README Structure

```markdown
# {Project}

{One sentence pitch}

## Quick Start
{3-5 commands that get something running}

## Features
- {bullet}
- {bullet}

## Documentation
- [User Guide](docs/user-guide.md)
- [API Reference](docs/api.md)
- [Architecture](docs/architecture.md)

## Development
{How to contribute, run tests, build locally}

## License
{License name}
```

## Inline Code Comments

Only write a comment when:
- The code's behavior is NOT obvious from reading it
- There's a subtle invariant / constraint a reader would miss
- There's a workaround for a specific bug (link the issue)
- A reference is needed (RFC, paper, vendor doc)

Do NOT write comments that:
- Repeat what the code says (`// increment i` above `i++`)
- Describe TODOs without a ticket (`// TODO fix later` — when? by whom?)
- Explain yourself (the code already shows what you did)

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "The code is self-documenting" | For you, today. Not for the new hire in 6 months |
| "Docs always get out of date" | Partially-correct docs beat no docs |
| "I'll document it after launch" | Launch brings fires. Document now |
| "Users will figure it out" | They'll file support tickets instead |

## Red Flags
- README shows outdated commands
- `CHANGELOG.md` that hasn't been updated in months
- ADRs edited after they were accepted (use "supersede" instead)
- "Getting Started" that requires reading 5 other docs first
- API docs without a single example
- New env variables not documented

## Verification
- [ ] README quick-start tested on a fresh clone
- [ ] Every new public API / CLI flag documented
- [ ] ADR written for any decision that would confuse a new contributor
- [ ] CHANGELOG updated with user-facing changes
- [ ] Screenshots / examples included where they help
