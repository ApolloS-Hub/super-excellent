# Spec: Browser Fetch, MCP Integration, Kimi Compat Tests

> Status: approved

## Goal
Fill three remaining capability gaps: browser content fetching, real MCP
integration tests, and Kimi provider compatibility tests.

## Changes
1. `packages/agent-core/src/tools/builtin/browser.ts` — add BrowserFetch tool
2. `packages/agent-core/tests/fixtures/echo-mcp-server.mjs` — minimal MCP echo server
3. `packages/agent-core/tests/mcp.test.ts` — MCP integration tests
4. `apps/desktop/src/lib/runtime/kimi-compat.test.ts` — Kimi compat tests

## Verification
- `npx vitest run` all green
- At least 3 commits
