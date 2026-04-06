# 🌟 超优秀 (Super Excellent)

跨平台 AI Agent 桌面客户端 — 你只跟秘书对话，秘书调度 AI 员工干活。

[中文](#中文) | [English](#english)

---

## 中文

### 核心理念

```
你（用户）→ 秘书 Agent → AI 员工团队
```

你只需要跟秘书说话，秘书会：
1. 理解你的需求
2. 判断需要哪些员工
3. 自动派发任务
4. 收集结果
5. 把成品交给你

### AI 员工团队（20 个专业角色）

**研发团队**

| 角色 | 职责 |
|------|------|
| 🎯 产品经理 | 需求分析、PRD、用户故事、产品规划 |
| 🏗️ 架构师 | 系统设计、架构决策、技术选型 |
| 💻 全栈开发 | 代码实现、功能开发、Bug 修复、重构 |
| 🎨 前端工程师 | UI 实现、组件开发、性能优化 |
| 🔍 代码审查 | 质量把关、安全检查、最佳实践 |
| 🧪 测试工程师 | 测试策略、自动化测试、回归测试 |
| 🚀 运维工程师 | CI/CD、部署、监控、基础设施 |
| 🛡️ 安全工程师 | 威胁建模、安全审计、漏洞分析 |
| 📝 技术文档 | API 文档、用户指南、变更日志 |
| 🔬 研究员 | 技术调研、竞品分析、方案评估 |
| 🎭 UX 设计师 | 用户体验、交互设计、信息架构 |
| 📊 数据分析师 | 数据分析、指标设计、可视化 |

**业务团队**

| 角色 | 职责 |
|------|------|
| 👔 运营总监 | 战略规划、业务推进、跨部门协调 |
| 🚀 增长黑客 | 用户增长、转化漏斗、A/B 测试 |
| 📢 内容运营 | 内容策略、社媒运营、品牌传播 |
| ⚖️ 法务合规 | 合规检查、隐私保护、合同审核 |
| 💰 财务分析 | 预算管理、成本分析、ROI 计算 |
| 📅 项目经理 | 进度跟踪、风险管控、资源调配 |
| 🎧 客户支持 | 反馈处理、FAQ 维护、满意度提升 |
| 🛡️ 风控分析 | 风险识别、应急预案、灾难恢复 |

### 核心能力

- **12 个内置工具**：终端、文件、编辑、搜索、浏览器、截图...
- **三层记忆**：短期（会话）→ 中期（文件）→ 长期（语义检索）
- **Prompt Cache 优化**：系统提示词缓存、会话压缩、工具结果截断
- **MCP 协议**：连接外部 MCP 服务器扩展能力
- **5 级权限控制**：从完全自动到需要审批
- **自动修复**：配置损坏时自动恢复
- **多语言**：中文 / English

### 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 运行测试
pnpm test
```

### 配置

首次启动后，在设置页面配置：
1. 选择 AI 提供商（Claude / OpenAI / 兼容端点）
2. 填入 API Key
3. 选择模型
4. 选择语言

---

## English

### Core Concept

```
You (User) → Secretary Agent → AI Worker Team
```

Just talk to the Secretary. It will:
1. Understand your request
2. Determine which workers are needed
3. Dispatch tasks automatically
4. Collect results
5. Deliver the final output

### Features

- **20 specialized AI roles**: 12 engineering + 8 business/operations
- **12 built-in tools**: Terminal, files, editing, search, browser, screenshot...
- **Three-layer memory**: Short-term → Mid-term → Long-term (vector semantic search)
- **Workflow templates**: Structured step-by-step workflows for business roles
- **Prompt caching**: System prompt cache, conversation compaction
- **MCP protocol**: Connect external MCP servers
- **5-level permissions**: From fully automatic to user approval required
- **Auto-repair**: Self-healing when config breaks
- **i18n**: 中文 / English

### Quick Start

```bash
pnpm install
pnpm dev
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2.x (Rust + WebView) — macOS verified, Windows CI smoke |
| Frontend | React 19 + TypeScript + Vite 6 |
| UI | Mantine + Tailwind CSS |
| Agent | TypeScript (custom engine) |
| i18n | i18next |

## Architecture

```
┌────────────────────────────────────────────┐
│              Super Excellent                │
│                                            │
│  Tauri Shell (Rust)                        │
│  ├── Terminal execution                    │
│  ├── File system sandbox                   │
│  ├── Health check / auto-repair            │
│  └── Native APIs                           │
│                                            │
│  Frontend (React + Mantine)                │
│  ├── Chat UI (streaming)                   │
│  ├── Settings (provider config)            │
│  ├── Agent Monitor (worker status)         │
│  └── Permission Dialog (approval flow)     │
│                                            │
│  Agent Core (TypeScript)                   │
│  ├── QueryEngine (agentic loop)            │
│  ├── Secretary (Coordinator-Worker)        │
│  ├── Multi-role worker system              │
│  ├── 12 built-in tools                     │
│  ├── Three-layer memory                    │
│  ├── Prompt cache optimization             │
│  └── MCP client                            │
│                                            │
│  Providers                                 │
│  ├── Anthropic (Claude + prompt caching)   │
│  ├── OpenAI (GPT)                          │
│  └── Compatible endpoints                  │
└────────────────────────────────────────────┘
```

## License

MIT
