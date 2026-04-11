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
- **工作流可视化**：SVG 实时流程图，看到角色怎么协作
- **飞书集成**：日历、消息、文档、任务、审批、表格（通过 Lark CLI）
- **远程控制**：从飞书发消息，桌面 Agent 执行
- **Generative UI**：AI 生成图表、表单、表格，消息内联渲染
- **Skill 市场**：5 个预设工作流模板（日报、会议纪要、竞品分析等）
- **会话倒回**：回到任意消息检查点
- **分屏双会话**：左右同时看两个对话
- **快捷键**：Cmd+Enter 发送、Cmd+N 新对话
- **Token 用量统计**：SVG 柱状图，按 Provider/Model 分类
- **Provider 诊断**：5 探针检测（连接、认证、模型、限流、延迟）
- **12 个内置工具**：web_search、bash、文件读写、grep 等
- **三层记忆**：短期（会话）→ 中期（IndexedDB）→ 长期（语义检索）
- **Prompt Cache**：系统提示词缓存、会话压缩
- **5 级权限**：从完全自动到需要审批
- **错误分类器**：16 类结构化错误 + 用户友好提示
- **多语言**：中文 / English

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
- **20 specialized AI roles**: 12 engineering + 8 business/operations
- **Workflow visualization**: Real-time SVG diagrams of role collaboration
- **Feishu integration**: Calendar, IM, Docs, Tasks, Approval, Sheets via Lark CLI
- **Remote control**: Send commands from Feishu, Agent executes on desktop
- **Generative UI**: AI renders charts, forms, tables inline
- **Skill marketplace**: 5 built-in workflow templates
- **Session rewind**: Return to any message checkpoint
- **Split-screen**: Side-by-side dual conversations
- **Keyboard shortcuts**: Cmd+Enter send, Cmd+N new chat
- **Token usage charts**: SVG bar charts by provider/model
- **Provider diagnostics**: 5-probe health check
- **16-category error classifier**: User-friendly error messages
- **Dark / Light theme**
- **i18n**: Chinese + English

### Quick Start

```bash
pnpm install
pnpm dev
```

## License

MIT
