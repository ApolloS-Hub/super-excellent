---
name: code-review-and-quality
description: Use when reviewing code changes, pull requests, or assessing code quality. Applies a 5-dimension framework (correctness, readability, architecture, security, performance).
phase: review
category: quality
tags: [review, pr, quality, audit]
triggers: [审查, review, 代码审查, code review, 检查代码, pr review]
workers: [code_reviewer, developer, security]
---

# Code Review and Quality

## Overview
A code review is not a rubber stamp. It is structured feedback across 5 dimensions, with each finding categorized by severity. Good reviews find real problems AND acknowledge strengths.

## When to Use
- Reviewing a pull request
- Auditing code before a release
- Assessing a codebase for acquisition or handoff
- Onboarding a new team member to read production code

## The 5 Dimensions

### 1. Correctness — Does it do what the spec says?
- Spec compliance: does each requirement have a corresponding implementation?
- Edge cases: empty input, null, very large, very small, concurrent access
- Error paths: what happens when the network/DB/disk fails?
- Test quality: do tests assert on state, or just that "no error thrown"?
- State consistency: after an operation fails, is the system in a valid state?

### 2. Readability — Can a new reader understand it in 30 seconds?
- Naming: do variables/functions say what they are without needing a comment?
- Control flow: are early returns used to reduce nesting?
- Organization: is related code near each other?
- Comments: do they explain WHY, not WHAT (code should already say what)?

### 3. Architecture — Does it fit the system?
- Pattern adherence: does this change match existing patterns in the codebase?
- Module boundaries: does it respect layer separation (UI / domain / infra)?
- Dependency direction: do high-level modules depend on low-level, not the other way?
- Abstraction level: is it the right level of abstraction (not too generic, not too specific)?

### 4. Security — Is it safe against realistic threats?
- Input validation: all external inputs (HTTP, files, user input) validated
- Secret management: no API keys / passwords in code or logs
- AuthN/AuthZ: who can access this? enforced at the right layer?
- Query safety: parameterized queries only, no string concatenation into SQL
- XSS / CSRF: output properly escaped, anti-forgery tokens present

### 5. Performance — Will it scale?
- N+1 queries: does a list render trigger a DB query per item?
- Unbounded loops / allocations: any input-size-dependent work without a cap?
- Async opportunities: sequential awaits that could be parallel
- Pagination: any endpoint returning "all X" is a future bug

## Finding Categories

**Critical** — MUST fix before merge
- Bugs, security vulnerabilities, data loss, spec violations
- Break downstream consumers

**Important** — SHOULD fix (use judgment)
- Readability issues in complex code
- Missing test coverage for non-trivial logic
- Performance issues not immediately user-visible

**Suggestions** — OPTIONAL improvements
- Style preferences
- Future refactoring opportunities
- Alternative approaches

## Process
1. Read the PR description and linked issue — understand the intent
2. Examine the tests first — they document the expected behavior
3. Read the diff in the order it would execute
4. For each finding, categorize severity
5. Give specific, actionable feedback ("change X to Y" not "this is weird")
6. Acknowledge strengths — what did they do well?
7. Flag uncertainty explicitly — "I'm not sure, but..." is better than guessing

## Output Template

```markdown
## Review of #{PR_NUMBER}

### Critical
- [file.ts:42] Description. Fix: specific change.

### Important
- [file.ts:88] Description. Suggestion: ...

### Suggestions
- Consider extracting X into its own function.

### Strengths
- Good use of Y pattern.
- Excellent test coverage for edge case Z.

### Questions
- Why did you choose X over Y? (not blocking, just curious)
```

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "LGTM" without reading | Your name is on the merge — own it |
| "I don't understand but the tests pass" | Ask. Tests have bugs too |
| "Style doesn't matter" | Style IS readability — readability IS correctness-at-scale |
| "Fix it in a follow-up" | Follow-ups don't happen. Fix it now or accept it forever |

## Red Flags
- "LGTM" reviews in under 30 seconds on 500+ line PRs
- Comments like "nit:" on a security issue
- Reviewing your own code (except to respond to feedback)
- No tests in a PR that touches business logic
- "TODO" / "FIXME" added in this PR

## Verification
- [ ] Every file in the diff was actually opened and read
- [ ] Findings cite specific file:line locations
- [ ] Severity categorized (Critical / Important / Suggestion)
- [ ] At least one strength acknowledged
- [ ] Uncertain points flagged as questions, not claims
