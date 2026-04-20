---
name: performance-optimization
description: Use when a feature is slow, memory usage is high, or response times are unacceptable. Enforces measure-first, don't-guess optimization.
phase: review
category: quality
tags: [performance, speed, memory, optimization, profiling]
triggers: [慢, 性能, performance, slow, optimize, 优化, 卡, lag]
workers: [developer, devops, data_analyst]
---

# Performance Optimization

## Overview
"Premature optimization is the root of all evil" — but so is shipping slow code. The rule: MEASURE before you optimize. The bottleneck is almost never where you think it is.

## When to Use
- Users report slowness
- Metrics show p95/p99 latency regression
- Memory / CPU usage spike in production
- Before accepting "just add more servers" as an answer

## Process

### 1. Define the metric
What "slow" means quantitatively:
- Latency: p50, p95, p99 for the target operation
- Throughput: requests/sec under load
- Memory: peak / steady-state bytes
- Cost: $/month or $/request

### 2. Measure current state
- Production metrics (APM, OpenTelemetry)
- Profiler on representative workload (not a toy input)
- Record a trace — where does time actually go?

### 3. Find the bottleneck
The 90/10 rule holds: 90% of time is in 10% of code.
- Look at the top 3 hottest functions
- Look at the biggest DB query by total time (not count)
- Look at memory allocations per request

### 4. Fix the biggest bottleneck first
Fix ONE thing. Measure again. Did it actually help? Go back to step 2.

### 5. Stop when you're under budget
If you've hit the SLO, stop. Further optimization without evidence is waste.

## Common Bottlenecks (in order of frequency)

### Database
- **N+1 queries** — loading a list and querying per-item
- **Missing indexes** — full table scans on filter/sort columns
- **Over-fetching** — `SELECT *` when you need 2 columns
- **Unbounded result sets** — no pagination
- **No connection pooling** — new connection per request

### Network
- **Synchronous serial calls** — awaiting in a loop that could parallelize
- **No caching** — re-fetching data that doesn't change
- **Oversized payloads** — sending data the client doesn't need
- **No compression** — missing gzip/br

### CPU
- **Accidental quadratic** — nested loops on user-scaled inputs
- **Re-computing in a hot loop** — cacheable values computed per iteration
- **Regex on unbounded input** — catastrophic backtracking

### Memory
- **Loading full file into RAM** — use streams
- **Event listener leaks** — attached, never detached
- **Closure captures large objects** — scope them tighter
- **String concatenation in loops** — use array + join

## Optimization Techniques (ranked by cost/reward)

1. **Delete** — remove work you don't need (best ROI)
2. **Cache** — don't do it again
3. **Batch** — one request of 100 beats 100 requests of 1
4. **Parallel** — concurrent when not dependent
5. **Algorithm change** — O(n²) → O(n log n)
6. **Data structure change** — list → hash for lookup
7. **Lazy evaluation** — compute only when needed
8. **Hand-optimized code** — last resort, hard to maintain

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It feels slow, must be X" | Profile it. You're probably wrong |
| "The cache would fix this" | A cache adds complexity; fix the root cause first |
| "Add more servers" | Horizontal scale also scales your bugs |
| "Users will wait" | Amazon: every 100ms = 1% conversion loss |

## Red Flags
- "Optimization" PR with no before/after benchmarks
- Added a cache without invalidation strategy
- `setTimeout` / `setInterval` to "work around" a perf issue
- Adding indexes without query analysis
- Micro-benchmarks that don't match real workload

## Verification
- [ ] Metric defined quantitatively (p95 latency budget)
- [ ] Before/after numbers from representative load
- [ ] Measurement, not speculation, identified the bottleneck
- [ ] Change made ONE thing at a time so you know what helped
- [ ] Regression test / continuous benchmark added
