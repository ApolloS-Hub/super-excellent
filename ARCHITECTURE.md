# ARCHITECTURE.md

超优秀是非开发人员的 AI 工作助手平台。Tauri 2.x 做桌面壳，React 19 + Mantine 做前端，TypeScript 自研 Agent 引擎。

## 目录结构

```
apps/desktop/
├── src/
│   ├── App.tsx              # 主布局（导航栏、对话列表、分屏）
│   ├── pages/
│   │   ├── ChatPage.tsx     # 聊天主页面
│   │   ├── SettingsPage.tsx  # 设置（Provider/诊断/飞书/远程）
│   │   ├── MonitorPage.tsx   # Agent 监控（角色状态/工作流/任务/用量）
│   │   └── SkillMarketPage.tsx # Skill 市场
│   ├── lib/
│   │   ├── agent-bridge.ts   # Agent 引擎（LoopState/callAnthropic/callOpenAI/callGemini）
│   │   ├── coordinator.ts    # 秘书路由（意图分析→Worker派发）
│   │   ├── team.ts           # 20 角色定义 + TeammateManager + MessageBus
│   │   ├── tools.ts          # 12 工具注册与执行
│   │   ├── tool-registry.ts  # 动态工具注册表
│   │   ├── stream-manager.ts # 全局流管理单例（学 CodePilot）
│   │   ├── error-classifier.ts # 16 类错误分类（学 CodePilot）
│   │   ├── api-retry.ts      # HTTP 请求重试 + Tauri HTTP plugin
│   │   ├── memory.ts         # 记忆系统
│   │   ├── skills.ts         # 技能加载
│   │   ├── hooks.ts          # Hook 系统
│   │   ├── lark-integration.ts # 飞书 CLI 集成
│   │   ├── remote-bridge.ts  # 远程控制
│   │   ├── workflows.ts      # 工作流模板
│   │   ├── prompt-cache.ts   # Prompt 缓存
│   │   ├── watchdog.ts       # 降级看门狗
│   │   └── runtime/          # 任务/审批/用量/诊断
│   └── components/
│       ├── WorkflowViewer.tsx # SVG 工作流可视化
│       └── GenerativeUI.tsx   # AI 生成图表/表单/表格
├── src-tauri/
│   ├── src/lib.rs            # Rust 后端（API/工具/搜索/文件/终端）
│   └── capabilities/         # Tauri 权限配置
```

## 数据流

```
用户输入 → ChatPage.handleSend
         → stream-manager.startStream()
         → agent-bridge.sendMessage()
         → coordinator.analyzeIntent() → 匹配 Worker 或直连 LLM
         → callAnthropic/callOpenAI (LoopState 状态机)
         → onEvent 回调 → stream-manager 更新 snapshot
         → ChatPage 订阅 snapshot → 渲染消息
         → session-store 持久化到 IndexedDB
```

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Tauri 2.x (Rust + WebView) |
| 前端 | React 19 + TypeScript + Vite 6 |
| UI | Mantine 7 |
| Agent | TypeScript 自研引擎 (LoopState) |
| 持久化 | IndexedDB (session-store.ts) |
| HTTP | Tauri HTTP plugin + Rust reqwest |
| 搜索 | Rust curl + proxy → HackerNews API |
| 飞书 | lark-cli (200+ 命令) |
| i18n | i18next |
| 打包 | Tauri bundler (DMG + MSI) |
| CI | GitHub Actions |
