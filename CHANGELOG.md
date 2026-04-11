# CHANGELOG

## v0.1.0 (2026-04-11)

### 架构
- Agent Loop 重写为 LoopState 状态机（学 learn-claude-code s01）
- Subagent 上下文隔离（s04）
- Agent Teams 邮箱系统 + TeammateManager（s15）
- System Prompt Pipeline PromptParts 可组装（s10）
- Error Recovery 优雅降级（s11）
- Stream Manager 全局单例（学 CodePilot）
- 错误分类器 16 类（学 CodePilot）
- learn-claude-code 19 层全部实现（s01-s19）

### Provider
- 10 个：Anthropic / OpenAI / Google / Kimi / DeepSeek / 通义千问 / MiniMax / 智谱 / Ollama / Compatible
- 自定义 Base URL（所有 Provider 支持）
- Provider 诊断（5 探针）

### 功能
- 20 个 AI 角色（研发 12 + 业务 8）
- 12 个工具（web_search 通过 Rust curl+proxy）
- 工作流可视化（SVG 流程图）
- 飞书集成（Lark CLI 6 个工具）
- 远程控制（Remote Bridge）
- Generative UI（图表/表单/表格）
- Skill 市场（5 个预设工作流）
- 会话倒回（检查点）
- 分屏双会话
- 快捷键（Cmd+Enter/N/,）
- Token 用量图表
- 对话搜索
- 导入导出（JSONL/PDF/Image）
- 深色/浅色主题
- i18n 中/英

### Bug 修复
- SSE 解析兼容 data: 和 data:（无空格）
- Tauri WebView mixed-content 用 HTTP plugin 绕过
- 对话切换不丢数据（stream-manager）
- 对话不串台（conv ID ref 隔离）
- web_search 从 WebView 移到 Rust 后端（curl+proxy）
