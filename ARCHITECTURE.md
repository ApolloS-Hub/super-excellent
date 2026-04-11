# ARCHITECTURE.md

超优秀 (Super Excellent) 是多模型 AI Agent 桌面客户端。Tauri 2.x 做外壳（Rust 后端 + WebView），React 19 做前端，IndexedDB 做本地持久化，自研 TypeScript orchestrator 调度 20 个 AI 角色。

Super Excellent is a multi-model AI Agent desktop client. Tauri 2.x shell (Rust backend + WebView), React 19 frontend, IndexedDB for local persistence, custom TypeScript orchestrator managing 20 AI roles.

## 目录结构 / Directory Structure

```
super-excellent/
├── apps/
│   └── desktop/                    # 主应用 Main app
│       ├── src/                    # React 前端 Frontend
│       │   ├── pages/             #   页面 Pages (ChatPage, SettingsPage, MonitorPage, SkillMarketPage)
│       │   ├── components/        #   组件 Components (GenerativeUI, WorkflowViewer, MarkdownContent …)
│       │   ├── lib/               #   核心逻辑 Core logic
│       │   │   ├── agent-bridge.ts        # 10 Provider 路由 Provider routing
│       │   │   ├── stream-manager.ts      # 全局流管理单例 Global stream singleton
│       │   │   ├── error-classifier.ts    # 16 类错误分类 Error classifier
│       │   │   ├── cost-tracker.ts        # Token 用量统计 Token cost tracking
│       │   │   ├── lark-integration.ts    # 飞书 6 模块 Lark CLI 6 modules
│       │   │   ├── remote-bridge.ts       # 远程控制桥 Remote control bridge
│       │   │   ├── file-history.ts        # 会话倒回 Session rewind
│       │   │   ├── conversations.ts       # 对话管理/搜索 Conversation mgmt/search
│       │   │   ├── permission-engine.ts   # 权限引擎 Permission engine
│       │   │   ├── learning-engine.ts     # 学习引擎 Learning engine
│       │   │   ├── prompt-cache.ts        # Prompt 缓存 Prompt caching
│       │   │   ├── mcp-client.ts          # MCP 协议客户端 MCP client
│       │   │   ├── app-state.ts           # 全局状态 Global state
│       │   │   ├── session-store.ts       # IndexedDB 持久化 Persistence
│       │   │   ├── tauri-bridge.ts        # Tauri IPC 桥 IPC bridge
│       │   │   ├── api-retry.ts           # HTTP 重试 Retry logic
│       │   │   ├── skills.ts              # Skill 市场后端 Skill market
│       │   │   ├── workflows.ts           # 工作流实例 Workflow instances
│       │   │   ├── team.ts                # 团队配置 Team config
│       │   │   └── runtime/               # 运行时模块 Runtime modules (23 files)
│       │   │       ├── agent-dispatch.ts       # Worker 分配 Worker assignment
│       │   │       ├── agent-roster.ts        # Agent 注册/状态 Agent registry
│       │   │       ├── chat-store.ts          # 聊天持久化 Chat persistence
│       │   │       ├── task-store.ts          # 任务持久化 Task persistence
│       │   │       ├── task-heartbeat.ts      # 任务心跳 Task health checks
│       │   │       ├── commander.ts           # 斜杠命令 Slash commands
│       │   │       ├── usage-cost.ts          # 用量预算 Usage budget
│       │   │       ├── monitor.ts             # 健康监控 Health monitor
│       │   │       ├── diagnostics.ts         # 诊断 Diagnostics
│       │   │       ├── notifications.ts       # 通知 Notifications
│       │   │       ├── quality-gate.ts        # 质量门禁 Quality gates
│       │   │       ├── outcome-aggregator.ts  # 结果聚合 Result aggregation
│       │   │       ├── event-system.ts        # 事件总线 Event bus
│       │   │       ├── execution-stream.ts    # 流式执行 Streaming execution
│       │   │       ├── approvals.ts           # 审批流 Approval workflow
│       │   │       └── collaboration.ts       # 团队协作 Team collaboration
│       │   ├── hooks/             #   React Hooks (useSSEStream, useTranslation …)
│       │   ├── i18n/              #   i18n 配置 i18n setup
│       │   └── types/             #   TypeScript 类型 Types
│       ├── locales/               # 翻译文件 Translation files
│       │   ├── zh-CN.json         #   简体中文
│       │   └── en-US.json         #   English
│       └── src-tauri/             # Rust 后端 Rust backend
│           └── src/
│               ├── main.rs        #   入口 Entry
│               ├── lib.rs         #   Tauri 命令注册 Command registration
│               └── tools/
│                   └── mod.rs     #   工具实现 Tool impl (web_search curl+proxy, bash …)
├── packages/
│   ├── agent-core/                # Agent 核心引擎 Core engine
│   │   └── src/
│   │       ├── orchestrator/      #   编排器 Orchestrator
│   │       │   ├── coordinator.ts     # 任务分配 Task assignment
│   │       │   ├── secretary.ts       # 秘书路由 Secretary routing
│   │       │   ├── workers.ts         # Worker 池 Worker pool
│   │       │   ├── roles.ts           # 20 角色定义 20 role definitions
│   │       │   ├── workflow.ts        # 7 阶段工作流 7-phase workflow
│   │       │   ├── workflow-templates.ts  # 工作流模板 Workflow templates
│   │       │   └── task-graph.ts      # 任务依赖图 Task dependency graph
│   │       ├── tools/             #   工具系统 Tool system
│   │       │   ├── index.ts           # 工具注册表 Tool registry
│   │       │   └── builtin/           # 12+ 内置工具 Built-in tools
│   │       └── memory/            #   三层记忆 3-layer memory
│   │           ├── index.ts           # MemoryManager
│   │           ├── short-term.ts      # 短期（内存 50 条）Short-term
│   │           ├── mid-term.ts        # 中期（IndexedDB 30d）Mid-term
│   │           └── long-term.ts       # 长期（向量检索）Long-term vector
│   ├── shared/                    # 共享类型/工具 Shared types/utils
│   └── ui/                        # 共享 UI 组件 Shared UI components
├── scripts/                       # 构建/开发脚本 Build/dev scripts
├── tasks/                         # 任务规格 Task specifications
└── pnpm-workspace.yaml            # Monorepo 配置
```

## 数据流 / Data Flow

### 主对话流 / Main Chat Flow

```
用户输入 User Input
  → ChatPage 组件 Component
  → agent-bridge.ts（选择 Provider + 构建请求 Select provider + build request）
  → Tauri IPC → Rust 后端 Backend（web_search 等工具 tools via curl）
  → LLM Provider API（10 个可选 10 available）
  → SSE 流式响应 Streaming response
  → stream-manager.ts（全局单例管理 Global singleton）
  → React 组件渲染 Component render（MarkdownContent / GenerativeUI / ToolProgress）
  → IndexedDB 持久化 Persistence
```

### Agent 编排流 / Agent Orchestration Flow

```
用户请求 User request
  → Secretary（意图识别 Intent recognition）
  → Coordinator（角色匹配 + 任务分配 Role match + task assign）
  → Worker Pool（并行执行 Parallel execution）
  → 7 阶段工作流 7-phase workflow（think → plan → build → review → test → ship → reflect）
  → 质量门禁 Quality gates
  → 结果聚合 Result aggregation
  → 返回用户 Return to user
```

### 远程控制流 / Remote Control Flow

```
飞书消息 Feishu message
  → Remote Bridge（长轮询 Long-polling, 3s interval）
  → Agent 处理 Agent processing
  → 响应回飞书 Response back to Feishu
```

### 记忆流 / Memory Flow

```
对话轮次 Conversation turn
  → 短期记忆 Short-term（内存 50 条 In-memory 50 entries）
  → 学习引擎 Learning engine（提取模式 Extract patterns）
  → 中期记忆 Mid-term（IndexedDB, 30d TTL）
  → 长期记忆 Long-term（哈希嵌入 192 维 Hash embedding 192-dim + 余弦相似度 Cosine similarity）
  → 系统提示词注入 System prompt injection
```

## 核心模块说明 / Core Module Description

### Agent 引擎 / Agent Engine (`packages/agent-core/`)

| 模块 Module | 文件 File | 说明 Description |
|------|------|------|
| Secretary | `orchestrator/secretary.ts` | 入口路由，分析用户意图，派发给合适角色 Entry router, intent analysis, role dispatch |
| Coordinator | `orchestrator/coordinator.ts` | 任务分配、依赖解析、并行调度 Task assignment, dependency resolution, parallel scheduling |
| Workers | `orchestrator/workers.ts` | Worker 池管理，执行隔离 Worker pool, execution isolation |
| Roles | `orchestrator/roles.ts` | 20 角色定义（人设 + 专长 + 工具权限 + 阶段亲和） 20 role definitions (personality + expertise + tool access + phase affinity) |
| Workflow | `orchestrator/workflow.ts` | 7 阶段流水线 + 门禁 + 自动修复 7-phase pipeline + gates + auto-repair |
| Task Graph | `orchestrator/task-graph.ts` | DAG 任务图，支持并行 + 重试 DAG task graph, parallel + retry |
| Tool Registry | `tools/index.ts` | 工具注册/发现/执行 Tool register/discover/execute |
| Memory | `memory/` | 三层记忆（短期/中期/长期向量） 3-layer memory (short/mid/long-term vector) |

### 前端运行时 / Frontend Runtime (`apps/desktop/src/lib/runtime/`)

| 模块 Module | 说明 Description |
|------|------|
| agent-dispatch | Worker 分配和消息路由 Worker assignment and message routing |
| agent-roster | Agent 注册、状态快照 Agent registry, status snapshots |
| chat-store | 聊天消息持久化 (IndexedDB) Chat message persistence |
| task-store | 任务生命周期管理 (IndexedDB) Task lifecycle management |
| task-heartbeat | 运行中任务健康检查 Running task health checks |
| commander | 斜杠命令解析/执行 Slash command parser/executor |
| usage-cost | Token 追踪 + 预算管理 Token tracking + budget management |
| monitor | 持续健康监控 Continuous health monitoring |
| diagnostics | 系统状态诊断包 System state diagnostic bundle |
| quality-gate | 输出质量验证 Output quality verification |
| outcome-aggregator | 多 Worker 结果聚合 Multi-worker result aggregation |
| event-system | 发布/订阅事件总线 Pub/sub event bus |
| execution-stream | 流式执行管理 Streaming execution management |
| approvals | 工具执行审批流 Tool execution approval workflow |

### Rust 后端 / Rust Backend (`apps/desktop/src-tauri/`)

| 功能 Feature | 说明 Description |
|------|------|
| web_search | curl + 系统代理，DuckDuckGo 优先 + 百度回退 curl + system proxy, DuckDuckGo first + Baidu fallback |
| bash | 终端命令执行（120s 超时） Terminal command execution (120s timeout) |
| 文件沙箱 File sandbox | 受控文件系统访问 Controlled filesystem access |
| Tauri IPC | 前端-后端通信桥 Frontend-backend communication bridge |

### 关键单体模块 / Key Standalone Modules

| 模块 Module | 文件 File | 说明 Description |
|------|------|------|
| Stream Manager | `lib/stream-manager.ts` | globalThis 全局单例，HMR 安全，330s 空闲超时 Global singleton, HMR-safe, 330s idle timeout |
| Error Classifier | `lib/error-classifier.ts` | 16 类错误 → 中英文提示 + 恢复动作 16 categories → i18n messages + recovery actions |
| Cost Tracker | `lib/cost-tracker.ts` | 23 模型定价，IndexedDB 持久化 23 model pricing, IndexedDB persistence |
| Provider Bridge | `lib/agent-bridge.ts` | 10 Provider 路由 + 上下文窗口映射 10 provider routing + context window mapping |
| Lark Integration | `lib/lark-integration.ts` | 飞书 6 模块 CLI 封装 Feishu 6-module CLI wrapper |
| Remote Bridge | `lib/remote-bridge.ts` | 飞书远程控制（长轮询） Feishu remote control (long-polling) |
| File History | `lib/file-history.ts` | 文件修改备份 + diff + 倒回 File modification backup + diff + rewind |
| Permission Engine | `lib/permission-engine.ts` | 5 级权限控制 5-level permission control |
| Learning Engine | `lib/learning-engine.ts` | 对话模式提取 + 持久化 Conversation pattern extraction + persistence |
| Prompt Cache | `lib/prompt-cache.ts` | Anthropic prompt caching 优化 Prompt caching optimization |

## 技术栈 / Tech Stack

| 层 Layer | 技术 Technology | 版本 Version |
|----|------|------|
| 桌面外壳 Desktop Shell | Tauri | 2.x |
| 前端框架 Frontend Framework | React | 19.1.0 |
| 语言 Language | TypeScript | 5.8.0 |
| 构建 Build Tool | Vite | 6.3.0 |
| UI 组件库 UI Library | Mantine | 7.17.0 |
| CSS | Tailwind CSS | 3.4.17 |
| 国际化 i18n | i18next | 25.1.0 |
| Markdown 渲染 | react-markdown | 10.1.0 |
| 异步运行时 Async Runtime | tokio | 1.x |
| HTTP 客户端 HTTP Client | reqwest (Rust) | 0.12 |
| 序列化 Serialization | serde | 1.x |
| 包管理 Package Manager | pnpm workspace | — |
| 测试 Testing | Vitest | 3.2.4 |
| CI | GitHub Actions | — |
| 打包 Bundler | Tauri bundler (DMG + MSI) | — |

## 新增功能触及点 / New Feature Touchpoints

添加新功能时通常需要修改以下位置 / When adding a new feature, typically modify:

| 触及点 Touchpoint | 路径 Path | 说明 Description |
|--------|------|------|
| 类型定义 Types | `apps/desktop/src/types/` | 新增接口/类型 New interfaces/types |
| 核心逻辑 Core Logic | `apps/desktop/src/lib/` | 业务逻辑模块 Business logic module |
| 运行时 Runtime | `apps/desktop/src/lib/runtime/` | 运行时集成 Runtime integration |
| 页面 Pages | `apps/desktop/src/pages/` | 新增路由页面 New route pages |
| 组件 Components | `apps/desktop/src/components/` | UI 组件 UI components |
| Hook | `apps/desktop/src/hooks/` | 状态管理 Hook State management hooks |
| 国际化 i18n | `apps/desktop/locales/` | zh-CN.json + en-US.json |
| Agent 角色 Roles | `packages/agent-core/src/orchestrator/roles.ts` | 角色定义 Role definitions |
| 工具 Tools | `packages/agent-core/src/tools/builtin/` | 内置工具 Built-in tools |
| Rust 后端 Backend | `apps/desktop/src-tauri/src/` | Tauri 命令 Tauri commands |
