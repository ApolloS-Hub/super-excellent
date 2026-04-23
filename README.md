# 🌟 超优秀 (Super Excellent)

非开发人员的 AI 工作助手平台 — 你只跟秘书对话，秘书调度 AI 员工团队帮你干活。

[中文](#中文) | [English](#english)

---

## 中文

### 核心理念

```
你（用户）→ 秘书 Agent → AI 员工团队 → 自动完成任务
```

你只需要用自然语言说需求，秘书会分析意图、匹配角色、派发任务、收集结果。

### AI 员工团队（20 个专业角色）

**研发团队（12 人）**

| 角色 | 职责 |
|------|------|
| 🎯 产品经理 | 需求分析、PRD、用户故事 |
| 🏗️ 架构师 | 系统设计、技术选型 |
| 💻 全栈开发 | 代码实现、Bug 修复 |
| 🎨 前端工程师 | UI 开发、性能优化 |
| 🔍 代码审查 | 质量把关、安全检查 |
| 🧪 测试工程师 | 测试策略、自动化 |
| 🚀 运维工程师 | CI/CD、部署监控 |
| 🛡️ 安全工程师 | 威胁建模、安全审计 |
| 📝 技术文档 | API 文档、用户指南 |
| 🔬 研究员 | 技术调研、竞品分析 |
| 🎭 UX 设计师 | 用户体验、交互设计 |
| 📊 数据分析师 | 数据分析、可视化 |

**业务团队（8 人）**

| 角色 | 职责 |
|------|------|
| 👔 运营总监 | 战略规划、跨部门协调 |
| 🚀 增长黑客 | 用户增长、A/B 测试 |
| 📢 内容运营 | 内容策略、社媒运营 |
| ⚖️ 法务合规 | 合规检查、隐私保护 |
| 💰 财务分析 | 预算管理、ROI 计算 |
| 📅 项目经理 | 进度跟踪、风险管控 |
| 🎧 客户支持 | 反馈处理、FAQ 维护 |
| 🛡️ 风控分析 | 风险识别、应急预案 |

### 核心功能

- **10 个 AI 供应商**：Anthropic / OpenAI / Google / Kimi / DeepSeek / 通义千问 / MiniMax / 智谱 / Ollama / 自定义兼容
  - Claude 模型默认：Opus 4.7 / Sonnet 4.6 / Haiku 4.5
- **工作流可视化**：SVG 实时流程图，看到角色怎么协作
- **Lark 集成**：日历、消息、文档、任务、审批、表格、邮件
  - 直接 HTTP 调用 `open.larksuite.com`，**不依赖** lark-cli 外部二进制
  - 双层认证：tenant_access_token（应用凭证）+ user_access_token（浏览器 OAuth 授权）
  - 用户 OAuth 后才能访问你的**个人**日历/文档/任务（必需！）
- **远程控制**：从 Lark 发消息，桌面 Agent 执行
- **Generative UI**：AI 生成图表、表单、表格，消息内联渲染
- **35 个 Skill**：lark 工作流 + 开发规范 + 个人效率（会议/沟通/决策/优先级/精力管理/反馈/周复盘/收件箱/说不 等）
- **会话倒回**：回到任意消息检查点
- **分屏双会话**：左右同时看两个对话
- **快捷键**：Cmd+Enter 发送、Cmd+N 新对话
- **Token 用量统计**：SVG 柱状图，按 Provider/Model 分类
- **Provider 诊断**：5 探针检测（连接、认证、模型、限流、延迟）
- **12 个内置工具**：web_search、bash、文件读写、grep 等
- **三层记忆 + 观察日志**：
  - 短期（会话）→ 中期（IndexedDB）→ 长期（语义检索）
  - **Observation Log**（受 claude-mem 启发）：自动从 event bus 捕获工具调用/消息/派发，三层累进披露检索（compact 索引 → timeline → 完整详情），支持 `<private>` 标签隐私过滤
- **Prompt Cache**：系统提示词缓存、会话压缩
- **5 级权限**：从完全自动到需要审批
- **错误分类器**：16 类结构化错误 + 用户友好提示
- **多语言**：中文 / English

### Codex 风格的安全与控制层

灵感来自 openai/codex，覆盖"两轴决策"模型与常用工作流：

- **双轴安全策略**：审批模式（on-request/untrusted/never）× 沙箱模式（read-only/workspace-write/full-access），4 个预设：safe / standard / full-auto / unrestricted
- **受保护路径**：`.git` `.env` `.pem` 等永远不可写入
- **默认网络关闭**：联网工具必须显式开启
- **桌面通知**：AI 长任务完成后系统级通知
- **`/security`**：查看或切换预设
- **`/review`**：对 git diff 做 AI 代码审查（uncommitted / staged / branch / commit）
- **`/model`**：会话中切换模型
- **`/resume`**：恢复最近一次对话

### OMX 工作流模式

灵感来自 oh-my-codex 的 7 个模式，全部已实现：

- **`/interview`**：苏格拉底式澄清面谈，6 维歧义度打分 + 3 档位（quick/standard/deep）+ 3 挑战模式（contrarian/simplifier/ontologist），产出 spec 保存到 `.omx/specs/`
- **`/plan`**：Planner → Architect → Critic 三角色协商，最多 5 轮，生成 ADR 到 `.omx/adrs/`
- **`/ralph`**：6 阶段持续完成循环（pre-context → execute → verify → review → deslop → regression）
- **`/deslop`**：AI 产出"套路"清扫器——移除冗余注释、"As an AI..."前言、emoji 噪声
- **`/wiki`**：基于 markdown 的项目知识库，支持 CRUD + 搜索 + frontmatter 标签
- **`/hud`**：实时仪表盘（迭代/worker/context 占用/错误），70%/90% 黄红阈值
- **`/doctor`**：双层诊断——install 层（config/storage/memory/indexeddb）+ runtime 层（API smoke test / MCP / skills）+ 运行环境 + 质量门禁，产出可执行建议

### 场景引擎 + 变更传播 + 上下文自举 + 质量门禁

灵感来自 product-playbook / claude-mem / OpenSpec / lenny-skills：

- **场景引擎（Scenario Engine）**：6 个结构化多步骤状态机场景 —— 周计划制定、会议准备、邮件处理、每日站会、文档审查、**需求规格化**（spec_driven）。用户一句话触发完整流程，每步有明确 worker 和 IO 契约。
- **变更传播（Artifact Graph）**：DAG 依赖图，上游改动自动标脏下游，拓扑排序重生成。
- **跨会话上下文（Context Bootstrap）**：`.secretary-context.md` 式结构化 markdown 记忆（活跃项目/待办/决策/偏好/焦点/障碍），启动自动收集 + 注入 system prompt。
- **质量门禁（Quality Gates）**：每个 worker 产出过一道角色专属 checklist（开发者要有代码块、作家要有结构、研究员要有来源），不达标带反馈重试。
- **环境扫描（Build Mode）**：规划任务前主动扫 git 仓库、技术栈、最近提交，注入真实约束。
- **观察日志（Observation Log）**：自动从 event bus 捕获工具调用/消息/派发事件，Jaccard 去重，`<private>` 标签过滤，三层累进披露检索（`/recall` → `/recall-timeline` → `/recall-details`）。
- **需求规格化流水线**：`/propose <想法>` → proposal → spec → design → tasks → review 五步产出，`/apply` 按 tasks 清单执行，`/archive` 归档到历史决策。

### 快速开始

```bash
pnpm install
pnpm dev          # 开发模式
pnpm build        # 构建
pnpm test         # 测试
```

### 技术栈

| 层 | 技术 |
|----|------|
| 桌面 | Tauri 2.x (Rust + WebView) — macOS 已验证，Windows CI |
| 前端 | React 19 + TypeScript + Vite 6 |
| UI | Mantine 7 |
| Agent | TypeScript 自研引擎 |
| i18n | i18next |

---

## English

### Core Concept

```
You (User) → Secretary Agent → AI Worker Team → Tasks Done
```

Just tell the Secretary what you need. It analyzes intent, matches roles, dispatches tasks, and delivers results.

### Features

- **10 AI providers**: Anthropic, OpenAI, Google, Kimi, DeepSeek, Qwen, MiniMax, Zhipu, Ollama, Custom
  - Claude defaults: Opus 4.7 / Sonnet 4.6 / Haiku 4.5
- **20 specialized AI roles**: 12 engineering + 8 business/operations
- **Workflow visualization**: Real-time SVG diagrams of role collaboration
- **Lark integration**: Calendar, IM, Docs, Tasks, Approval, Sheets, Email
  - Direct HTTP calls to `open.larksuite.com` — **no** lark-cli binary dependency
  - Two-tier auth: tenant_access_token (app credentials) + user_access_token (browser OAuth)
  - Personal data (calendar/docs/tasks) requires user OAuth — paste-back flow
- **Remote control**: Send commands from Lark, Agent executes on desktop
- **Generative UI**: AI renders charts, forms, tables inline
- **35 skills**: Lark workflows + dev practices + personal productivity (meetings, conversations, decisions, prioritization, focus, feedback, weekly review, inbox, saying no)
- **Session rewind**: Return to any message checkpoint
- **Split-screen**: Side-by-side dual conversations
- **Keyboard shortcuts**: Cmd+Enter send, Cmd+N new chat
- **Token usage charts**: SVG bar charts by provider/model
- **Provider diagnostics**: 5-probe health check
- **3-tier memory + observation log**:
  - Short-term (session) → mid-term (IndexedDB) → long-term (vector recall)
  - **Observation Log** (claude-mem inspired): auto-capture from event bus, Jaccard dedup, `<private>` tag filtering, progressive disclosure (`/recall` → `/recall-timeline` → `/recall-details`)
- **16-category error classifier**: User-friendly error messages
- **Dark / Light theme**
- **i18n**: Chinese + English

### Codex-style safety & control layer

Inspired by openai/codex, covering the two-axis decision model and common workflows:

- **Two-axis security**: ApprovalMode (on-request/untrusted/never) × SandboxMode (read-only/workspace-write/full-access), 4 presets: safe / standard / full-auto / unrestricted
- **Protected paths**: `.git` `.env` `.pem` etc. are never writable
- **Default network-off**: network tools must be explicitly enabled
- **Desktop notifications**: system-level alerts when long-running turns finish
- **`/security`**: inspect or switch preset
- **`/review`**: AI code review over git diffs (uncommitted / staged / branch / commit)
- **`/model`**: switch model mid-session
- **`/resume`**: restore the most recent conversation

### OMX workflow patterns

Inspired by oh-my-codex's 7 patterns, all implemented:

- **`/interview`**: Socratic clarification with 6-dim ambiguity scoring, 3 profiles (quick/standard/deep), 3 challenge modes (contrarian/simplifier/ontologist). Spec saved to `.omx/specs/`.
- **`/plan`**: Planner → Architect → Critic deliberation, max 5 iterations, ADR output to `.omx/adrs/`.
- **`/ralph`**: 6-stage persistent completion loop (pre-context → execute → verify → review → deslop → regression).
- **`/deslop`**: idempotent AI-slop scrubber — strips redundant comments, "As an AI..." preambles, emoji-log noise.
- **`/wiki`**: markdown-first project knowledge base with CRUD + tag-weighted search.
- **`/hud`**: live dashboard (iterations / workers / context usage / errors) with 70%/90% yellow/red thresholds.
- **`/doctor`**: dual-layer diagnostic — install layer (config / storage / memory / indexeddb) + runtime layer (API smoke test / MCP / skills) + runtime env + quality gate, with actionable suggestions.

### Scenario engine + change propagation + context bootstrap + quality gates

Inspired by product-playbook / claude-mem / OpenSpec / lenny-skills:

- **Scenario Engine** — 6 structured multi-step state machines: weekly planning, meeting prep, email triage, daily standup, doc review, and **spec-driven development**. One sentence triggers the full pipeline; each step has an explicit worker and IO contract.
- **Artifact Graph** — DAG dependency graph with BFS stale propagation + topological regeneration.
- **Context Bootstrap** — `.secretary-context.md`-style structured markdown memory (active projects / pending tasks / decisions / preferences / focus / blockers), auto-collected on startup and injected into worker prompts.
- **Quality Gates** — every worker output passes a role-specific checklist (developer must have code blocks, writer must have structure, researcher must cite sources) — failures trigger feedback-guided retry.
- **Environment Scanner (Build Mode)** — before planning, actively scans git repos, tech stacks, and recent commits; injects real-world constraints.
- **Observation Log** — auto-captures tool_use / tool_result / user_message / worker_dispatch from the event bus, Jaccard dedup, `<private>` tag redaction, 3-layer retrieval (`/recall` → `/recall-timeline` → `/recall-details`).
- **Spec-driven pipeline** — `/propose <idea>` → proposal → spec → design → tasks → review; `/apply` executes the checklist; `/archive` commits the summary to historical decisions.

### Quality bar

- **37 test files / 490 tests passing** — coverage for all major modules
- **Tauri plugin-http + OAuth 2.0** for Lark (no shell-out)
- **IndexedDB** persistence for conversations, memory, observations

### Quick Start

```bash
pnpm install
pnpm dev
```

## License

MIT
