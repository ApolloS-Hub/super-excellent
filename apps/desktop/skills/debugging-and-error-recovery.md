---
name: debugging-and-error-recovery
description: Use when tests fail, builds break, behavior doesn't match expectations, or you encounter any unexpected error. Enforces systematic root-cause debugging over guessing.
phase: verify
category: quality
tags: [debug, error, bug, fix, troubleshoot, failure]
triggers: [报错, 修复, bug, debug, error, failure, 排查, troubleshoot, not working]
workers: [developer, tester, devops]
---

# Debugging and Error Recovery

## Overview
Debugging is not guessing. Every fix must address the root cause, not a symptom. If you can't explain WHY the bug happened, you haven't fixed it — you've just made it temporarily invisible.

## When to Use
- A test is failing
- A build is broken
- Production behavior doesn't match expectations
- An unexpected exception or error appears
- A previously-working feature stopped working

## The Stop-the-Line Rule
When you hit an error, STOP. Do not:
- Retry the command hoping it works this time
- Ignore it and keep coding
- Wrap it in a try/catch and swallow it
- Blame the "flaky" environment without evidence

## Process

### Step 1: Reproduce Reliably
Before diagnosing, make the bug happen on command:
- Note the exact steps
- Note the environment (OS, version, config)
- Run it 3 times. If it only happens sometimes, find what's different

### Step 2: Localize the Fault
Narrow down WHERE the bug is:
- Git bisect if a previous version worked
- Binary-search comment out code sections
- Add diagnostic logging around suspect code
- Read the full stack trace, not just the first line

### Step 3: Reduce to Minimal Reproduction
Strip away anything that doesn't affect the bug:
- Remove unrelated files/dependencies
- Simplify inputs to the minimum that still fails
- A 10-line repro beats a 1000-line one every time

### Step 4: Fix the Root Cause
- State the root cause in one sentence before writing code
- The fix should make the mechanism of failure impossible, not just the symptom
- If the "fix" is `if (specific_input) { skip }`, you haven't fixed anything

### Step 5: Guard Against Recurrence
- Add a regression test that fails without the fix
- Add monitoring/logging for the failure mode
- Document the root cause in the commit message

### Step 6: Verify End-to-End
- Run the full test suite
- Test the original user-visible behavior
- Check related features that use the same code path

## Safe Fallback Patterns

```typescript
// BAD: swallow error, keep running
try { doThing(); } catch {}

// BAD: log and continue with garbage state
try { doThing(); } catch (e) { console.log(e); }

// GOOD: explicit fallback with typed result
try {
  return { ok: true, data: doThing() };
} catch (e) {
  return { ok: false, error: String(e) };
}

// GOOD: let it crash if state is corrupt
if (!assertValid(state)) throw new Error("invariant broken");
```

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It works on my machine" | Your machine is not production |
| "It's a flaky test" | Flaky tests have real causes — find the race condition |
| "The error is unrelated" | If it wasn't there before, it's related |
| "I'll add a try/catch" | Silencing errors makes debugging future bugs 10x harder |

## Treating Error Output as Untrusted Data
- Don't trust line numbers after transpilation (use source maps)
- Stack traces can be truncated — grep the full log
- Test output may include cached state from previous runs — clean first

## Red Flags
- "It's flaky" without a specific race condition identified
- Fixes that touch multiple unrelated files
- `catch {}` blocks added to make errors "go away"
- Commented-out tests "temporarily"
- Changing the test to match the broken behavior
- "It worked before" without identifying what changed

## Verification
- [ ] Root cause stated in plain English in one sentence
- [ ] Regression test added that fails before fix, passes after
- [ ] Full test suite passes
- [ ] Similar code paths audited for the same bug pattern
- [ ] Logs/monitoring added so next occurrence is visible
