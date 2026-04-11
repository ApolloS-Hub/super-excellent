# Super Excellent — 项目计划 / Project Plan

## 已完成 / Completed

### learn-claude-code 19 层架构 ✅

| Layer | 功能 Feature | 状态 Status |
|-------|------|------|
| s01 | Agent Loop LoopState 状态机 | ✅ |
| s02 | 工具系统 Tool system | ✅ |
| s03 | 权限引擎 Permission engine | ✅ |
| s04 | Subagent 上下文隔离 Context isolation | ✅ |
| s05 | 短期记忆 Short-term memory | ✅ |
| s06 | 中期/长期记忆 Mid/Long-term memory | ✅ |
| s07 | 工作流引擎 Workflow engine | ✅ |
| s08 | 质量门禁 Quality gates | ✅ |
| s09 | Prompt Cache 优化 | ✅ |
| s10 | System Prompt Pipeline | ✅ |
| s11 | Error Recovery 优雅降级 | ✅ |
| s12 | 错误分类器 Error classifier (16 类) | ✅ |
| s13 | 后台任务引擎 Background tasks | ✅ |
| s14 | Cron 调度引擎 Cron scheduler | ✅ |
| s15 | Agent Teams 邮箱 Message bus | ✅ |
| s16 | 团队协议引擎 Team protocols | ✅ |
| s17 | 自治 Agent Autonomous agent | ✅ |
| s18 | Worktree 隔离 Worktree isolation | ✅ |
| s19 | Stream Manager 全局单例 | ✅ |

### Provider 系统 ✅

- 10 个 Provider 全部接通 / All 10 providers connected
- 自定义 Base URL / Custom Base URL
- Provider 诊断 5 探针 / 5-probe diagnostics
- 23 模型定价 / 23 model pricing

### AI 角色 ✅

- 20 角色定义完成（12 研发 + 8 业务） / 20 roles defined

### UI 功能 ✅

- Generative UI（图表/表单/表格） / Charts/forms/tables
- Skill 市场 5 个预设 / 5 preset skills
- 工作流可视化 SVG / Workflow SVG
- 会话倒回 / Session rewind
- 分屏双会话 / Split-screen
- 快捷键 / Keyboard shortcuts
- Token 用量统计 / Token usage
- 对话搜索 / Conversation search
- 流式渲染 / Streaming rendering
- 导入导出 / Import/export
- i18n 中/英 / i18n zh/en

### 飞书集成 ✅

- Lark CLI 6 模块 / 6 modules
- Remote Bridge / Remote control

### 基础设施 ✅

- 错误分类器 16 类 / Error classifier
- Stream Manager 全局单例 / Global singleton
- GitHub Actions CI / CI pipeline
- 跨平台打包 DMG + MSI / Cross-platform bundling

---

## 当前优先级 / Current Priorities

### P0: 长期向量记忆真正落地 / Long-term Vector Memory Production-Ready

- **目标 Goal**: 端到端向量记忆 — 嵌入对话轮次，存储到本地向量索引，每次 LLM 调用前语义检索相关上下文
- **方案 Approach**: 在 coordinator 管线中添加嵌入步骤（通过本地或 Provider 嵌入模型），向量持久化到磁盘（如 hnswlib 或 SQLite-vec），查询时注入 top-k 召回块到系统提示词
- **验证 Validation**: 集成测试 — 第 N 轮声明的事实在第 N+10 轮（内存窗口已清空后）仍能被检索到；typecheck 和 build 保持绿色
- **状态 Status**: 离线哈希嵌入 192 维已实现，需要升级到真正的 embedding 模型

### P0: 测试主链路补齐 / Core Path Test Coverage

- 至少覆盖 memory / coordinator / permission 关键路径
- **状态 Status**: Vitest 已配置，部分测试已有

### P0: CI 质量门禁 / CI Quality Gates

- typecheck / build / test 流水线
- **状态 Status**: GitHub Actions 已配置

### P1: 业务角色工作流模板化 / Business Role Workflow Templates

- 8 个业务角色已有工作流模板
- **状态 Status**: 基础版已完成，需要实际业务场景验证

### P1: Windows 验收 / Windows Validation

- 仅补链路，不宣称通过
- **状态 Status**: MSI 构建已在 CI，需要实机测试

---

## 不在范围 / Out of Scope (This Round)

- 宣称 Windows 实机验收通过 / Claim Windows real-device validation
- 复杂云端发布基础设施 / Complex cloud release infrastructure
- 大规模 UI 重构 / Large-scale UI refactoring
- 多用户/团队协作 / Multi-user/team collaboration
