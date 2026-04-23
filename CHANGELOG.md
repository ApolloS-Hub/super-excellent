# CHANGELOG

超优秀 (Super Excellent) 变更日志。

All notable changes to Super Excellent.

---

## v0.3.0 (2026-04-23)

Lark OAuth rewrite · Scenario engine · Observation log · Spec-driven pipeline ·
11 new cross-functional skills · UI polish (dark-mode contrast + Icon system) ·
490 tests passing.

Inspired by product-playbook, claude-mem, OpenSpec, lenny-skills.

### Lark integration — architectural rewrite

- **`lark-client.ts` + `lark-token-store.ts` (NEW)** — direct HTTP client to
  `open.larksuite.com` via `@tauri-apps/plugin-http`. Killed the `lark-cli`
  external binary dependency entirely.
- **Two-tier auth**:
  - `tenant_access_token` (app credentials → auto-refreshed every ~2h)
    for bot-scope IM messaging
  - `user_access_token` (browser OAuth paste-back → refresh token 30 days)
    for personal calendar / docs / tasks / approval / sheets / mail
- **Connection test on save** (`LarkConfigPanel`): validates App ID + Secret
  via a real token exchange before persisting.
- **Tool gating**: user-scope tools (6 of 7) only register when user OAuth
  is valid; IM is always available. UI shows `tenant` vs `user` scope badges.
- **Brand cleanup**: all `飞书` / `Feishu` / `lark-cli` / `LarkCLI` /
  `FeishuAdapter` references purged from code, locales, and docs.
- **OAuth fixes**: removed invalid `mail:mail:readonly` scope (Lark error 20043);
  redirect URI routed to Lark's own display page (not `tauri://localhost`).

### Scenario engine (NEW — `scenario-engine.ts`)

Framework-first scaffolding: vague request → structured multi-step state
machine. 6 built-in scenarios, each with explicit worker + IO contracts.

- `weekly_planning` — gather → prioritize → conflicts → schedule → sync
- `meeting_prep` — context → research → agenda → prep-doc → action items
- `email_triage` — fetch → classify → summarize → drafts
- `daily_standup` — yesterday → today → blockers → report
- `doc_review` — read → clarity → accuracy → structure → final
- `spec_driven` (OpenSpec-inspired) — proposal → spec → design → tasks → review

Coordinator's `analyzeIntent()` gives scenario match priority over keyword
matching — "规划本周" no longer guesses, it runs the state machine.

### Artifact graph (NEW — `artifact-graph.ts`)

DAG of artifacts with BFS stale propagation + topological regeneration.
Upstream artifact changes cascade stale marks to all transitive downstream
artifacts. Supports `derives-from` / `blocks` / `informs` / `contradicts`
relations. `linkScenarioArtifacts()` wires scenario steps into the graph.

### Context bootstrap (NEW — `context-bootstrap.ts`)

Cross-session structured markdown context: active projects, pending tasks,
recent decisions, user preferences, weekly focus, blockers, deadlines.
Auto-collects from `memory-store` and runtime tasks; auto-extracts from
conversations via regex patterns. Injected into every worker's prompt via
`buildContextPromptWithObservations()`.

### Quality gates (NEW — `quality-gate.ts`)

Per-worker self-critique hard gates. Universal checks (not empty, no
hallucinated URLs, answers the question, no refusal leaks) + role-specific
checks (developer → code blocks; writer → structure; researcher → sources;
code_reviewer → specificity; PM → action items). Score &lt; 0.6 triggers
feedback-guided retry.

### Environment scanner (NEW — `env-scanner.ts`)

Proactive scan of git repos, tech stacks (package.json, Cargo.toml, go.mod,
pyproject.toml), branch state, recent commits. For planning tasks, prompts
are enriched with real-world constraints instead of hallucinated assumptions.

### Observation log (NEW — `observation-log.ts`, claude-mem inspired)

Auto-capture via event bus (tool_use / tool_result / user_message /
assistant_result / worker_dispatch). Jaccard similarity dedup (threshold
0.85 against last 50 same-type). LRU-ish pruning (max 2000, weighted by
access × recency). Privacy tag: `&lt;private&gt;...&lt;/private&gt;` content redacted.
Three-layer progressive disclosure retrieval:

- `/recall [keyword]` — compact index (ID + summary, ~50–100 tokens)
- `/recall-timeline &lt;id&gt; [min]` — chronological ±N minute window
- `/recall-details &lt;id&gt; [&lt;id&gt;...]` — full detail fetch, bumps access count

### Spec-driven pipeline (NEW — OpenSpec-inspired)

Three commands turn vague ideas into traceable artifacts:

- `/propose &lt;idea&gt;` — runs the `spec_driven` scenario (5 steps: proposal →
  spec → design → tasks → review). Each step becomes an artifact in the
  dependency graph.
- `/apply` — parses the tasks checklist from the last `/propose`, logs each
  task to the observation log.
- `/archive` — writes a one-line summary to `context-bootstrap`'s
  `recentDecisions`; clears the active instance.

### 11 new skills (lenny-skills inspired)

Cross-functional skills in Lark / dev / personal productivity gaps:
`running-effective-meetings`, `difficult-conversations`, `written-communication`,
`decision-frameworks`, `prioritization`, `energy-and-focus`,
`stakeholder-alignment`, `giving-feedback`, `weekly-review`, `inbox-zero`,
`saying-no`. Total skills: 24 → 35.

### UI polish

- **Dark-mode contrast bump** — `--surface` 16→18%, `--border` 24→28%,
  `--fg-muted` 72→76%, override of `--mantine-color-dimmed` for legibility.
- **Icon system everywhere** — ToolProgress, CostBadge, SettingsPage,
  MonitorPage stripped of hardcoded emoji (🔧 💰 📊 ⏹ ▶ etc.) in favor of
  stroke-based `Icon` component with design-token colors.
- **MonitorPage rebuild** — workflow stepper, team grid, event log all use
  Icons; broken `worker-pulse` keyframe reference fixed to `pulse-soft`.
- **SettingsPage Lark panel** — redesigned with OAuth connect / disconnect
  flow, connection test, user name display, tool scope badges.

### Test & quality

- **37 test files / 490 tests passing** (was 25 / 321; +12 files / +169 tests)
- New e2e tests: scenario-engine, artifact-graph, context-bootstrap,
  quality-gate, env-scanner, observation-log, lark-client,
  lark-token-store, lark-integration, openspec-commands, event-bus,
  tool-registry
- Silent error-swallowing `catch {}` patterns replaced with
  `catch (e) { console.warn(...) }` so bugs surface.
- Dead exports marked `@deprecated` (`orchestrateMultiStep`, `getWorkerTools`).

### Infrastructure

- `@tauri-apps/plugin-shell` used for OAuth browser launch
- Event-bus internal log formatter no longer bakes emoji into detail strings
- `context-bootstrap.buildContextPrompt()` now correctly returns `""` when
  only the header exists (previous 50-char threshold was buggy)

---

## v0.2.0 (2026-04-21)

Codex 风格的安全控制层 + oh-my-codex 7 个工作流模式 + 增强诊断。

Codex-style safety & control layer + 7 oh-my-codex workflow patterns + enhanced diagnostics.

### Codex-inspired features

- **双轴安全模型 / Two-axis security model** (`lib/sandbox-policy.ts`): ApprovalMode × SandboxMode with 4 presets (safe/standard/full-auto/unrestricted)
- **受保护路径 / Protected paths**: `.git`, `.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `.jks` are always write-blocked
- **默认网络关闭 / Default network-off**: network tools gated unless explicitly enabled
- **桌面通知 / Desktop notifications** (`lib/desktop-notify.ts`): turn-completion alerts via Tauri + browser fallback
- **新斜杠命令 / New slash commands**: `/security`, `/review` (git diff presets), `/model` (mid-session switch), `/resume` (most recent conversation)

### OMX workflow patterns (7/7)

- **`/interview`** (`lib/deep-interview.ts`): Socratic clarification, 6-dim ambiguity scoring, 3 profiles, 3 challenge modes, specs to `.omx/specs/`
- **`/plan`** (`lib/ralplan.ts`): Planner → Architect → Critic deliberation, max 5 iterations, ADR output to `.omx/adrs/`
- **`/ralph`** (`lib/ralph-loop.ts`): 6-stage persistent completion loop (pre-context → execute → verify → review → deslop → regression)
- **`/deslop`** (`lib/ai-slop-cleaner.ts`): idempotent pattern-based AI output scrubber
- **`/wiki`** (`lib/project-wiki.ts`): markdown-first KB with frontmatter + weighted search
- **`/hud`** (`components/HUDMonitor.tsx`): live dashboard (iterations / workers / context / errors) wired into MonitorPage
- **`/doctor`** (enhanced `lib/health-monitor.ts`): dual-layer — install checks (config/storage/memory/indexeddb) + runtime checks (API smoke test / MCP / skills) + diagnostics bundle + quality gate

### Default models updated

- Anthropic 默认切换到最新一代 Claude 模型 / defaults updated to latest Claude generation:
  - Claude Opus 4.7 (`claude-opus-4-7`) — 首选 / primary
  - Claude Sonnet 4.6 (`claude-sonnet-4-6`)
  - Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Watchdog 故障转移链更新 / Watchdog fallback chain updated
- Settings 下拉列表新增 Opus 4.7 / Settings dropdown now includes Opus 4.7

### Infrastructure

- 审计 JSONL logger + artifact 文件系统 / Audit JSONL logger + artifact file system
- 规则记忆管理命令（`/rule-add` `/rules` `/rule-remove` `/rule-toggle`） / Rule memory commands
- 审计日志命令（`/audit` with export） / Audit log command

---

## v0.1.0 (2026-04-11)

首个里程碑版本，learn-claude-code 19 层架构全部实现。

First milestone release, all 19 layers of learn-claude-code architecture implemented.

### 架构 / Architecture

- Agent Loop 重写为 LoopState 状态机（s01） / Agent Loop rewrite with LoopState state machine
- 工具系统 + 权限引擎（s02-s03） / Tool system + permission engine
- Subagent 上下文隔离（s04） / Subagent context isolation
- 三层记忆系统（s05-s06） / 3-layer memory system (short/mid/long-term vector)
- 7 阶段工作流引擎 + 门禁 + 自动修复（s07-s08） / 7-phase workflow engine + gates + auto-repair
- Prompt Cache 优化（s09） / Prompt caching optimization
- System Prompt Pipeline PromptParts 可组装（s10） / Composable system prompt pipeline
- Error Recovery 优雅降级（s11） / Error recovery with graceful degradation
- 错误分类器 16 类（s12） / Error classifier with 16 categories
- 后台任务引擎（s13） / Background tasks engine
- Cron 定时调度引擎（s14） / Cron scheduler engine
- Agent Teams 邮箱系统 + TeammateManager（s15） / Agent teams message bus
- 团队协议引擎（s16） / Team protocols engine
- 自治 Agent 认领引擎（s17） / Autonomous agent claiming engine
- Worktree 隔离引擎（s18） / Worktree isolation engine
- Stream Manager 全局单例（s19） / Stream Manager global singleton

### Provider 系统 / Provider System

- 10 个 AI Provider / 10 AI providers:
  - Anthropic (Claude) / OpenAI (GPT) / Google (Gemini)
  - Kimi (Moonshot) / DeepSeek / 通义千问 (Qwen)
  - MiniMax / 智谱 (GLM) / Ollama (本地 local) / Compatible
- 所有 Provider 支持自定义 Base URL / Custom Base URL for all providers
- Provider 诊断 5 探针（连通性/认证/模型/限流/延迟） / Provider diagnostics with 5 probes
- 23 个模型定价表 / 23 model pricing table
- Compatible provider 自动回退（无 function calling 时） / Auto-fallback for compatible providers

### AI 角色 / AI Roles

- 20 个专业角色（研发 12 + 业务 8） / 20 specialized roles (12 dev + 8 business)
- 每角色含人设 + 专长 + 工具权限 + 阶段亲和 / Each role: personality + expertise + tool access + phase affinity
- Secretary → Coordinator → Worker 编排模式 / Orchestration pattern

### 工具系统 / Tool System

- 12+ 内置工具 / 12+ built-in tools:
  Bash / Read / Write / Edit / Glob / Grep / WebFetch / WebSearch / AskUser / ListDir / BrowserOpen / Screenshot / BrowserFetch
- WebSearch 通过 Rust curl + 系统代理执行 / WebSearch via Rust curl + system proxy
- DuckDuckGo 优先 + 百度回退 / DuckDuckGo first + Baidu fallback
- MCP 协议扩展 / MCP protocol extension

### 飞书集成 / Feishu Integration

- Lark CLI 6 大模块（日历/消息/文档/任务/审批/表格） / 6 modules (Calendar/IM/Doc/Task/Approval/Sheet)
- Remote Bridge 远程控制（长轮询） / Remote Bridge remote control (long-polling)

### UI 功能 / UI Features

- Generative UI（图表/表单/表格内联渲染） / Generative UI (charts/forms/tables inline)
- Skill 市场 5 个预设工作流 / Skill market with 5 preset workflows
- 工作流可视化 SVG 流程图 / Workflow visualization SVG flowchart
- 会话倒回（检查点） / Session rewind (checkpoints)
- 分屏双会话 / Split-screen dual sessions
- 快捷键系统（Cmd+N/K/,/Shift+S/Shift+D） / Keyboard shortcuts
- Token 用量统计 + SVG 柱状图 / Token usage tracking + SVG bar charts
- 对话搜索 + 内容高亮 / Conversation search + content highlighting
- 流式消息渲染（thinking/tools/text 分离） / Streaming message rendering
- 导入导出（Claude JSONL/PDF/图片） / Import/export (JSONL/PDF/Image)
- 深色/浅色主题 / Dark/Light theme

### 基础设施 / Infrastructure

- i18n 中/英 (zh-CN / en-US)
- 5 级权限控制 / 5-level permission control
- IndexedDB 本地持久化 / IndexedDB local persistence
- Prompt Cache 系统提示词缓存 / Prompt caching
- 运行时模块 23 个 / 23 runtime modules
- GitHub Actions CI（typecheck + test + build） / CI quality gates
- 跨平台打包（macOS DMG + Windows MSI） / Cross-platform bundling

### Bug 修复 / Bug Fixes

- SSE 解析兼容 `data:` 和 `data: `（无空格/有空格） / SSE parsing compatibility
- Tauri WebView mixed-content 用 HTTP plugin 绕过 / WebView mixed-content workaround
- 对话切换不丢数据（stream-manager 隔离） / No data loss on conversation switch
- 对话不串台（conv ID ref 隔离） / Conversation ID isolation
- web_search 从 WebView 移到 Rust 后端（curl+proxy） / web_search moved to Rust backend
- 异步 curl 不阻塞 tokio 运行时 / Async curl doesn't block tokio runtime
- web_search 超时增加到 30s / web_search timeout increased to 30s
- 移除 Media Studio（已不需要） / Remove Media Studio
