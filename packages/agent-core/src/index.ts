/**
 * @super-excellent/agent-core
 * 
 * AI Agent 内核 — 融合 claude-code-haha + open-agent-sdk 设计
 */

// Agent
export { createAgent } from "./engine/agent.js";
export { QueryEngine } from "./engine/query-engine.js";
export type { AgentOptions, AgentInstance, QueryResult, StreamEvent, Message, ToolCall, ToolResult } from "./engine/types.js";

// Providers
export { createProvider, AnthropicProvider, OpenAIProvider } from "./providers/index.js";
export type { Provider, ProviderConfig } from "./providers/types.js";

// Tools
export { createToolExecutor, BUILTIN_TOOLS, setUserInputCallback } from "./tools/index.js";
export type { ToolDefinitionFull, ToolExecutor, PermissionMode } from "./tools/types.js";

// Orchestrator (Secretary-Worker)
export { SecretaryAgent, WORKER_ROLES, getWorkerById, getWorkersByExpertise } from "./orchestrator/index.js";
export type { WorkerRole, SubTask, OrchestrationPlan, SecretaryConfig, WorkerResult } from "./orchestrator/types.js";

// Memory (Three-layer)
export { MemoryManager, ShortTermMemory, MidTermMemory, LongTermMemory, MEMORY_SLOTS } from "./memory/index.js";
export type { MemoryConfig, MemorySnapshot, MemoryEntry, MemoryLayer } from "./memory/types.js";

// Cache (Prompt optimization)
export { PromptCacheManager } from "./cache/index.js";
export type { CacheConfig } from "./cache/prompt-cache.js";

// MCP
export { McpClient, McpManager } from "./mcp/index.js";
export type { McpServerConfig } from "./mcp/client.js";
