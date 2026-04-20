---
name: code-simplification
description: Use when reviewing existing code that's hard to read, over-abstracted, or full of dead code. Removes complexity rather than adding to it.
phase: review
category: quality
tags: [refactor, simplify, cleanup, dead-code, yagni]
triggers: [简化, simplify, refactor, cleanup, 重构, 优化代码]
workers: [developer, code_reviewer, architect]
---

# Code Simplification

## Overview
The best code is the code you didn't have to write. When refactoring, default to DELETING over ADDING. Fewer lines, fewer abstractions, fewer dependencies — that's the goal, not more "clean architecture".

## When to Use
- Reviewing code that's hard to read
- Pre-work before adding a feature to a complex area
- After getting a feature working (GREEN step of TDD)
- When a module has grown beyond what its name implies

## Process

### 1. Delete dead code
- Search for functions/classes/files that are never called
- Remove unused imports, variables, commented-out code
- If a feature flag is always on/off, inline it
- Commit. Run tests. If tests still pass, it was dead.

### 2. Inline one-use abstractions
If a function/class/type is used only in one place, inline it:
- 1-caller helpers that add no clarity → inline
- Single-implementation interfaces → delete the interface
- Wrappers that only forward → delete

Keep abstractions only when they earn their weight.

### 3. Remove premature generalization
- Parameters that are always passed the same value → remove
- "Might need it later" configuration → remove, add when needed
- Classes with only static methods → convert to functions
- 3-level inheritance for 1 real use case → flatten

### 4. Reduce conditional complexity
- Guard clauses + early return beat deep nesting
- Polymorphism beats `if (type == 'A') ... else if (type == 'B')`
- Lookup tables beat long if/else chains
- State machines beat boolean flag soup

### 5. Reduce parameter count
- Function with 5+ params → group related ones into a struct
- Optional params that always have to be passed → not really optional
- Flags that change behavior → split into two functions

## YAGNI Enforcement
"You Aren't Gonna Need It" — until you actually do:
- No speculative features
- No "in case we ever want to..."
- No generic types for a single concrete use
- No plugin system without plugins
- No config file with one value — make it a constant

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "We might need the abstraction later" | Add it later. Right now it has a cost |
| "It's cleaner this way" | Is it actually shorter? If not, it's not cleaner |
| "This pattern is industry-standard" | Patterns solve problems. What problem does this solve here? |
| "Refactoring is dangerous" | Untested code is dangerous. Add tests, then refactor |

## Red Flags
- Factory / Builder / Manager classes with one product / one type / one manager
- Files named `utils.ts`, `helpers.ts`, `common.ts` — these are junk drawers
- `BaseFoo` / `AbstractBar` with one concrete subclass
- Type parameters that are always the same type
- `TODO: refactor this` comments older than a month
- 1000+ LOC classes / files

## Verification
- [ ] Net line count went DOWN, not up
- [ ] Number of abstractions (classes, interfaces) decreased or stayed flat
- [ ] Test coverage didn't decrease
- [ ] No new TODOs introduced
- [ ] Same public API (breaking change is a separate task)
