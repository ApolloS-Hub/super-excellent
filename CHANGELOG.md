# CHANGELOG

超优秀 (Super Excellent) 变更日志。

All notable changes to Super Excellent.

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
