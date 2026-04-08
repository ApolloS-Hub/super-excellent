# Spec: E2E 测试

## 目标
为 Super Excellent 建立完整的 E2E 测试套件，覆盖核心用户流程。

## 当前状态
- 单元测试：84 tests 全绿（vitest）
- E2E：零覆盖
- 技术栈：Tauri 2.x + React + Mantine

## 技术方案
用 **Vitest + @testing-library/react** 做组件级 E2E（不需要真 Tauri 窗口），因为：
- 核心逻辑在 React 层，Rust 层已有 Tauri command 单独测试
- 不需要额外安装 Playwright/WebDriver
- CI 友好，无需 display server

## 改什么

### 1. 创建 `apps/desktop/src/__tests__/e2e/` 目录

### 2. 测试文件

#### `chat-flow.test.tsx` — 核心对话流程
- 渲染 ChatPage，模拟用户输入并发送
- Mock agent-bridge 的 callOpenAI 返回流式响应
- 验证消息出现在对话区域
- 验证 loading 状态显示/隐藏
- 验证 markdown 渲染正确

#### `conversation-management.test.tsx` — 对话管理
- 创建新对话
- 切换对话
- 重命名对话
- 删除对话
- 空对话防重复（17b0fd0 修复的逻辑）

#### `settings-flow.test.tsx` — 设置流程
- 渲染 SettingsPage
- 配置 API key / endpoint / model
- 切换 provider
- 验证 compatible provider 不显示 tools 相关选项

#### `monitor-page.test.tsx` — Agent Monitor
- 渲染 MonitorPage
- 验证 Worker 状态卡片显示
- 验证任务列表渲染

#### `memory-integration.test.tsx` — 记忆系统集成
- Mock MemoryManager
- 发送消息后验证 processConversationTurn 被调用
- 新对话验证 getSnapshot 被调用并注入 context

### 3. 测试基础设施

#### `apps/desktop/src/__tests__/setup.ts`
- Mock Tauri API（`@tauri-apps/api/*`）
- Mock localStorage / IndexedDB
- 提供 renderWithProviders 工具函数（MantineProvider + 路由）

#### `apps/desktop/src/__tests__/mocks/agent-bridge.ts`
- Mock callOpenAI：返回可控的流式/非流式响应
- Mock TOOL_DEFINITIONS

### 4. 更新 `apps/desktop/vitest.config.ts`
- 添加 jsdom 环境
- 配置 setup file
- 配置 coverage（可选）

### 5. 更新 `package.json` scripts
- `test:e2e` — 只跑 E2E 测试
- `test:all` — 单元 + E2E

## 怎么验
- `pnpm run test` 全绿（包含新 E2E 测试）
- `pnpm run build` 通过
- 每个测试文件至少 3 个用例

## 不做什么
- 不搞真 Tauri 窗口级别的 E2E（成本太高，收益有限）
- 不测 Rust 后端（已有 cargo test）
- 不追求 100% coverage

## 影响
- 新文件 ~7 个（5 测试 + 1 setup + 1 mock）
- 预估 ~25-30 个测试用例
- 需要安装：@testing-library/react, @testing-library/jest-dom, jsdom
