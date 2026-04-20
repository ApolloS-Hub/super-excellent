---
name: incremental-implementation
description: Use when building any non-trivial feature. Enforces small, testable, commit-sized steps with verification between each, preventing "big bang" rewrites that don't work.
phase: build
category: quality
tags: [implementation, iterative, incremental, commit]
triggers: [实现, 开发, 写功能, implement, build, develop, create feature]
workers: [developer, frontend, architect]
---

# Incremental Implementation

## Overview
Every working feature was once a working smaller feature. Build in steps that each leave the system in a working state. Never write 500 lines without running the code.

## When to Use
- Any feature that touches 3+ files
- Any change that takes more than 30 minutes of thinking
- Refactors of critical paths
- New code in unfamiliar areas of the codebase

## Process

### 1. Find the thinnest vertical slice that demonstrates value
Not: build the database layer, then build the API, then build the UI.
But: get one hardcoded value all the way through to the user, then replace the hardcoded parts one at a time.

### 2. Write the test for the slice
See `test-driven-development` skill.

### 3. Implement the slice with hardcoded / stub everything else
- Hardcoded response body
- Stub DB call
- Fake auth
- Commit. Run the feature. See it work.

### 4. Replace one stub at a time
- Replace the fake DB with the real DB. Test. Commit.
- Replace the fake auth with real auth. Test. Commit.
- Replace the hardcoded response with computed. Test. Commit.

### 5. Each commit leaves the system working
- Tests pass
- Feature behaves correctly for demonstrated inputs
- Can be deployed without breaking anyone

## Commit Size Rules
- Each commit should be reviewable in 5 minutes
- Commit message must complete "This commit makes it so that..."
- If you can't describe it in one sentence, split it
- If `git diff` is more than 200 lines of code, probably too big

## Branch Hygiene
- One feature per branch
- Rebase on main before PR
- Squash WIP commits before merge if they don't each leave system working

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It's easier to do it all at once" | Until you hit a blocker 400 lines in and don't know why |
| "I'll test it all at the end" | The end comes 3 days later when you've forgotten context |
| "Small commits pollute the history" | Squash merge fixes that. You keep the safety net |
| "My changes don't affect other things" | Until they do, and you can't bisect |

## Red Flags
- Branch older than 3 days without a commit
- Single commit with 30+ files changed
- "It works, trust me" — you can't demonstrate a working sub-step
- "I have to finish everything before I can test" — split it
- Git log full of "wip", "fix", "more fixes", "oops"

## Verification
- [ ] Each commit leaves the codebase in a working state
- [ ] Each commit message completes "This commit makes it so that..."
- [ ] Feature can be demonstrated in stages, not just end-to-end
- [ ] Main is rebased before PR, no merge-commits from main
