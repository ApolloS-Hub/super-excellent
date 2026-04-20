---
name: test-driven-development
description: Use when writing new code, fixing bugs, or refactoring existing code. Ensures tests are written first, then implementation follows the RED → GREEN → REFACTOR cycle.
phase: build
category: quality
tags: [test, tdd, bug, refactor, unit-test]
triggers: [写测试, 修bug, tdd, 测试驱动, test-driven, fix bug, refactor]
workers: [developer, tester, frontend]
---

# Test-Driven Development

## Overview
TDD makes tests the spec, not an afterthought. Write a failing test first, implement just enough to pass it, then refactor. For bug fixes, the test must demonstrate the bug BEFORE you attempt a fix — this prevents "I thought I fixed it" regressions.

## When to Use
- Adding new functionality (new function, endpoint, component)
- Fixing a reported bug (write reproduction test first)
- Refactoring risky code (lock behavior with tests before touching)
- Changing a public API (test documents the contract)

## Process

### 1. RED — Write a failing test
- Describe the behavior in plain English first: "given X, when Y, then Z"
- Write the smallest test that would catch the problem
- Run it. It MUST fail with a clear error message that points to the missing behavior
- If it passes, the test is broken, not the feature

### 2. GREEN — Make it pass with minimal code
- Write the simplest code that makes the test pass
- Resist adding extra features "while you're there"
- Commit (or stage) when green

### 3. REFACTOR — Clean up without changing behavior
- Remove duplication
- Rename unclear variables
- Run all tests after each refactor

## Test Architecture

Follow the test pyramid:
- **Unit** ~80% — fast, isolated, millisecond-level
- **Integration** ~15% — component interactions, test databases
- **E2E** ~5% — critical user flows only

**State over interactions**: Assert on what the code DID (return values, state changes) not on HOW (which methods were called). Interaction tests break on refactor.

**DAMP over DRY in tests**: Test code should prioritize readability and self-containment. Each test should tell a complete story.

**Real > Fakes > Stubs > Mocks**: Prefer real implementations. Only mock when the dependency is slow, non-deterministic, or expensive.

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll write tests afterward" | You won't. And if you do, they'll be biased toward passing |
| "This is too simple to test" | Simple code breaks in simple ways — test it |
| "The test is redundant with the spec" | Specs don't run. Tests do |
| "I already manually tested it" | Manual testing doesn't catch regressions in 6 months |

## Red Flags
- Tests that call the implementation instead of the public interface
- Mocking everything — tests pass but production breaks
- Comments like `// TODO: write test` on shipped code
- Any test that passes before the feature exists
- Skipping/commenting out tests to make CI green

## Verification
- [ ] Failing test exists BEFORE any production code change
- [ ] Every new public function/endpoint has at least one test
- [ ] Bug fixes include a regression test that fails before the fix
- [ ] Tests pass without any hand-tweaking or fake data
- [ ] Deleted code comes with deleted tests (no orphan tests)
