/**
 * Agent Bridge — connects the React frontend to agent-core
 * 
 * Routing strategy:
 * - Tauri available → Rust backend (agent_chat / agent_execute_tool)
 * - Dev mode (no Tauri) → Direct fetch from browser (fallback)
 * 
 * Phase 2: All API calls now route through Rust when running as Tauri app.
 */
import { isTauriAvailable, validateApiKeyRust } from "./tauri-bridge";
import { analyzeIntent, dispatchToWorker, orchestrateMultiStep } from "./coordinator";
import { emitAgentEvent as emitBusEvent } from "./event-bus";
import { watchdogWrap, getWatchdogState, markRecovered } from "./watchdog";
import { recordUsage as recordRuntimeUsage } from "./runtime";
import {
  buildCacheKey,
  getCached,
  setCache,
  buildAnthropicSystemWithCache,
  type AnthropicCacheBlock,
} from "./prompt-cache";
import { fetchWithRetry } from "./api-retry";

export interface AgentConfig {
  provider: "anthropic" | "openai" | "google" | "kimi" | "compatible";
  apiKey: string;
  baseURL?: string;
  model: string;
  proxyURL?: string;
  workDir?: string;
  enableTools?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  toolCalls?: Array<{ name: string; input: string; output?: string; status?: "running" | "success" | "error" }>;
  isStreaming?: boolean;
}

export interface AgentEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "result" | "error";
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  isError?: boolean;
}

type EventCallback = (event: AgentEvent) => void;

// ═══════════ LoopState — Agent Loop 的显式状态机 ═══════════

export type TransitionReason =
  | 'continue'       // 初始 / 继续循环
  | 'tool_executed'  // 工具已执行，需决定下一步
  | 'done'           // 正常结束
  | 'api_error'      // API 调用失败
  | 'error'          // 其他错误
  | 'aborted';       // 用户取消

export interface LoopState {
  messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] }>;
  turnCount: number;
  maxTurns: number;
  toolCallCount: number;
  lastToolOutput: string;
  transitionReason: TransitionReason;
}

function createLoopState(
  messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] }>,
  maxTurns: number,
): LoopState {
  return {
    messages,
    turnCount: 0,
    maxTurns,
    toolCallCount: 0,
    lastToolOutput: '',
    transitionReason: 'continue',
  };
}

/** 循环是否应该继续 */
function shouldContinueLoop(state: LoopState): boolean {
  return (
    state.transitionReason === 'continue' ||
    state.transitionReason === 'tool_executed'
  ) && state.turnCount < state.maxTurns;
}

/** 基础 system prompt — AI 自主执行引擎 */
const BASE_SYSTEM_PROMPT = `你是一个自主执行任务的 AI Agent。

重要规则：
1. 收到任务后直接执行，不要只描述步骤
2. 用 JSON 代码块调用工具：
\`\`\`json
{"tool": "bash", "args": {"command": "mkdir -p /tmp/test"}}
\`\`\`
\`\`\`json
{"tool": "file_write", "args": {"path": "/tmp/test/index.html", "content": "HTML内容（换行用\\n）"}}
\`\`\`
3. 每次回复只调用一个工具
4. 工具执行后根据结果继续下一步
5. 全部完成后告诉用户结果`;

/** 模型上下文窗口限制（tokens） */
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
  "moonshot-v1-8k": 8000,
  "moonshot-v1-32k": 32000,
  "moonshot-v1-128k": 128000,
  "qwen-turbo": 131072,
  "qwen-plus": 131072,
};

/** auto-compact 触发阈值：80% 模型上限 */
const COMPACT_THRESHOLD_RATIO = 0.8;

/** 获取模型 token 上限 */
function getModelTokenLimit(model: string): number {
  const key = Object.keys(MODEL_TOKEN_LIMITS).find(
    (k) => model.toLowerCase().includes(k.toLowerCase()),
  );
  return key ? MODEL_TOKEN_LIMITS[key] : 128000;
}

/**
 * Token 使用跟踪器 — 对齐 Claude Code 的 AutoCompactTrackingState
 */
interface TokenUsageState {
  totalInputTokens: number;
  totalOutputTokens: number;
  lastPromptTokens: number;
  lastCompletionTokens: number;
  compactCount: number;
}

function createTokenUsageState(): TokenUsageState {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
    compactCount: 0,
  };
}

function updateTokenUsage(
  state: TokenUsageState,
  usage: { prompt_tokens?: number; completion_tokens?: number },
): void {
  state.lastPromptTokens = usage.prompt_tokens ?? 0;
  state.lastCompletionTokens = usage.completion_tokens ?? 0;
  state.totalInputTokens += state.lastPromptTokens;
  state.totalOutputTokens += state.lastCompletionTokens;
}

/** 判断是否需要 auto-compact — prompt tokens > 80% 模型上限时触发 */
function shouldAutoCompact(state: TokenUsageState, model: string): boolean {
  const limit = getModelTokenLimit(model);
  return state.lastPromptTokens > limit * COMPACT_THRESHOLD_RATIO;
}

/** 执行 auto-compact — 保留 system + 最近 N 条 + 工具结果摘要 */
function autoCompactMessages(
  messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] }>,
  tokenState: TokenUsageState,
): void {
  if (messages.length <= 4) return;

  const sys = messages[0];
  const recentCount = Math.min(8, Math.floor(messages.length * 0.3));
  const recent = messages.slice(-recentCount);
  const removed = messages.length - 1 - recentCount;

  const compactedSlice = messages.slice(1, messages.length - recentCount);
  const toolSummaries: string[] = [];
  for (const m of compactedSlice) {
    if (m.role === "assistant" && m.tool_calls && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const fn = (tc as { function?: { name?: string } }).function;
        if (fn?.name) toolSummaries.push(fn.name);
      }
    }
  }

  const summaryLine = toolSummaries.length > 0
    ? `（涉及工具：${[...new Set(toolSummaries)].join(", ")}）`
    : "";

  tokenState.compactCount++;
  messages.length = 0;
  messages.push(
    sys,
    {
      role: "user",
      content: `[系统: 已压缩 ${removed} 条消息，保留关键上下文]${summaryLine}`,
    },
    ...recent,
  );
}

function getUserMemory(): string {
  try {
    const mem = localStorage.getItem("user-memory");
    return mem || "";
  } catch { return ""; }
}

export function saveUserMemory(text: string): void {
  const current = getUserMemory();
  const updated = current ? `${current}\n- ${text}` : `- ${text}`;
  localStorage.setItem("user-memory", updated);
  void import("./memory").then(({ saveMidTerm }) =>
    saveMidTerm({ category: "preference", content: text }),
  );
}

export function getUserMemoryText(): string {
  return getUserMemory();
}

let _cachedMidTermPrompt = "";
let _midTermCacheTime = 0;
const MID_TERM_CACHE_TTL = 60_000;

/**
 * Refresh mid-term memory cache. Call periodically or before building prompts.
 */
export async function refreshMidTermCache(): Promise<void> {
  if (Date.now() - _midTermCacheTime < MID_TERM_CACHE_TTL && _cachedMidTermPrompt) return;
  try {
    const { buildMidTermSummary } = await import("./memory");
    _cachedMidTermPrompt = await buildMidTermSummary();
    _midTermCacheTime = Date.now();
  } catch {
    _cachedMidTermPrompt = "";
  }
}

// ═══════════ PromptParts — System Prompt Pipeline ═══════════

/**
 * 对齐 ref-s10 System Prompt Pipeline：
 * 系统 prompt 是由独立 section 组装的管道，不是一个大字符串。
 */
export interface PromptParts {
  identity: string;
  tools: string;
  context: string;
  constraints: string;
  memory: string;
}

/** 构建 identity 部分 */
function buildIdentityPart(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  return BASE_SYSTEM_PROMPT + `\n\n今天的日期是 ${dateStr}。当用户要求搜索新闻或最新信息时，不要在搜索词里加年份数字，直接搜索主题关键词即可。`;
}

/** 构建 tools 部分 — 从 tool-registry 动态获取 */
async function buildToolsPart(): Promise<string> {
  try {
    const { getAllTools } = await import("./tool-registry");
    const toolNames = getAllTools().map(t => t.name);
    return `可用工具：${toolNames.join(", ")}`;
  } catch {
    return `可用工具：bash, file_write, file_read, file_edit, list_dir, web_search, web_fetch, grep, glob, browser_open, todo_write, memory_write, memory_read, diff_view, undo, project_detect`;
  }
}

/** 构建 context 部分 — 工作目录 + 项目信息 */
async function buildContextPart(): Promise<string> {
  const config = loadConfig();
  const sections: string[] = [];

  if (config.workDir) {
    sections.push(`当前工作目录: ${config.workDir}\n所有文件操作和 bash 命令默认在此目录下执行。创建新项目时请在此目录下创建子目录。`);
  }

  if (config.workDir) {
    try {
      const { executeTool } = await import("./tools");
      const pkgResult = await executeTool("file_read", { path: `${config.workDir}/package.json` }).catch(() => "");
      if (pkgResult) {
        try {
          const pkg = JSON.parse(pkgResult) as { name?: string; description?: string; scripts?: Record<string, string> };
          const parts: string[] = [];
          if (pkg.name) parts.push(`项目: ${pkg.name}`);
          if (pkg.description) parts.push(`描述: ${pkg.description}`);
          if (pkg.scripts) parts.push(`可用脚本: ${Object.keys(pkg.scripts).join(", ")}`);
          if (parts.length > 0) sections.push(`## 项目上下文\n${parts.join("\n")}`);
        } catch { /* JSON 解析失败，跳过 */ }
      }
      const agentsResult = await executeTool("file_read", { path: `${config.workDir}/AGENTS.md` }).catch(() => "");
      if (agentsResult && agentsResult.length < 2000) {
        sections.push(`## 项目规范 (AGENTS.md)\n${agentsResult}`);
      } else if (agentsResult) {
        sections.push(`## 项目规范 (AGENTS.md, 摘要)\n${agentsResult.slice(0, 1500)}...`);
      }
    } catch { /* 文件读取失败，跳过 */ }
  }

  // 当前活跃任务上下文
  try {
    const todoRaw = localStorage.getItem("active-todo");
    if (todoRaw) {
      const todo = JSON.parse(todoRaw) as { title?: string; steps?: string[] };
      if (todo.title) {
        let taskSection = `## 当前任务\n标题: ${todo.title}`;
        if (todo.steps?.length) {
          taskSection += `\n步骤:\n${todo.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`;
        }
        sections.push(taskSection);
      }
    }
  } catch { /* 无活跃任务 */ }

  return sections.join("\n\n");
}

/** 构建 memory 部分 — 三层记忆摘要 + memory-store */
async function buildMemoryPart(): Promise<string> {
  const sections: string[] = [];

  const shortTerm = _getShortTermSummary();
  if (shortTerm) {
    sections.push(`## 当前会话上下文（短期记忆）\n${shortTerm}`);
  }

  if (_cachedMidTermPrompt) {
    sections.push(`## 用户偏好与习惯（中期记忆）\n${_cachedMidTermPrompt}`);
  }

  const longTerm = _getLongTermMemory();
  if (longTerm) {
    sections.push(`## 长期记忆\n${longTerm}`);
  }

  // Inject persistent memory-store entries
  try {
    const { memoryStore } = await import("./memory-store");
    const storeSection = await memoryStore.buildPromptSection();
    if (storeSection) {
      sections.push(`## 跨会话记忆\n${storeSection}`);
    }
  } catch { /* memory-store not available */ }

  return sections.join("\n\n");
}

/**
 * 组装 PromptParts 为完整 system prompt
 *
 * 组装顺序（对齐 ref-s10）：
 *   identity → tools → context → constraints → memory
 *
 * 根据角色注入不同的 parts：
 * - Worker: 使用 Worker 自己的 systemPrompt 作为 identity
 * - 主秘书: 使用完整管道
 * - compatible provider: 不包含 tools 部分
 */
async function buildSystemPrompt(options?: {
  isWorker?: boolean;
  workerSystemPrompt?: string;
  skipTools?: boolean;
  userMessage?: string;
}): Promise<string> {
  const parts: PromptParts = {
    identity: options?.isWorker && options.workerSystemPrompt
      ? options.workerSystemPrompt
      : buildIdentityPart(),
    tools: (options?.skipTools) ? "" : await buildToolsPart(),
    context: await buildContextPart(),
    constraints: "",
    memory: await buildMemoryPart(),
  };

  // Inject matched skills based on user message
  let skillSection = "";
  if (options?.userMessage) {
    try {
      const { buildSkillPrompt } = await import("./skills");
      skillSection = buildSkillPrompt(options.userMessage);
    } catch { /* skills not available */ }
  }

  // 组装：过滤空 section
  const sections = [
    parts.identity,
    parts.tools,
    parts.context,
    parts.constraints,
    parts.memory,
    skillSection,
  ].filter(Boolean);

  return sections.join("\n\n");
}

function _getShortTermSummary(): string {
  try {
    const { buildShortTermSummary } = _memoryModule ?? {};
    return buildShortTermSummary ? buildShortTermSummary() : "";
  } catch { return ""; }
}

function _getLongTermMemory(): string {
  try {
    const { loadMemory } = _memoryModule ?? {};
    return loadMemory ? loadMemory() : getUserMemory();
  } catch { return getUserMemory(); }
}

let _memoryModule: typeof import("./memory") | null = null;

void import("./memory").then((m) => { _memoryModule = m; }).catch(() => {});

/**
 * Send a message to the agent and receive streaming events
 */
export async function sendMessage(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
  history?: Array<{ role: string; content: string }>,
): Promise<void> {
  // For MVP: direct API call from frontend
  // In production: this will go through Tauri command → Rust → Node sidecar
  
  if (!config.apiKey) {
    onEvent({ type: "error", text: "请先在设置中配置 API Key" });
    return;
  }

  try {
    // 接入 Runtime 系统
    recordRuntimeUsage({
      timestamp: new Date().toISOString(),
      sessionId: "main",
      agentId: "secretary",
      model: config.model || "unknown",
      provider: config.provider || "compatible",
      tokensIn: Math.ceil(message.length / 4),
      tokensOut: 0,
      cost: 0,
    });

    // 兼容 provider（自定义端点）跳过 worker 编排，直接走 LLM 对话
    // 因为轻量/兼容模型通常不支持 function calling 和复杂 system prompt
    const skipWorkerDispatch = config.enableTools === false;

    // Emit user_message event for event log
    emitBusEvent({ type: "user_message", text: message });

    // 秘书意图分析 — 决定消息路由策略
    const intent = skipWorkerDispatch ? { type: "chat" as const, workers: [] as string[], plan: "直连对话" } : analyzeIntent(message);

    // Emit intent_analysis event for event log
    emitBusEvent({ type: "intent_analysis", intentType: intent.type, workers: intent.workers, plan: intent.plan });

    const watchdogState = getWatchdogState();
    if (watchdogState.isDegraded) {
      onEvent({ type: "thinking", text: `⚠️ 降级模式：${watchdogState.currentProvider}/${watchdogState.currentModel}\n` });
    }

    if (intent.type === "task" && intent.workers.length === 1) {
      // 单步任务 — 派发给对应 Worker
      onEvent({ type: "thinking", text: `🎯 秘书识别为任务型消息，派发给 ${intent.workers[0]}\n` });
      await watchdogWrap(
        async (provider, model) => {
          const effectiveConfig = { ...config, provider: provider as AgentConfig["provider"], model };
          await dispatchToWorker(intent.workers[0], message, effectiveConfig, onEvent, history);
        },
        {
          provider: config.provider,
          model: config.model,
          onDegraded: (info) => {
            onEvent({ type: "thinking", text: `🔄 自动降级：${info.fromProvider}/${info.fromModel} → ${info.toProvider}/${info.toModel}\n` });
          },
          onRecoveryAttempt: (p, m) => {
            onEvent({ type: "thinking", text: `🔁 尝试恢复：${p}/${m}\n` });
            markRecovered();
          },
        },
      );
    } else if (intent.type === "multi_step") {
      // 多步骤任务 — 编排多个 Worker 协作
      onEvent({ type: "thinking", text: `📋 秘书识别为多步骤任务: ${intent.plan}\n` });
      await watchdogWrap(
        async (provider, model) => {
          const effectiveConfig = { ...config, provider: provider as AgentConfig["provider"], model };
          await orchestrateMultiStep(message, intent.workers, effectiveConfig, onEvent, history);
        },
        {
          provider: config.provider,
          model: config.model,
          onDegraded: (info) => {
            onEvent({ type: "thinking", text: `🔄 自动降级：${info.fromProvider}/${info.fromModel} → ${info.toProvider}/${info.toModel}\n` });
          },
          onRecoveryAttempt: (p, m) => {
            onEvent({ type: "thinking", text: `🔁 尝试恢复：${p}/${m}\n` });
            markRecovered();
          },
        },
      );
    } else {
      // 闲聊或兜底 — 直接走 LLM（不经过 Worker）
      await watchdogWrap(
        async (provider, model) => {
          const effectiveConfig = { ...config, provider: provider as AgentConfig["provider"], model };
          if (effectiveConfig.provider === "anthropic") {
            await callAnthropic(message, effectiveConfig, onEvent, history);
          } else if (effectiveConfig.provider === "google") {
            await callGemini(message, effectiveConfig, onEvent, history);
          } else {
            const finalConfig = effectiveConfig.provider === "kimi"
              ? { ...effectiveConfig, baseURL: effectiveConfig.baseURL || "https://api.moonshot.cn/v1" }
              : effectiveConfig;
            await callOpenAI(message, finalConfig, onEvent, history);
          }
        },
        {
          provider: config.provider,
          model: config.model,
          onDegraded: (info) => {
            onEvent({ type: "thinking", text: `🔄 自动降级：${info.fromProvider}/${info.fromModel} → ${info.toProvider}/${info.toModel}\n` });
          },
          onRecoveryAttempt: (p, m) => {
            onEvent({ type: "thinking", text: `🔁 尝试恢复：${p}/${m}\n` });
            markRecovered();
          },
        },
      );
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    let friendlyMsg = errMsg;

    if (errMsg.includes("fetch") || errMsg.includes("network") || errMsg.includes("Failed to fetch") || errMsg.includes("ERR_")) {
      friendlyMsg = "🌐 网络连接失败，请检查网络或代理设置";
    } else if (errMsg.includes("429") || errMsg.includes("rate limit") || errMsg.includes("Too Many")) {
      friendlyMsg = "⏳ 请求太频繁，请稍后再试（API 限流）";
    } else if (errMsg.includes("401") || errMsg.includes("Unauthorized") || errMsg.includes("auth")) {
      friendlyMsg = "🔑 API Key 无效或已过期，请到设置页重新配置";
    } else if (errMsg.includes("403") || errMsg.includes("Forbidden")) {
      friendlyMsg = "🚫 API Key 权限不足（403）";
    } else if (errMsg.includes("timeout") || errMsg.includes("Timeout") || errMsg.includes("abort")) {
      friendlyMsg = "⏰ 请求超时，服务器响应太慢，请稍后重试";
    } else if (errMsg.includes("500") || errMsg.includes("502") || errMsg.includes("503")) {
      friendlyMsg = "🔧 服务器暂时不可用，请稍后重试";
    }

    onEvent({ type: "error", text: friendlyMsg });
  }
}

/**
 * Route through Rust backend (Tauri IPC)
 * Non-streaming for now — Rust handles the full API call
 */

async function callAnthropic(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
  history?: Array<{ role: string; content: string }>,
): Promise<void> {
  const rawBaseURL = config.baseURL || "https://api.anthropic.com";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
  const { getAllToolDefinitions, executeTool } = await import("./tools");
  const TOOL_DEFINITIONS = getAllToolDefinitions();

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const systemPrompt = await buildSystemPrompt({ userMessage: message });
  const systemBlocks = buildAnthropicSystemWithCache(systemPrompt);

  // Anthropic Messages API tool 格式：从 OpenAI 格式转换（registry 完整列表）
  const anthropicTools = TOOL_DEFINITIONS.map((td: { function: { name: string; description: string; parameters: unknown } }) => ({
    name: td.function.name,
    description: td.function.description,
    input_schema: td.function.parameters as Record<string, unknown>,
  }));

  const messages: Array<{ role: string; content: string | AnthropicCacheBlock[] }> = [
    ...(history || []).map(m => ({ role: m.role as string, content: m.content })),
    { role: "user", content: message },
  ];

  const MAX_ITERATIONS = 20;
  let iteration = 0;
  let totalToolCalls = 0;

  while (iteration < MAX_ITERATIONS) {
    if (signal.aborted) { onEvent({ type: "result", text: "⏹ 已停止" }); return; }
    iteration++;

    if (iteration > 1) onEvent({ type: "thinking", text: `\n🔄 Anthropic 第 ${iteration}/${MAX_ITERATIONS} 轮\n` });

    // 非流式工具调用轮可以用缓存
    const cacheKey = buildCacheKey(systemPrompt, messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })));
    const cached = getCached<{ content: AnthropicContentBlock[]; usage?: Record<string, number> }>(cacheKey);
    if (cached) {
      onEvent({ type: "thinking", text: "📦 命中缓存\n" });
      const hasToolUse = cached.content.some(b => b.type === "tool_use");
      if (hasToolUse) {
        await processAnthropicToolBlocks(cached.content, messages, executeTool, onEvent, signal);
        totalToolCalls += cached.content.filter(b => b.type === "tool_use").length;
        continue;
      }
      const textContent = cached.content
        .filter((b): b is AnthropicTextBlock => b.type === "text")
        .map(b => b.text)
        .join("");
      if (textContent) onEvent({ type: "text", text: textContent });
      onEvent({ type: "result", text: textContent });
      currentAbortController = null;
      return;
    }

    const body: Record<string, unknown> = {
      model: config.model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemBlocks,
      messages,
      tools: anthropicTools,
      stream: false,
    };

    const response = await fetchWithRetry(`${baseURL}/v1/messages`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      content: AnthropicContentBlock[];
      stop_reason: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (data.usage) {
      const { recordUsage } = await import("./cost-tracker");
      const record = recordUsage(config.model || "unknown", config.model || "unknown", {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
      });
      if (record) onEvent({ type: "thinking", text: `💰 ${record.inputTokens}+${record.outputTokens} tokens ≈ $${record.estimatedCost.toFixed(4)}\n` });
    }

    const content = data.content;
    const hasToolUse = content.some(b => b.type === "tool_use");

    // 缓存工具调用轮的响应
    if (hasToolUse) {
      setCache(cacheKey, { content, usage: data.usage });
    }

    // thinking blocks
    for (const block of content) {
      if (block.type === "thinking" && "thinking" in block) {
        onEvent({ type: "thinking", text: (block as AnthropicThinkingBlock).thinking });
      }
    }

    if (hasToolUse) {
      await processAnthropicToolBlocks(content, messages, executeTool, onEvent, signal);
      totalToolCalls += content.filter(b => b.type === "tool_use").length;

      if (data.stop_reason === "tool_use") continue;
    }

    // 文本输出
    const textContent = content
      .filter((b): b is AnthropicTextBlock => b.type === "text")
      .map(b => b.text)
      .join("");

    if (textContent) {
      for (let i = 0; i < textContent.length; i += 6) {
        if (signal.aborted) break;
        onEvent({ type: "text", text: textContent.slice(i, i + 6) });
        await new Promise(r => setTimeout(r, 8));
      }
    }

    if (totalToolCalls > 0) onEvent({ type: "text", text: `\n\n---\n📊 ${totalToolCalls} 次工具调用，${iteration} 轮` });
    onEvent({ type: "result", text: textContent });
    currentAbortController = null;
    return;
  }

  onEvent({ type: "error", text: `⚠️ Anthropic 达到 ${MAX_ITERATIONS} 轮上限` });
  currentAbortController = null;
}

// Anthropic content block 类型
interface AnthropicTextBlock { type: "text"; text: string }
interface AnthropicToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
interface AnthropicThinkingBlock { type: "thinking"; thinking: string }
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicThinkingBlock | { type: string };

async function processAnthropicToolBlocks(
  content: AnthropicContentBlock[],
  messages: Array<{ role: string; content: string | AnthropicCacheBlock[] | AnthropicContentBlock[] }>,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  onEvent: EventCallback,
  signal: AbortSignal,
): Promise<void> {
  // 先输出文本部分
  for (const block of content) {
    if (block.type === "text") {
      onEvent({ type: "text", text: (block as AnthropicTextBlock).text });
      onEvent({ type: "text", text: "\n\n" });
    }
  }

  messages.push({ role: "assistant", content: content as AnthropicContentBlock[] });

  const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

  for (const block of content) {
    if (block.type !== "tool_use") continue;
    if (signal.aborted) break;

    const toolBlock = block as AnthropicToolUseBlock;
    onEvent({ type: "tool_use", toolName: toolBlock.name, toolInput: JSON.stringify(toolBlock.input) });

    try {
      const result = await executeTool(toolBlock.name, toolBlock.input);
      onEvent({ type: "thinking", text: `✅ ${toolBlock.name}: ${result.slice(0, 120)}\n` });
      toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result.slice(0, 15000) });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      onEvent({ type: "thinking", text: `❌ ${toolBlock.name}: ${err}\n` });
      toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: `Error: ${err}` });
    }
  }

  messages.push({ role: "user", content: toolResults as unknown as AnthropicCacheBlock[] });
}

async function callGemini(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
  history?: Array<{ role: string; content: string }>,
): Promise<void> {
  const model = config.model || "gemini-2.0-flash";
  const baseURL = config.baseURL || "https://generativelanguage.googleapis.com";
  const { getAllToolDefinitions, executeTool } = await import("./tools");
  const TOOL_DEFINITIONS = getAllToolDefinitions();

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const systemPrompt = await buildSystemPrompt({ userMessage: message });

  // Gemini tool 格式（registry 完整列表）
  const geminiTools = [{
    function_declarations: TOOL_DEFINITIONS.map((td: { function: { name: string; description: string; parameters: unknown } }) => ({
      name: td.function.name,
      description: td.function.description,
      parameters: td.function.parameters,
    })),
  }];

  // messages → Gemini contents 格式
  const contents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: { result: string } } }> }> = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "好的，我准备好执行任务了。" }] },
    ...(history || []).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const MAX_ITERATIONS = 20;
  let iteration = 0;
  let totalToolCalls = 0;

  while (iteration < MAX_ITERATIONS) {
    if (signal.aborted) { onEvent({ type: "result", text: "⏹ 已停止" }); return; }
    iteration++;

    if (iteration > 1) onEvent({ type: "thinking", text: `\n🔄 Gemini 第 ${iteration}/${MAX_ITERATIONS} 轮\n` });

    const response = await fetchWithRetry(
      `${baseURL}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          tools: geminiTools,
          generationConfig: { maxOutputTokens: 4096 },
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    if (data.usageMetadata) {
      const { recordUsage } = await import("./cost-tracker");
      const record = recordUsage(config.model || "unknown", config.model || "unknown", {
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
      });
      if (record) onEvent({ type: "thinking", text: `💰 ${record.inputTokens}+${record.outputTokens} tokens ≈ $${record.estimatedCost.toFixed(4)}\n` });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    if (functionCalls.length > 0) {
      // 输出文本部分
      for (const part of textParts) {
        if (part.text) onEvent({ type: "text", text: part.text + "\n" });
      }

      // 添加模型响应
      contents.push({ role: "model", parts: parts.map(p => {
        if (p.functionCall) return { functionCall: p.functionCall };
        return { text: p.text || "" };
      }) });

      // 执行工具并收集结果
      const responseParts: Array<{ functionResponse: { name: string; response: { result: string } } }> = [];

      for (const part of functionCalls) {
        if (signal.aborted) break;
        const fc = part.functionCall!;
        totalToolCalls++;
        onEvent({ type: "tool_use", toolName: fc.name, toolInput: JSON.stringify(fc.args) });

        try {
          const result = await executeTool(fc.name, fc.args);
          onEvent({ type: "thinking", text: `✅ ${fc.name}: ${result.slice(0, 120)}\n` });
          responseParts.push({
            functionResponse: { name: fc.name, response: { result: result.slice(0, 15000) } },
          });
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          onEvent({ type: "thinking", text: `❌ ${fc.name}: ${err}\n` });
          responseParts.push({
            functionResponse: { name: fc.name, response: { result: `Error: ${err}` } },
          });
        }
      }

      contents.push({ role: "user", parts: responseParts as typeof contents[0]["parts"] });
      continue;
    }

    // 纯文本响应
    const fullText = textParts.map(p => p.text || "").join("");
    if (fullText) {
      for (let i = 0; i < fullText.length; i += 6) {
        if (signal.aborted) break;
        onEvent({ type: "text", text: fullText.slice(i, i + 6) });
        await new Promise(r => setTimeout(r, 8));
      }
    }

    if (totalToolCalls > 0) onEvent({ type: "text", text: `\n\n---\n📊 ${totalToolCalls} 次工具调用，${iteration} 轮` });
    onEvent({ type: "result", text: fullText });
    currentAbortController = null;
    return;
  }

  onEvent({ type: "error", text: `⚠️ Gemini 达到 ${MAX_ITERATIONS} 轮上限` });
  currentAbortController = null;
}

/**
 * Agentic Loop — the core engine.
 * Inspired by claw-code-parity's conversation.rs run_turn().
 * AI autonomously calls tools in a loop until the task is done.
 */
// Global abort controller for stopping generation
let currentAbortController: AbortController | null = null;
export function abortGeneration(): void {
  currentAbortController?.abort();
  currentAbortController = null;
}

/**
 * 非流式备用 — 原 callOpenAI 保留作为降级方案
 */
async function _callOpenAINonStream(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
  conversationHistory?: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>,
): Promise<void> {
  const rawBaseURL = config.baseURL || "https://api.openai.com";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
  const { getAllToolDefinitions, executeTool } = await import("./tools");
  const TOOL_DEFINITIONS = getAllToolDefinitions();

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const noTools = config.enableTools === false;

  const systemPrompt = noTools
    ? "你是一个智能助手。直接回答用户的问题，用自然语言回复。如果用户要求搜索或查找信息，请利用你自己的知识尽力回答。"
    : await buildSystemPrompt({ skipTools: config.provider === "compatible", userMessage: message });
  const messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] }> = [
    { role: "system", content: systemPrompt },
  ];
  if (conversationHistory) messages.push(...conversationHistory);
  messages.push({ role: "user", content: message });

  const tokenState = createTokenUsageState();
  const loop = createLoopState(messages, noTools ? 1 : (config.provider === "compatible" ? 2 : 20));

  // ── LoopState-driven agent loop ──
  while (shouldContinueLoop(loop)) {
    if (signal.aborted) { loop.transitionReason = 'aborted'; break; }
    loop.turnCount++;

    // Compatible provider: tool_executed → done (直接输出结果)
    if (config.provider === "compatible" && loop.transitionReason === 'tool_executed') {
      const toolMsgs = loop.messages.filter(m => m.role === "tool").map(m => m.content).filter(Boolean);
      if (toolMsgs.length > 0) {
        const summary = toolMsgs.join("\n\n---\n\n").slice(0, 5000);
        onEvent({ type: "text", text: summary });
        onEvent({ type: "result", text: summary });
        loop.transitionReason = 'done';
        break;
      }
    }

    // 智能 auto-compact：基于 token 使用量
    if (shouldAutoCompact(tokenState, config.model)) {
      onEvent({ type: "thinking", text: "⚠️ Token 接近上限，自动压缩中...\n" });
      autoCompactMessages(loop.messages, tokenState);
      onEvent({ type: "thinking", text: `📦 已压缩，当前 ${loop.messages.length} 条消息\n` });
    }

    if (loop.turnCount > 1) onEvent({ type: "thinking", text: `\n🔄 第 ${loop.turnCount}/${loop.maxTurns} 轮\n` });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    };

    const body: Record<string, unknown> = {
      model: config.model || "gpt-4o",
      max_tokens: 4096,
      messages: loop.messages,
      stream: false,
    };
    if (!noTools) {
      body.tools = TOOL_DEFINITIONS;
      body.tool_choice = "auto";
    }

    let response: Response;
    try {
      response = await fetchWithRetry(`${baseURL}/v1/chat/completions`, {
        method: "POST", headers, body: JSON.stringify(body), signal,
      });
    } catch (e) {
      if (signal.aborted) { loop.transitionReason = 'aborted'; break; }
      // Error Recovery: 不 throw，设 api_error + 展示已有结果
      const errMsg = e instanceof Error ? e.message : String(e);
      onEvent({ type: "error", text: `⚠️ API 请求失败: ${errMsg.slice(0, 200)}` });
      loop.transitionReason = 'api_error';
      break;
    }

    if (!response.ok) {
      const err = await response.text();
      // Error Recovery: 不 throw，设 api_error
      onEvent({ type: "error", text: `⚠️ API ${response.status}: ${err.slice(0, 200)}` });
      loop.transitionReason = 'api_error';
      break;
    }

    const data = await response.json();

    if (data.usage) {
      updateTokenUsage(tokenState, data.usage);
      const { recordUsage } = await import("./cost-tracker");
      const record = recordUsage(config.model || "unknown", config.model || "unknown", data.usage);
      if (record) onEvent({ type: "thinking", text: `💰 ${record.inputTokens}+${record.outputTokens} tokens ≈ $${record.estimatedCost.toFixed(4)}\n` });
    }

    const choice = data.choices?.[0];
    if (!choice) {
      onEvent({ type: "error", text: "⚠️ API 无响应" });
      loop.transitionReason = 'api_error';
      break;
    }
    const msg = choice.message;

    // ── 处理 tool_calls ──
    if (msg.tool_calls?.length > 0) {
      if (msg.content) {
        onEvent({ type: "text", text: msg.content });
        onEvent({ type: "text", text: "\n\n" });
      }
      loop.messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      const toolResults: string[] = [];
      for (const tc of msg.tool_calls) {
        if (signal.aborted) break;
        const fn = tc.function;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(fn.arguments || "{}"); } catch { /* 忽略 */ }
        loop.toolCallCount++;
        onEvent({ type: "tool_use", toolName: fn.name, toolInput: fn.arguments });
        try {
          const result = await executeTool(fn.name, args);
          onEvent({ type: "thinking", text: `✅ ${fn.name}: ${result.slice(0, 120)}\n` });
          loop.messages.push({ role: "tool", content: result.slice(0, 15000), tool_call_id: tc.id });
          toolResults.push(`**${fn.name}** 执行完成：\n\n${result.slice(0, 3000)}`);
          loop.lastToolOutput = result.slice(0, 5000);
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          onEvent({ type: "thinking", text: `❌ ${fn.name}: ${err}\n` });
          loop.messages.push({ role: "tool", content: `Error: ${err}`, tool_call_id: tc.id });
          toolResults.push(`**${fn.name}** 执行失败：${err}`);
        }
      }

      // 设置 transitionReason = 'tool_executed'
      loop.transitionReason = 'tool_executed';

      // Compatible provider → done after tool execution
      if (config.provider === "compatible") {
        const summary = toolResults.join("\n\n");
        onEvent({ type: "text", text: summary });
        onEvent({ type: "result", text: summary });
        loop.transitionReason = 'done';
        break;
      }
      // 非 compatible: tool_executed 继续循环让模型总结
      continue;
    }

    // ── 纯文本回复处理 ──
    const text = msg.content || "";
    const parsed = noTools ? null : parseTextToolCall(text);
    if (parsed) {
      loop.toolCallCount++;
      onEvent({ type: "tool_use", toolName: parsed.name, toolInput: JSON.stringify(parsed.args) });
      try {
        const result = await executeTool(parsed.name, parsed.args);
        onEvent({ type: "thinking", text: `✅ ${parsed.name}: ${result.slice(0, 120)}\n` });
        loop.messages.push({ role: "assistant", content: text });
        loop.messages.push({ role: "user", content: `工具结果:\n${result.slice(0, 15000)}\n\n继续执行。完成则总结。` });
      } catch (e) {
        loop.messages.push({ role: "assistant", content: text });
        loop.messages.push({ role: "user", content: `工具失败: ${e instanceof Error ? e.message : String(e)}。换个方式继续。` });
      }
      loop.transitionReason = 'tool_executed';
      continue;
    }

    const autoSave = detectAutoSaveContent(text, message);
    if (autoSave) {
      loop.toolCallCount++;
      onEvent({ type: "tool_use", toolName: "file_write", toolInput: autoSave.path });
      try {
        await executeTool("file_write", { path: autoSave.path, content: autoSave.content });
        onEvent({ type: "thinking", text: `✅ 自动保存: ${autoSave.path}\n` });
        loop.messages.push({ role: "assistant", content: text });
        loop.messages.push({ role: "user", content: `文件已保存到 ${autoSave.path}。告诉用户怎么打开。` });
        loop.transitionReason = 'tool_executed';
        continue;
      } catch { /* 忽略 */ }
    }

    const planning = /让我创建|我应该|接下来|我将|让我|我来|我需要|下一步|首先.*然后|步骤/;
    if (text && planning.test(text) && !text.includes("已完成") && !text.includes("已创建") && loop.turnCount < loop.maxTurns - 1) {
      onEvent({ type: "thinking", text: "🔄 推动执行...\n" });
      loop.messages.push({ role: "assistant", content: text });
      loop.messages.push({ role: "user", content: "不要计划，立刻执行！用 ```json {\"tool\": \"...\", \"args\": {...}} ``` 调用工具。" });
      loop.transitionReason = 'continue';
      continue;
    }

    // 最终文本输出
    if (text) {
      for (let i = 0; i < text.length; i += 6) {
        if (signal.aborted) break;
        onEvent({ type: "text", text: text.slice(i, i + 6) });
        await new Promise((r) => setTimeout(r, 8));
      }
    }
    if (msg.reasoning_content) onEvent({ type: "thinking", text: msg.reasoning_content });
    if (loop.toolCallCount > 0) onEvent({ type: "text", text: `\n\n---\n📊 ${loop.toolCallCount} 次工具调用，${loop.turnCount} 轮` });
    onEvent({ type: "result", text });
    loop.transitionReason = 'done';
    break;
  }

  // ── 循环结束后处理 ──
  if (loop.transitionReason === 'aborted') {
    onEvent({ type: "result", text: "⏹ 已停止" });
    currentAbortController = null;
    return;
  }

  if (loop.transitionReason === 'done') {
    currentAbortController = null;
    return;
  }

  // api_error / tool_executed exhausted: 展示已有工具结果
  if (loop.lastToolOutput || loop.toolCallCount > 0) {
    const toolMsgs = loop.messages.filter(m => m.role === "tool").map(m => m.content).filter(Boolean);
    if (toolMsgs.length > 0) {
      const summary = (toolMsgs as string[]).join("\n\n---\n\n").slice(0, 5000);
      onEvent({ type: "text", text: summary });
      onEvent({ type: "result", text: summary });
      currentAbortController = null;
      return;
    }
  }
  onEvent({ type: "error", text: `⚠️ 达到 ${loop.maxTurns} 轮上限。${loop.toolCallCount} 次工具调用。` });
  currentAbortController = null;
}

// ═══════════════════════════════════════════════════════════════════
// SSE 流式 chunk 解析器 — 对齐 CC 的 QueryEngine 流式处理
// ═══════════════════════════════════════════════════════════════════

/** SSE 行级解析：从 ReadableStream 中逐行提取 `data: {...}` */
async function* parseSSELines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
      if (payload === "[DONE]") return;
      yield payload;
    }
  }
  // 处理残余 buffer
  if (buffer.trim().startsWith("data:")) {
    const payload = buffer.trim().startsWith("data: ") ? buffer.trim().slice(6) : buffer.trim().slice(5);
    if (payload !== "[DONE]") yield payload;
  }
}

/** 单条 tool_call 的累积状态 */
interface PendingToolCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/**
 * 真 SSE 流式 callOpenAI — 对齐 CC QueryEngine 的流式处理
 *
 * 核心改进：
 * 1. stream: true + ReadableStream 逐 chunk 解析
 * 2. 文本 delta → 立即 onEvent("text")
 * 3. tool_calls delta → 累积到 finish_reason: "tool_calls"
 * 4. 智能 auto-compact（基于 API usage 字段）
 * 5. Token warning → 自动压缩
 */
async function callOpenAI(
  message: string,
  config: AgentConfig,
  onEvent: EventCallback,
  conversationHistory?: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>,
): Promise<void> {
  const rawBaseURL = config.baseURL || "https://api.openai.com";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
  const { getAllToolDefinitions, executeTool } = await import("./tools");
  const TOOL_DEFINITIONS = getAllToolDefinitions();

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const noTools = config.enableTools === false;

  const systemPrompt = noTools
    ? "你是一个智能助手。直接回答用户的问题，用自然语言回复。如果用户要求搜索或查找信息，请利用你自己的知识尽力回答。"
    : await buildSystemPrompt({ skipTools: config.provider === "compatible", userMessage: message });
  const messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] }> = [
    { role: "system", content: systemPrompt },
  ];
  if (conversationHistory) messages.push(...conversationHistory);
  messages.push({ role: "user", content: message });

  const tokenState = createTokenUsageState();
  const loop = createLoopState(messages, noTools ? 1 : (config.provider === "compatible" ? 2 : 20));

  // ── LoopState-driven streaming agent loop ──
  while (shouldContinueLoop(loop)) {
    if (signal.aborted) { loop.transitionReason = 'aborted'; break; }
    loop.turnCount++;

    // Compatible provider: tool_executed → done
    if (config.provider === "compatible" && loop.transitionReason === 'tool_executed') {
      const toolMsgs = loop.messages.filter(m => m.role === "tool").map(m => m.content).filter(Boolean);
      if (toolMsgs.length > 0) {
        const summary = (toolMsgs as string[]).join("\n\n---\n\n").slice(0, 5000);
        onEvent({ type: "text", text: summary });
        onEvent({ type: "result", text: summary });
        loop.transitionReason = 'done';
        break;
      }
    }

    // 智能 auto-compact
    if (shouldAutoCompact(tokenState, config.model)) {
      onEvent({ type: "thinking", text: "⚠️ Token 接近上限，自动压缩中..." });
      autoCompactMessages(loop.messages, tokenState);
      onEvent({ type: "thinking", text: `📦 第 ${tokenState.compactCount} 次压缩完成，保留 ${loop.messages.length} 条消息\n` });
    }

    if (loop.turnCount > 1) onEvent({ type: "thinking", text: `\n🔄 第 ${loop.turnCount}/${loop.maxTurns} 轮\n` });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    };

    const body: Record<string, unknown> = {
      model: config.model || "gpt-4o",
      max_tokens: 4096,
      messages: loop.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (!noTools) {
      body.tools = TOOL_DEFINITIONS;
      body.tool_choice = "auto";
    }

    let response: Response;
    try {
      response = await fetchWithRetry(`${baseURL}/v1/chat/completions`, {
        method: "POST", headers, body: JSON.stringify(body), signal,
      });
    } catch (e) {
      if (signal.aborted) { loop.transitionReason = 'aborted'; break; }
      // 流式失败 → 降级到非流式
      onEvent({ type: "thinking", text: "⚠️ SSE 流式连接失败，降级为非流式\n" });
      await _callOpenAINonStream(message, config, onEvent, conversationHistory);
      return;
    }

    if (!response.ok) {
      const err = await response.text();
      // Error Recovery: 流式 API 错误 → 降级到非流式
      onEvent({ type: "thinking", text: `⚠️ 流式 API ${response.status}，降级为非流式\n` });
      try {
        await _callOpenAINonStream(message, config, onEvent, conversationHistory);
        return;
      } catch {
        // 非流式也失败 → 展示已有内容
        onEvent({ type: "error", text: `⚠️ API ${response.status}: ${err.slice(0, 200)}` });
        loop.transitionReason = 'api_error';
        break;
      }
    }

    if (!response.body) {
      // Error Recovery: 无 ReadableStream → 降级为非流式
      onEvent({ type: "thinking", text: "⚠️ 无 ReadableStream，降级为非流式\n" });
      try {
        await _callOpenAINonStream(message, config, onEvent, conversationHistory);
        return;
      } catch {
        loop.transitionReason = 'api_error';
        break;
      }
    }

    // ── 流式解析 ──
    const reader = response.body.getReader();
    let fullText = "";
    let finishReason: string | null = null;
    const pendingToolCalls = new Map<number, PendingToolCall>();
    let reasoningContent = "";

    try {
      for await (const payload of parseSSELines(reader)) {
        if (signal.aborted) break;

        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
              reasoning_content?: string;
            };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        if (chunk.usage) {
          updateTokenUsage(tokenState, chunk.usage);
          const { recordUsage } = await import("./cost-tracker");
          const record = recordUsage(
            config.model || "unknown",
            config.model || "unknown",
            chunk.usage,
          );
          if (record) {
            onEvent({ type: "thinking", text: `💰 ${record.inputTokens}+${record.outputTokens} tokens ≈ $${record.estimatedCost.toFixed(4)}\n` });
          }

          const limit = getModelTokenLimit(config.model);
          const used = tokenState.lastPromptTokens + (chunk.usage.completion_tokens ?? 0);
          if (used > limit * 0.7 && used <= limit * COMPACT_THRESHOLD_RATIO) {
            onEvent({ type: "thinking", text: `⚠️ Token 使用已达 ${Math.round((used / limit) * 100)}%，接近上限\n` });
          }
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          fullText += delta.content;
          onEvent({ type: "text", text: delta.content });
        }

        if (delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let pending = pendingToolCalls.get(tc.index);
            if (!pending) {
              pending = { index: tc.index, id: tc.id ?? "", name: "", arguments: "" };
              pendingToolCalls.set(tc.index, pending);
            }
            if (tc.id) pending.id = tc.id;
            if (tc.function?.name) pending.name = tc.function.name;
            if (tc.function?.arguments) pending.arguments += tc.function.arguments;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (signal.aborted) { loop.transitionReason = 'aborted'; break; }

    // ── 处理 tool_calls ──
    if (finishReason === "tool_calls" || pendingToolCalls.size > 0) {
      const toolCallsArray = Array.from(pendingToolCalls.values())
        .sort((a, b) => a.index - b.index)
        .map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

      if (fullText) {
        onEvent({ type: "text", text: "\n\n" });
      }

      loop.messages.push({
        role: "assistant",
        content: fullText || null,
        tool_calls: toolCallsArray,
      });

      const streamToolResults: string[] = [];
      for (const tc of toolCallsArray) {
        if (signal.aborted) break;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* 忽略 */ }
        loop.toolCallCount++;
        onEvent({ type: "tool_use", toolName: tc.function.name, toolInput: tc.function.arguments });
        try {
          const result = await executeTool(tc.function.name, args);
          onEvent({ type: "thinking", text: `✅ ${tc.function.name}: ${result.slice(0, 120)}\n` });
          loop.messages.push({ role: "tool", content: result.slice(0, 15000), tool_call_id: tc.id });
          streamToolResults.push(`**${tc.function.name}** 执行完成：\n\n${result.slice(0, 3000)}`);
          loop.lastToolOutput = result.slice(0, 5000);
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          onEvent({ type: "thinking", text: `❌ ${tc.function.name}: ${err}\n` });
          loop.messages.push({ role: "tool", content: `Error: ${err}`, tool_call_id: tc.id });
          streamToolResults.push(`**${tc.function.name}** 执行失败：${err}`);
        }
      }

      // transitionReason = 'tool_executed'
      loop.transitionReason = 'tool_executed';

      // Compatible provider → done
      if (config.provider === "compatible") {
        const summary = streamToolResults.join("\n\n");
        onEvent({ type: "text", text: summary });
        onEvent({ type: "result", text: summary });
        loop.transitionReason = 'done';
        break;
      }
      // 非 compatible: tool_executed 继续循环
      continue;
    }

    // ── 纯文本响应 ──
    const parsed = noTools ? null : parseTextToolCall(fullText);
    if (parsed) {
      loop.toolCallCount++;
      onEvent({ type: "tool_use", toolName: parsed.name, toolInput: JSON.stringify(parsed.args) });
      try {
        const result = await executeTool(parsed.name, parsed.args);
        onEvent({ type: "thinking", text: `✅ ${parsed.name}: ${result.slice(0, 120)}\n` });
        const summary = `**${parsed.name}** 执行完成：\n\n${result.slice(0, 3000)}`;
        onEvent({ type: "text", text: summary });
        onEvent({ type: "result", text: summary });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        const summary = `**${parsed.name}** 执行失败：${err}`;
        onEvent({ type: "text", text: summary });
        onEvent({ type: "result", text: summary });
      }
      loop.transitionReason = 'done';
      break;
    }

    // 自动保存检测
    const autoSave = detectAutoSaveContent(fullText, message);
    if (autoSave) {
      loop.toolCallCount++;
      onEvent({ type: "tool_use", toolName: "file_write", toolInput: autoSave.path });
      try {
        await executeTool("file_write", { path: autoSave.path, content: autoSave.content });
        onEvent({ type: "thinking", text: `✅ 自动保存: ${autoSave.path}\n` });
        loop.messages.push({ role: "assistant", content: fullText });
        loop.messages.push({ role: "user", content: `文件已保存到 ${autoSave.path}。告诉用户怎么打开。` });
        loop.transitionReason = 'tool_executed';
        continue;
      } catch { /* 忽略 */ }
    }

    // 规划推动
    const planning = /让我创建|我应该|接下来|我将|让我|我来|我需要|下一步|首先.*然后|步骤/;
    if (fullText && planning.test(fullText) && !fullText.includes("已完成") && !fullText.includes("已创建") && loop.turnCount < loop.maxTurns - 1) {
      onEvent({ type: "thinking", text: "🔄 推动执行...\n" });
      loop.messages.push({ role: "assistant", content: fullText });
      loop.messages.push({ role: "user", content: "不要计划，立刻执行！用 ```json {\"tool\": \"...\", \"args\": {...}} ``` 调用工具。" });
      loop.transitionReason = 'continue';
      continue;
    }

    // 最终输出
    if (reasoningContent) onEvent({ type: "thinking", text: reasoningContent });
    if (loop.toolCallCount > 0) onEvent({ type: "text", text: `\n\n---\n📊 ${loop.toolCallCount} 次工具调用，${loop.turnCount} 轮` });
    onEvent({ type: "result", text: fullText });
    loop.transitionReason = 'done';
    break;
  }

  // ── 循环结束后处理 ──
  if (loop.transitionReason === 'aborted') {
    onEvent({ type: "result", text: "⏹ 已停止" });
    currentAbortController = null;
    return;
  }

  if (loop.transitionReason === 'done') {
    currentAbortController = null;
    return;
  }

  // api_error / exhausted: 展示已有工具结果
  if (loop.lastToolOutput || loop.toolCallCount > 0) {
    const toolMsgs = loop.messages.filter(m => m.role === "tool").map(m => m.content).filter(Boolean);
    if (toolMsgs.length > 0) {
      const summary = (toolMsgs as string[]).join("\n\n---\n\n").slice(0, 5000);
      onEvent({ type: "text", text: summary });
      onEvent({ type: "result", text: summary });
      currentAbortController = null;
      return;
    }
    if (loop.lastToolOutput) {
      onEvent({ type: "text", text: loop.lastToolOutput });
      onEvent({ type: "result", text: loop.lastToolOutput });
      currentAbortController = null;
      return;
    }
  }
  onEvent({ type: "error", text: `⚠️ 达到 ${loop.maxTurns} 轮上限。${loop.toolCallCount} 次工具调用。` });
  currentAbortController = null;
}


/**
 * Parse tool calls from plain text output (fallback for models that don't support structured tool_calls)
 * Handles patterns like:
 *   web_search\nquery\n搜索内容
 *   我将为您搜索...\nweb_search\nquery\n内容
 */
/**
 * Auto-detect code content in AI output that should be saved as files.
 * If AI dumps a complete HTML/code file as text instead of using file_write,
 * we detect it and auto-save.
 */
function detectAutoSaveContent(text: string, userMessage?: string): { path: string; content: string } | null {
  // Try to extract path from user message context
  const pathFromUser = userMessage?.match(/(?:在|to|at|into)\s+([/~][\w/.-]+)/)?.[1];

  // Detect complete HTML documents
  const htmlMatch = text.match(/<!DOCTYPE html[\s\S]*?<\/html>/i);
  if (htmlMatch) {
    const nameHint = text.match(/(?:文件|file|保存|save|创建|create)[^\n]*?([/~][\w/.-]*\.html)/i);
    let path = nameHint?.[1] || (pathFromUser ? `${pathFromUser}/index.html` : "/tmp/output.html");
    if (!path.endsWith(".html")) path += "/index.html";
    return { path, content: htmlMatch[0] };
  }

  // Detect HTML code blocks: ```html ... ```
  const htmlBlockMatch = text.match(/```html\s*\n([\s\S]*?)```/);
  if (htmlBlockMatch && htmlBlockMatch[1].includes("<html") || htmlBlockMatch && htmlBlockMatch[1].includes("<!DOCTYPE")) {
    const path = "/tmp/output.html";
    return { path, content: htmlBlockMatch[1].trim() };
  }

  // Detect complete Python scripts
  const pyMatch = text.match(/```python\s*\n([\s\S]*?)```/);
  if (pyMatch && pyMatch[1].length > 200) {
    return { path: "/tmp/output.py", content: pyMatch[1].trim() };
  }

  // Detect complete JS/TS files
  const jsMatch = text.match(/```(?:javascript|typescript|js|ts)\s*\n([\s\S]*?)```/);
  if (jsMatch && jsMatch[1].length > 200) {
    const ext = text.includes("typescript") || text.includes("ts") ? "ts" : "js";
    return { path: `/tmp/output.${ext}`, content: jsMatch[1].trim() };
  }

  return null;
}

/**
 * Parse tool calls from AI text output.
 * Priority 1: JSON code block ```json {"tool": "name", "args": {...}} ```
 * Priority 2: Inline JSON {"tool": "name", "args": {...}}
 * Priority 3: Plain text patterns (fallback)
 */
function parseTextToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
  const validTools = ["bash", "file_write", "file_read", "file_edit", "list_dir", "web_search", "web_fetch", "browser_open", "grep", "glob"];

  // Priority 1: JSON code block
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed.tool && validTools.includes(parsed.tool) && parsed.args) {
        return { name: parsed.tool, args: parsed.args };
      }
    } catch { /* not valid JSON, continue */ }
  }

  // Priority 2: Inline JSON anywhere in text
  const jsonInlineMatch = text.match(/\{"tool"\s*:\s*"(\w+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\})\s*\}/);
  if (jsonInlineMatch) {
    const toolName = jsonInlineMatch[1];
    if (validTools.includes(toolName)) {
      try {
        const args = JSON.parse(jsonInlineMatch[2]);
        return { name: toolName, args };
      } catch { /* continue */ }
    }
  }

  // Priority 3: Simple patterns (browser_open URL, bash command, etc.)
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    // browser_open https://...
    if (lower.startsWith("browser_open")) {
      const url = line.match(/https?:\/\/\S+/);
      if (url) return { name: "browser_open", args: { url: url[0] } };
    }
    // web_search query
    if (lower.startsWith("web_search ")) {
      return { name: "web_search", args: { query: line.slice(11).trim() } };
    }
  }

  return null;
}

/** SSE stream processor — used for OpenAI-compatible streaming */
export async function processSSEStream(
  response: Response,
  onEvent: EventCallback,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);

        // Anthropic format
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          fullText += parsed.delta.text;
          onEvent({ type: "text", text: parsed.delta.text });
        }

        // OpenAI format
        if (parsed.choices?.[0]?.delta?.content) {
          fullText += parsed.choices[0].delta.content;
          onEvent({ type: "text", text: parsed.choices[0].delta.content });
        }

        // Reasoning content (Kimi K2.5 / OpenAI o-series)
        if (parsed.choices?.[0]?.delta?.reasoning_content) {
          const rc = parsed.choices[0].delta.reasoning_content;
          onEvent({ type: "thinking", text: rc });
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  onEvent({ type: "result", text: fullText });
}

/**
 * Validate API key by making a minimal test request to the provider
 * Returns { valid: true } or { valid: false, error: string }
 */
export async function validateApiKey(
  config: AgentConfig,
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (!config.apiKey) {
      return { valid: false, error: "API Key 不能为空" };
    }

    // 10s timeout for validation
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Phase 2: Try Rust validation first
      if (isTauriAvailable()) {
        try {
          const baseUrl = config.baseURL || (config.provider === "kimi" ? "https://api.moonshot.cn/v1" : null);
          return await validateApiKeyRust(config.provider, config.apiKey, baseUrl ?? "", config.model);
        } catch {
          // Fall through to browser-based validation
        }
      }

      if (config.provider === "anthropic") {
        return await validateAnthropic(config, controller.signal);
      } else if (config.provider === "google") {
        return await validateGoogle(config, controller.signal);
      } else if (config.provider === "kimi") {
        return await validateOpenAI({ ...config, baseURL: config.baseURL || "https://api.moonshot.cn/v1" }, controller.signal);
      } else {
        return await validateOpenAI(config, controller.signal);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || msg.includes("abort") || msg.includes("Abort")) {
      return { valid: false, error: "验证超时（10s），请检查网络或代理设置" };
    }
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed") || msg.includes("TIMED_OUT")) {
      return { valid: false, error: "网络连接失败，请检查网络或代理设置" };
    }
    return { valid: false, error: msg };
  }
}

async function validateAnthropic(config: AgentConfig, signal: AbortSignal): Promise<{ valid: boolean; error?: string }> {
  const baseURL = config.baseURL || "https://api.anthropic.com";
  const resp = await fetchWithRetry(`${baseURL}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model || "claude-opus-4-6",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });

  if (resp.status === 401) {
    return { valid: false, error: "API Key 无效（401 Unauthorized）" };
  }
  if (resp.status === 403) {
    return { valid: false, error: "API Key 权限不足（403 Forbidden）" };
  }
  if (resp.status === 429) {
    // Rate limited but key is valid
    return { valid: true };
  }
  if (!resp.ok && resp.status !== 200) {
    const body = await resp.text().catch(() => "");
    // If we get a model error, the key is still valid
    if (body.includes("model") || body.includes("overloaded")) {
      return { valid: true };
    }
    return { valid: false, error: `API 错误 (${resp.status}): ${body.slice(0, 200)}` };
  }
  return { valid: true };
}

async function validateOpenAI(config: AgentConfig, signal: AbortSignal): Promise<{ valid: boolean; error?: string }> {
  const rawBaseURL = config.baseURL || "https://api.openai.com";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
  const resp = await fetchWithRetry(`${baseURL}/v1/models`, {
    signal,
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
    },
  });

  if (resp.status === 401) {
    return { valid: false, error: "API Key 无效（401 Unauthorized）" };
  }
  if (resp.status === 403) {
    return { valid: false, error: "API Key 权限不足（403 Forbidden）" };
  }
  if (resp.status === 429) {
    return { valid: true };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { valid: false, error: `API 错误 (${resp.status}): ${body.slice(0, 200)}` };
  }
  return { valid: true };
}

async function validateGoogle(config: AgentConfig, signal: AbortSignal): Promise<{ valid: boolean; error?: string }> {
  const baseURL = config.baseURL || "https://generativelanguage.googleapis.com";
  const resp = await fetchWithRetry(`${baseURL}/v1beta/models?key=${config.apiKey}`, { signal });

  if (resp.status === 400 || resp.status === 403) {
    const body = await resp.text().catch(() => "");
    if (body.includes("API_KEY_INVALID") || body.includes("PERMISSION_DENIED")) {
      return { valid: false, error: "API Key 无效" };
    }
    return { valid: false, error: `API 错误 (${resp.status}): ${body.slice(0, 200)}` };
  }
  if (resp.status === 429) {
    return { valid: true };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { valid: false, error: `API 错误 (${resp.status}): ${body.slice(0, 200)}` };
  }
  return { valid: true };
}

/**
 * Load config from localStorage
 */
export function loadConfig(): AgentConfig {
  try {
    const saved = localStorage.getItem("agent-config");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  
  return {
    provider: "anthropic",
    apiKey: "",
    model: "claude-opus-4-6",
  };
}

/**
 * Save config to localStorage
 */
export function saveConfig(config: AgentConfig): void {
  localStorage.setItem("agent-config", JSON.stringify(config));
}
