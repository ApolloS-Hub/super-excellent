---
name: context-engineering
description: Use when the agent's context is polluted, token budget is tight, or responses drift off-topic. Keeps the context window focused and relevant.
phase: build
category: quality
tags: [context, token, prompt, memory, compact]
triggers: [上下文, context, token, 压缩, compact, prompt]
workers: [developer, architect]
---

# Context Engineering

## Overview
The LLM only knows what's in its context window. Garbage in, garbage out. This skill is about curating what goes into context: relevant files, concise summaries, focused task descriptions — not the whole codebase dumped in.

## When to Use
- Task involves a large codebase
- Model responses are vague, drifting, or contradicting themselves
- Token usage is near the context limit
- Long-running session where earlier context is no longer relevant

## Principles

### 1. Include only what's needed
- The FILE being edited, yes
- The IMPORTED files that define types used in it, yes
- The file's tests, often yes
- The entire package, usually no
- Irrelevant files, never

### 2. Fresh context for isolated subtasks
- When dispatching to a worker/subagent, don't inherit the parent's context
- Give the subagent ONLY what it needs for this task
- Receive a SUMMARY back, not the full trace

### 3. Summarize, don't truncate
- If a tool result is 10K lines, don't pass 10K. Don't truncate to first-1K either.
- Pass a summary: "File has 10K lines. Structure: 3 classes, 40 methods. Relevant methods: X, Y, Z (lines 120-180)."

### 4. Anchor with examples
- If you want output in a specific format, show one example
- If you want a specific style, quote a reference
- Humans learn by example; so do LLMs

### 5. Kill stale context
- If you've pivoted, drop the previous attempt
- If a tool returned an error you've worked around, drop it
- Running total: every turn, ask "is any of this still useful?"

## Technique: Hierarchical Context

For a big task, layer context by relevance:

```
# Task
{The current ask, in 2-3 sentences}

# Current File
{The file being edited, full content}

# Closely-Related
{Directly imported types, 1-2 related utilities}

# Project Summary
{README paragraph + file tree summary}

# Style Guide
{Link or brief rules}
```

The LLM reads top-to-bottom. Put the most important things first.

## Technique: Turn-by-Turn Focus

Each turn should have ONE objective:
- "Let's find the bug" (investigation) — tools + hypotheses
- "Let's fix the bug" (implementation) — test + fix + verify
- "Let's review the fix" (review) — diff + reasoning

Don't mix. The model does all three worse than any one well.

## Technique: Auto-Compact Triggers

When context approaches 80% of the window:
- Summarize the conversation so far (keep: decisions made, constraints discovered)
- Drop: raw tool output, exploratory dead ends
- Keep: current goal, current file, active hypothesis

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "More context = better answers" | Up to a point. Then attention dilutes |
| "Just include everything, let the model figure it out" | Models are bad at ignoring irrelevant info |
| "The system prompt is permanent, I can't change it" | You can, and should, per task |
| "Token costs are negligible" | Latency scales with input length too |

## Red Flags
- Context contains files the task doesn't touch
- Long tool outputs left verbatim in context
- Previous session's context still present after a pivot
- Model quoting / referring to things from 20 turns ago
- Responses that include "as I mentioned earlier" (it's losing track)

## Verification
- [ ] Every file / snippet in context has a reason to be there
- [ ] Tool results over 2KB summarized before adding to history
- [ ] Subagent invocations use isolated context, not inherited
- [ ] Current turn has a single, stated objective
- [ ] When context > 80% window, compaction ran
