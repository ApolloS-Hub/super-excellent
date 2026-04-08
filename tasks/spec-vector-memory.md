# Spec: Vector Memory 集成到 Desktop App

## 目标
将 `packages/agent-core` 中已有的 `MemoryManager`（三层记忆）接入 `apps/desktop`，替换当前 `memory.ts` 中 localStorage 实现的长期记忆。

## 当前状态
- `packages/agent-core/src/memory/` 有完整的三层记忆：ShortTermMemory、MidTermMemory、LongTermMemory（本地 vector search，192维 hash embedding + cosine similarity）
- `apps/desktop/src/lib/memory.ts` 有独立的三层实现，但长期记忆只用 localStorage + keyword search
- 两者没有连接

## 改什么

### 1. 创建 `apps/desktop/src/lib/memory-bridge.ts`
- 初始化 `MemoryManager`（from agent-core），storageDir 用 Tauri 的 app data dir（`@tauri-apps/api/path` → `appDataDir()`）
- 如果 Tauri API 不可用（dev/test 环境），fallback 到 `/tmp/super-excellent-memory`
- 导出单例 `getMemoryManager(): Promise<MemoryManager>`

### 2. 修改 `apps/desktop/src/lib/agent-bridge.ts`
- 在 `callOpenAI` / `_callOpenAINonStream` 发送请求前：
  - 调用 `memoryManager.getSnapshot(userMessage)` 获取相关记忆上下文
  - 将 context 注入到 system prompt 末尾
- 在收到完整 assistant 回复后：
  - 调用 `memoryManager.processConversationTurn(userMessage, assistantResponse)` 存储对话

### 3. 修改 `apps/desktop/src/pages/ChatPage.tsx`
- 在发送消息处，把 memory context 注入链路接上（如果 agent-bridge 内部处理了就不需要改 ChatPage）

### 4. 保留 `memory.ts` 的 autoLearn 和 midTerm (IndexedDB)
- `memory.ts` 现有的 `autoLearn`、`saveMidTerm` 等不删除，因为它们处理浏览器端 IndexedDB
- 新的 `memory-bridge.ts` 负责 Node.js 端（Tauri sidecar）的 vector 记忆
- 两者互补：IndexedDB 存偏好/模式，vector 存对话历史

### 5. 添加测试 `apps/desktop/src/lib/memory-bridge.test.ts`
- 测试 MemoryManager 初始化
- 测试 store + retrieve 往返
- 测试 snapshot 注入格式

## 怎么验
- `pnpm run test` 全绿
- `pnpm run build` 通过
- 在 ChatPage 发送消息后，检查 app data dir 下生成了 `long-term.json`
- 新对话中输入之前聊过的关键词，system prompt 应包含相关历史

## 不做什么
- 不接外部 embedding API（保持纯本地）
- 不改 agent-core 的代码
- 不删 memory.ts（保持向后兼容）

## 影响
- agent-bridge.ts：新增 ~20 行（import + snapshot 注入 + turn 存储）
- 新文件：memory-bridge.ts (~50 行) + memory-bridge.test.ts (~40 行)
