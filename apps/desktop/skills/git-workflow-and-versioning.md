---
name: git-workflow-and-versioning
description: Use when committing code, opening PRs, or managing branches. Enforces clean history, descriptive commit messages, and safe branching.
phase: ship
category: quality
tags: [git, commit, pr, branch, versioning]
triggers: [提交, commit, pr, pull request, git, 分支, merge]
workers: [developer, devops]
---

# Git Workflow and Versioning

## Overview
Git history is documentation. Good commits let a future you (or teammate) bisect bugs, revert safely, and understand why code exists. Treat commit messages like small PRs.

## When to Use
Every time you commit. Every time you open a PR. Every time you merge.

## Commit Message Format

```
<type>: <short summary, imperative, under 72 chars>

<optional body explaining WHY, not WHAT>

<optional footer: closes #123, breaking-change, etc.>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`

Examples:
```
feat: add web_search timeout with fallback

Rust backend curl can hang on slow proxies. Added JS-side
15s Promise.race timeout. On timeout, falls back to direct
browser fetch of HN Algolia API.

Fixes the hang reported in screenshot #3.
```

```
fix: Anthropic stream:false for Tauri compat

Tauri plugin-http response.body doesn't support getReader.
SSE parsing silently returned empty content. Reverted to
response.json() which works reliably.
```

## Commit Size

- Each commit leaves the system in a working state (tests pass)
- One logical change per commit
- Reviewable in 5 minutes — if bigger, split
- Formatting/refactor as separate commits from functional changes

## Branching

- One feature per branch
- Rebase on main before PR (linear history)
- No merge commits from main INTO feature branch during development
- Squash messy WIP commits before review, but keep meaningful ones

## Pull Request Template

```markdown
## Summary
<1-3 sentences: what changed and why>

## Changes
- <bullet per significant change>

## Testing
- <how you verified this works>

## Risk
- <what could break; rollback plan if needed>

## Screenshots (if UI)
<before/after>
```

## What NOT to do

- `git push --force` on shared branches (use `--force-with-lease`)
- Commit `.env` files, API keys, credentials (use `.gitignore`)
- Commit `node_modules`, `dist/`, `target/` (build artifacts)
- "WIP" / "stuff" / "asdf" commit messages in merged history
- Amend a pushed commit on a shared branch
- Merge without reading your own diff one more time

## Rebase vs Merge

- **Rebase** when integrating main into your feature branch (before PR)
- **Merge** (or squash-merge) when landing your PR into main
- Never rebase after PR is under review — reviewers lose their place

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "I'll clean up the history later" | "Later" is never. Clean up now |
| "The commit message is obvious from the diff" | Diffs don't explain WHY |
| "I'll fix the typo in the next commit" | Now there are two commits for one thing. Amend |
| "Force push won't hurt anyone" | Until it does, and their work is gone |

## Red Flags
- `git log --oneline` full of "fix", "wip", "update"
- Single commit with 30+ files
- PR description is "see commits" (empty)
- Branch older than a week without rebase
- Merge commits from `main` in a feature branch's history
- Files in the PR that have nothing to do with the PR's title

## Verification
- [ ] Commits each leave the codebase buildable and tests green
- [ ] Commit messages describe WHY, not just WHAT
- [ ] PR title is short and specific (under 70 chars)
- [ ] PR description covers summary, changes, testing, risk
- [ ] No build artifacts / secrets in the diff
- [ ] Rebased on latest main before requesting review
