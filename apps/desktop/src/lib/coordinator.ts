/**
 * Coordinator — 秘书路由调度器
 * 负责：意图分析 → 任务拆分 → 派发给合适的 Worker → 汇总结果
 */

import type { AgentConfig, AgentEvent } from "./agent-bridge";
import { PROVIDER_DEFAULT_BASE_URLS } from "./agent-bridge";
import { fetchWithRetry } from "./api-retry";
import {
  getWorker,
  assignTask,
  completeWorkerTask,
  type Worker,
} from "./team";
import { emitAgentEvent } from "./event-bus";
import i18n from "../i18n";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

/** Worker 所属团队映射 */
const ENGINEERING_IDS = new Set([
  "product", "architect", "developer", "frontend", "code_reviewer",
  "tester", "devops", "security", "writer", "researcher", "ux_designer", "data_analyst",
]);

function getWorkerTeam(workerId: string): string {
  return ENGINEERING_IDS.has(workerId) ? t("coordinator.engineeringTeam") : t("coordinator.businessTeam");
}

// ═══════════ 类型定义 ═══════════

/** 意图分析结果 */
export interface IntentResult {
  /** chat=闲聊, task=单步任务, multi_step=多步编排 */
  type: "chat" | "task" | "multi_step";
  /** 需要参与的 Worker ID 列表 */
  workers: string[];
  /** 执行计划描述 */
  plan: string;
}

/** 单步任务描述 */
export interface TaskStep {
  workerId: string;
  task: string;
  /** 是否依赖前一步的输出 */
  dependsOnPrevious: boolean;
}

/** Worker 执行结果 */
export interface WorkerResult {
  workerId: string;
  workerName: string;
  success: boolean;
  output: string;
}

type EventCallback = (event: AgentEvent) => void;

// ═══════════ 关键词意图匹配规则 ═══════════

/** 每个 Worker 对应的意图关键词 */
const INTENT_KEYWORDS: Record<string, string[]> = {
  product: [
    "需求", "prd", "用户故事", "功能设计", "产品", "竞品", "用户画像",
    "feature", "requirement", "user story", "产品文档", "功能规格",
  ],
  developer: [
    "代码", "实现", "开发", "编程", "函数", "接口", "bug", "修复",
    "重构", "优化", "code", "implement", "debug", "fix", "api",
    "组件", "模块", "写一个", "帮我写", "创建项目", "搭建",
  ],
  tester: [
    "测试", "test", "单测", "集成测试", "覆盖率", "assert", "e2e",
    "回归", "压测", "性能测试", "测试用例", "qa",
  ],
  devops: [
    "部署", "deploy", "docker", "ci", "cd", "运维", "服务器",
    "监控", "nginx", "k8s", "kubernetes", "容器", "pipeline",
    "github actions", "jenknis", "发布",
  ],
  writer: [
    "文档", "doc", "readme", "手册", "changelog", "api文档",
    "注释", "说明", "教程", "tutorial", "wiki",
  ],
  ops_director: [
    "运营", "kpi", "指标", "渠道", "营销", "留存", "dau", "mau",
    "operations", "strategy", "channel", "retention", "activation",
  ],
  growth_hacker: [
    "增长", "获客", "裂变", "转化率", "漏斗", "ab测试", "拉新", "病毒",
    "growth", "acquisition", "funnel", "conversion", "viral", "a/b test",
  ],
  researcher: [
    "搜索", "查找", "调研", "研究", "新闻", "资讯", "动态", "最新", "热点",
    "search", "find", "research", "news", "latest", "trending",
    "竞品", "分析", "评估", "方案", "技术选型",
  ],
  content_ops: [
    "内容", "文案", "公众号", "社媒", "seo", "推文", "素材", "排版",
    "content", "copywriting", "social media", "article", "editorial",
  ],
  legal_compliance: [
    "法务", "合规", "隐私", "协议", "条款", "gdpr", "版权", "知识产权",
    "legal", "compliance", "privacy", "policy", "terms", "regulation",
  ],
  financial_analyst: [
    "财务", "预算", "成本", "roi", "收入", "利润", "现金流", "报表",
    "finance", "budget", "cost", "revenue", "profit", "forecast",
  ],
  project_manager: [
    "项目", "进度", "排期", "里程碑", "甘特", "风险", "资源", "站会",
    "project", "schedule", "milestone", "gantt", "deadline", "sprint",
  ],
  customer_support: [
    "客服", "工单", "faq", "反馈", "投诉", "满意度", "sla", "知识库",
    "support", "ticket", "feedback", "complaint", "helpdesk", "nps",
  ],
  risk_analyst: [
    "风控", "欺诈", "异常", "反洗钱", "黑名单", "规则引擎", "风险评估",
    "risk", "fraud", "anomaly", "aml", "blacklist", "risk assessment",
  ],
};

/** 判定为闲聊的关键词 */
const CHAT_KEYWORDS = [
  "你好", "hello", "hi", "嗨", "谢谢", "thanks", "再见", "bye",
  "你是谁", "介绍一下", "什么是", "解释", "为什么", "怎么样",
  "聊聊", "说说", "想问", "请问", "帮我看看",
];

/** 判定为多步任务的关键词 */
const MULTI_STEP_KEYWORDS = [
  "完整项目", "从头到尾", "全流程", "端到端", "先.*再.*然后",
  "第一步.*第二步", "多个步骤", "整套", "全套",
  "需求到上线", "开发到部署", "设计到实现",
];

// ═══════════ 意图分析 ═══════════

/**
 * 分析用户消息的意图
 * 优先使用关键词匹配（零成本），复杂意图标记为需要 LLM 辅助
 */
export function analyzeIntent(message: string): IntentResult {
  const msg = message.toLowerCase();

  // Scenario match — framework-first scaffolding takes priority
  try {
    const { matchScenario } = require("./scenario-engine") as typeof import("./scenario-engine");
    const scenario = matchScenario(message);
    if (scenario) {
      return {
        type: "multi_step",
        workers: [...new Set(scenario.steps.map(s => s.workerId).filter(Boolean) as string[])],
        plan: `[Scenario: ${scenario.name}] ${scenario.steps.length} structured steps`,
      };
    }
  } catch { /* scenario engine not loaded yet */ }

  // 检查是否为多步任务
  const isMultiStep = MULTI_STEP_KEYWORDS.some(kw => {
    if (kw.includes(".*")) {
      return new RegExp(kw).test(msg);
    }
    return msg.includes(kw);
  });

  // 统计各 Worker 的关键词匹配分数
  const scores: Record<string, number> = {};
  for (const [workerId, keywords] of Object.entries(INTENT_KEYWORDS)) {
    scores[workerId] = keywords.filter(kw => msg.includes(kw)).length;
  }

  // 收集有匹配的 Worker
  const matchedWorkers = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);

  // 多步任务：涉及多个 Worker
  if (isMultiStep || matchedWorkers.length >= 2) {
    const workers = matchedWorkers.length > 0 ? matchedWorkers : ["developer"];
    return {
      type: "multi_step",
      workers,
      plan: t("coordinator.multiStepPlan", { workers: workers.join(", ") }),
    };
  }

  // 单步任务：只匹配到一个 Worker
  if (matchedWorkers.length === 1) {
    return {
      type: "task",
      workers: matchedWorkers,
      plan: t("coordinator.singleTaskPlan", { worker: matchedWorkers[0] }),
    };
  }

  // 检查是否为纯闲聊
  const isChatOnly = CHAT_KEYWORDS.some(kw => msg.includes(kw));
  if (isChatOnly && matchedWorkers.length === 0) {
    return { type: "chat", workers: [], plan: t("coordinator.chatPlan") };
  }

  // 默认：如果消息较长且不像闲聊，当作开发任务
  if (message.length > 30 && !isChatOnly) {
    return {
      type: "task",
      workers: ["developer"],
      plan: t("coordinator.defaultDeveloperPlan"),
    };
  }

  return { type: "chat", workers: [], plan: t("coordinator.chatPlan") };
}

// ═══════════ 任务派发 ═══════════

/**
 * 派发任务给指定 Worker
 * Worker 使用自己的 system prompt 独立执行
 */
export async function dispatchToWorker(
  workerId: string,
  task: string,
  config: AgentConfig,
  onEvent: EventCallback,
  history?: Array<{ role: string; content: string }>,
): Promise<WorkerResult> {
  const worker = getWorker(workerId);
  if (!worker) {
    return {
      workerId,
      workerName: workerId,
      success: false,
      output: t("coordinator.workerNotFound", { id: workerId }),
    };
  }

  // 标记 Worker 为工作状态
  assignTask(workerId, task.slice(0, 50));

  const team = getWorkerTeam(workerId);

  // Emit worker_activate event for MonitorPage real-time tracking
  emitAgentEvent({ type: "worker_activate", worker: worker.name, workerId, team });
  emitAgentEvent({ type: "worker_dispatch", worker: worker.name, workerId, team });

  // ── #2: Soft-ceiling cost quota check ──
  try {
    const { getConversationUsage } = require("./cost-tracker") as typeof import("./cost-tracker");
    const budgetStr = localStorage.getItem("cost-quota-per-conversation");
    if (budgetStr) {
      const maxCost = parseFloat(budgetStr);
      if (maxCost > 0) {
        const convId = (globalThis as Record<string, unknown>).__currentConversationId as string | undefined;
        if (convId) {
          const usage = await getConversationUsage(convId);
          if (usage && usage.totalCost >= maxCost) {
            completeWorkerTask(workerId);
            return {
              workerId,
              workerName: worker.name,
              success: false,
              output: `Budget exceeded: $${usage.totalCost.toFixed(4)} / $${maxCost.toFixed(2)} cap. Adjust in Settings > General > Cost Quota.`,
            };
          }
        }
      }
    }
  } catch { /* cost tracker not loaded or quota not set */ }

  onEvent({
    type: "thinking",
    text: `\n🎯 ${t("coordinator.dispatchTo", { emoji: worker.emoji, name: worker.name, team })}\n`,
  });

  try {
    // Inject cross-session context into task prompt
    let enrichedTask = task;

    // ── Bounded context check: inject summary hint if conversation is long ──
    try {
      const { checkBounds, buildSummaryHint, recordTurn, markSummarized } = require("./bounded-context") as typeof import("./bounded-context");
      const convId = (globalThis as Record<string, unknown>).__currentConversationId as string | undefined;
      if (convId) {
        recordTurn(convId, task.length, 0);
        const check = checkBounds(convId);
        if (check.shouldSummarize) {
          enrichedTask = `${buildSummaryHint(check)}\n\n---\n\n${task}`;
          markSummarized(convId);
        }
      }
    } catch { /* bounded context not loaded */ }

    try {
      const { buildContextPromptWithObservations } = require("./context-bootstrap") as typeof import("./context-bootstrap");
      const ctx = await buildContextPromptWithObservations();
      if (ctx) enrichedTask = `${ctx}\n\n---\n\n${task}`;
    } catch { /* context bootstrap not loaded */ }

    // ── Experience recall (AgentEvolver self-navigating pattern) ──
    // Search observation-log for past successful dispatches with similar tasks.
    // Injects "what worked before" so the secretary improves with use.
    try {
      const { observationLog } = require("./observation-log") as typeof import("./observation-log");
      const pastHits = await observationLog.search(task.slice(0, 60), 3);
      const relevantPast = pastHits.filter(h => h.type === "worker_dispatch");
      if (relevantPast.length > 0) {
        const obs = await observationLog.getObservations(relevantPast.map(h => h.id));
        const pastExperience = obs
          .filter(o => o.detail.includes("--- Result ---"))
          .slice(0, 2)
          .map(o => {
            const resultMatch = o.detail.match(/--- Result ---\n([\s\S]*)/);
            const result = resultMatch ? resultMatch[1].trim().slice(0, 200) : o.summary;
            // Include [[obs_id]] so the new dispatch observation links back to its source
            return `- [[${o.id}]] ${o.summary}\n  Result: ${result}`;
          })
          .join("\n");
        if (pastExperience) {
          enrichedTask = `[Past experience with similar tasks]\n${pastExperience}\n\n---\n\n${enrichedTask}`;
        }
      }
    } catch { /* observation log not loaded */ }

    // Inject environment context for planning-related tasks
    const planKeywords = ["plan", "规划", "设计", "architecture", "架构", "schedule"];
    if (planKeywords.some(k => task.toLowerCase().includes(k))) {
      try {
        const { buildEnvPrompt, getLastSnapshot } = require("./env-scanner") as typeof import("./env-scanner");
        if (getLastSnapshot()) {
          const envCtx = buildEnvPrompt();
          if (envCtx) enrichedTask = `${envCtx}\n\n---\n\n${enrichedTask}`;
        }
      } catch { /* env scanner not loaded */ }
    }

    // ── #1: Subagent observability — capture worker intermediate events as timeline ──
    const dispatchId = `dispatch_${Date.now()}_${workerId}`;
    const workerEvents: Array<{ type: string; content: string; ts: number }> = [];
    const wrappedOnEvent: EventCallback = (event) => {
      onEvent(event);
      const type = event.type as string;
      if (type === "tool_use" || type === "tool_result" || type === "thinking") {
        workerEvents.push({ type, content: (event.text as string || "").slice(0, 200), ts: Date.now() });
      }
    };

    const result = await callWorkerLLM(worker, enrichedTask, config, wrappedOnEvent, history);

    // Record worker's mini-timeline in observation-log for subagent visibility
    try {
      const { observationLog } = require("./observation-log") as typeof import("./observation-log");
      const timeline = workerEvents.length > 0
        ? workerEvents.map(e => `[${e.type}] ${e.content}`).join("\n")
        : "(no intermediate steps)";
      await observationLog.save({
        type: "worker_dispatch",
        detail: `[${dispatchId}] ${worker.name} (${workerId})\nTask: ${task.slice(0, 120)}\n\n--- Timeline ---\n${timeline}\n\n--- Result ---\n${result.slice(0, 300)}`,
        worker: workerId,
        tags: ["subagent", dispatchId],
      });
    } catch { /* observation log not loaded */ }

    // Quality gate — self-critique hard gate (threshold from strategy preset)
    try {
      const { runQualityGate, buildRetryPrompt } = require("./quality-gate") as typeof import("./quality-gate");
      const { getStrategy, recordFailure, isStagnant, suggestAlternativeWorker, clearFailures } = require("./strategy-presets") as typeof import("./strategy-presets");
      const strategy = getStrategy();
      const gateResult = runQualityGate(result, { workerId, taskDescription: task, userMessage: task });

      if (!gateResult.passed && gateResult.score < strategy.qualityGateThreshold) {
        recordFailure(workerId, gateResult.failedChecks.map(f => f.checkId).join(","));

        // Stagnation detection: if this worker keeps failing, try an alternative
        if (isStagnant(workerId)) {
          const alt = suggestAlternativeWorker(workerId);
          if (alt) {
            emitAgentEvent({ type: "intent_analysis", intentType: "stagnation", text: `${workerId} stagnant (${gateResult.failedChecks.length} failures) → switching to ${alt}` });
            completeWorkerTask(workerId);
            const altWorker = getWorker(alt);
            if (altWorker) {
              assignTask(alt, task.slice(0, 50));
              const altResult = await callWorkerLLM(altWorker, enrichedTask, config, onEvent, history);
              completeWorkerTask(alt);
              clearFailures(workerId);
              emitAgentEvent({ type: "worker_complete", worker: altWorker.name, workerId: alt, team: getWorkerTeam(alt), success: true });
              return { workerId: alt, workerName: altWorker.name, success: true, output: altResult };
            }
          }
        }

        // Standard retry (up to strategy.maxRetries)
        if (strategy.maxRetries > 0) {
          const retryPrompt = buildRetryPrompt(task, result, gateResult);
          const retryResult = await callWorkerLLM(worker, retryPrompt, config, onEvent, history);
          completeWorkerTask(workerId);
          emitAgentEvent({ type: "worker_complete", worker: worker.name, workerId, team, success: true });
          return { workerId, workerName: worker.name, success: true, output: retryResult };
        }
      } else if (gateResult.passed) {
        clearFailures(workerId);
      }
    } catch { /* quality gate or strategy not loaded */ }

    completeWorkerTask(workerId);

    // Emit worker_complete event
    emitAgentEvent({ type: "worker_complete", worker: worker.name, workerId, team, success: true });

    return {
      workerId,
      workerName: worker.name,
      success: true,
      output: result,
    };
  } catch (err) {
    completeWorkerTask(workerId);
    const errMsg = err instanceof Error ? err.message : String(err);

    // Emit worker_complete event (with failure)
    emitAgentEvent({ type: "worker_complete", worker: worker.name, workerId, team, success: false });

    // ── Graceful degradation: human-as-fallback (EmptyOS-inspired) ──
    const fallback = buildHumanFallback(workerId, task, errMsg);

    return {
      workerId,
      workerName: worker.name,
      success: false,
      output: `${t("coordinator.executionFailed")}: ${errMsg}\n\n${fallback}`,
    };
  }
}

/**
 * Build a human-actionable fallback suggestion when a worker dispatch fails.
 * Instead of just "error: timeout", tells the user what they can do manually.
 * Inspired by EmptyOS's "human is the ultimate capability provider" pattern.
 */
function buildHumanFallback(_workerId: string, task: string, error: string): string {
  const isTimeout = /timeout|timed?\s*out|ETIMEDOUT/i.test(error);
  const isAuth = /auth|401|403|token|unauthorized|forbidden/i.test(error);
  const isNetwork = /network|ECONNREFUSED|ECONNRESET|fetch|DNS|ENOTFOUND/i.test(error);
  const isQuota = /quota|429|rate.?limit|too many/i.test(error);
  const isLark = /lark|calendar|document|approval/i.test(task);

  const suggestions: string[] = [];

  if (isTimeout) {
    suggestions.push("⏱ The AI took too long. You can:");
    suggestions.push("  1. Try again with a simpler request");
    suggestions.push("  2. Switch to a faster model (`/model`)");
    suggestions.push("  3. Break the task into smaller pieces");
  } else if (isAuth) {
    suggestions.push("🔑 Authentication failed. You can:");
    suggestions.push("  1. Check your API key in Settings > Model");
    if (isLark) suggestions.push("  2. Re-authorize Lark in Settings > Lark");
    suggestions.push(`  ${isLark ? "3" : "2"}. Run \`/doctor\` to diagnose the issue`);
  } else if (isNetwork) {
    suggestions.push("🌐 Network error. You can:");
    suggestions.push("  1. Check your internet connection");
    suggestions.push("  2. Check if a proxy is needed (Settings > General > Proxy)");
    suggestions.push("  3. Run `/doctor` for a full connection test");
  } else if (isQuota) {
    suggestions.push("💰 Rate limit or quota exceeded. You can:");
    suggestions.push("  1. Wait a minute and try again");
    suggestions.push("  2. Switch to a different provider (`/model`)");
    suggestions.push("  3. Check your usage in the cost panel");
  } else if (isLark) {
    suggestions.push("📋 Lark operation failed. You can:");
    suggestions.push("  1. Open Lark manually and do it there");
    suggestions.push("  2. Check if the App has the right permissions in Lark Open Platform");
    suggestions.push("  3. Re-authorize in Settings > Lark if your token expired");
  } else {
    suggestions.push("💡 The worker couldn't complete the task. You can:");
    suggestions.push("  1. Rephrase your request with more detail");
    suggestions.push("  2. Try a different approach or break it into steps");
    suggestions.push("  3. Run `/doctor` to check system health");
  }

  return suggestions.join("\n");
}

/**
 * 用 Worker 的 system prompt 调用 LLM — 上下文隔离模式
 *
 * 关键设计（对齐 ref-s04 Subagent 模式）：
 * - Worker 拥有独立的 messages[]，不包含父 agent 的对话历史
 * - messages 只包含：[system prompt (角色), user message (任务)]
 * - 执行完后返回摘要（string），不返回完整 messages
 * - 父 agent 只收到摘要，不污染自己的上下文
 */
async function callWorkerLLM(
  worker: Worker,
  task: string,
  config: AgentConfig,
  onEvent: EventCallback,
  _history?: Array<{ role: string; content: string }>,
): Promise<string> {
  // 90-second overall timeout for worker execution
  const timeoutMs = 90000;
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error(`Worker ${worker.name} timeout (${timeoutMs / 1000}s)`)), timeoutMs)
  );
  try {
    return await Promise.race([callWorkerLLMInner(worker, task, config, onEvent, _history), timeoutPromise]);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Surface error to UI so user doesn't see infinite "thinking"
    onEvent({ type: "error", text: `Worker error: ${errMsg}` });
    throw err;
  }
}

async function callWorkerLLMInner(
  worker: Worker,
  task: string,
  config: AgentConfig,
  onEvent: EventCallback,
  _history?: Array<{ role: string; content: string }>,
): Promise<string> {
  const rawBaseURL = config.baseURL || PROVIDER_DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
  const { getAllToolDefinitions, executeTool } = await import("./tools");
  const TOOL_DEFINITIONS = getAllToolDefinitions();

  // 根据 Worker 角色过滤可用工具
  const allowedTools = getWorkerToolWhitelist(worker.role);
  const filteredTools = TOOL_DEFINITIONS.filter(td =>
    allowedTools.includes(td.function.name),
  );

  // ── 上下文隔离：独立 messages，不包含父 agent 历史 ──
  // Karpathy principles injected into every worker's system prompt
  const karpathyPrinciples = [
    "\n\n## Operating Principles",
    "1. THINK BEFORE ACTING: If anything is unclear, surface the ambiguity and ask — never assume silently. State your reasoning before producing output.",
    "2. SIMPLICITY FIRST: Deliver exactly what was requested, nothing more. Do not add speculative features, unnecessary abstractions, or \"nice to have\" extras unless explicitly asked.",
    "3. SURGICAL CHANGES: Touch only what the task requires. Do not make orthogonal edits, reformat unrelated code, or rename things \"while you're at it.\"",
    "4. GOAL-DRIVEN: Convert tasks into success criteria. Verify your output meets those criteria before delivering. If it doesn't, revise — don't explain why it's close enough.",
  ].join("\n");

  const isolatedMessages: Array<{
    role: string;
    content: string | null;
    tool_call_id?: string;
    tool_calls?: unknown[];
  }> = [
    { role: "system", content: worker.systemPrompt + `\n\n${t("coordinator.todayDateHint", { date: new Date().toISOString().split("T")[0] })}` + karpathyPrinciples },
    { role: "user", content: task },
  ];

  const MAX_WORKER_ITERATIONS = config.provider === "compatible" ? 2 : 3;
  let iteration = 0;
  let fullOutput = "";
  let workerToolCalls = 0;

  while (iteration < MAX_WORKER_ITERATIONS) {
    iteration++;

    const isAnthropic = config.provider === "anthropic";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let apiUrl: string;
    let body: Record<string, unknown>;

    if (isAnthropic) {
      headers["x-api-key"] = config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      apiUrl = `${baseURL}/v1/messages`;
      const anthropicMsgs = isolatedMessages.filter(m => m.role !== "system").map(m => ({
        role: m.role, content: m.content || "",
      }));
      body = {
        model: config.model || "claude-sonnet-4-6",
        max_tokens: 4096,
        system: worker.systemPrompt + "\n\n" + t("coordinator.todayDateHint", { date: new Date().toISOString().split("T")[0] }),
        messages: anthropicMsgs,
      };
      if (filteredTools.length > 0 && config.provider !== "compatible") {
        body.tools = filteredTools.map(td => ({
          name: td.function.name, description: td.function.description,
          input_schema: td.function.parameters,
        }));
      }
    } else {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
      apiUrl = `${baseURL}/v1/chat/completions`;
      body = {
        model: config.model || "gpt-4o",
        max_tokens: 4096,
        messages: isolatedMessages,
        stream: false,
      };
      if (filteredTools.length > 0 && config.provider !== "compatible") {
        body.tools = filteredTools;
        body.tool_choice = "auto";
      }
    }

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Worker API ${response.status}: ${err.slice(0, 300)}`);
    }

    const data = await response.json();

    // Normalize response format (Anthropic vs OpenAI)
    let msg: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    if (isAnthropic) {
      const textBlocks = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text);
      const toolBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");
      msg = {
        content: textBlocks.join("") || null,
        tool_calls: toolBlocks.length > 0 ? toolBlocks.map((b: any) => ({
          id: b.id,
          function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
        })) : undefined,
      };
    } else {
      const choice = data.choices?.[0];
      if (!choice) throw new Error(t("coordinator.noApiResponse"));
      msg = choice.message;
    }

    // 处理工具调用
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      if (msg.content) {
        onEvent({ type: "text", text: msg.content });
      }
      isolatedMessages.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls!) {
        const fn = tc.function;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn.arguments || "{}");
        } catch { /* 忽略解析错误 */ }

        // 安全检查：Worker 只能调用白名单内的工具
        if (!allowedTools.includes(fn.name)) {
          isolatedMessages.push({
            role: "tool",
            content: `⛔ ${t("coordinator.workerNoPermission", { worker: worker.name, tool: fn.name })}`,
            tool_call_id: tc.id,
          });
          continue;
        }

        onEvent({
          type: "tool_use",
          toolName: fn.name,
          toolInput: fn.arguments,
        });

        try {
          // Per-tool timeout: 30s to prevent individual tools from hanging
          const toolTimeout = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error(`Tool ${fn.name} timeout (30s)`)), 30000)
          );
          const result = await Promise.race([executeTool(fn.name, args), toolTimeout]);
          onEvent({
            type: "thinking",
            text: `✅ ${worker.emoji} ${fn.name}: ${result.slice(0, 100)}\n`,
          });
          isolatedMessages.push({
            role: "tool",
            content: result.slice(0, 15000),
            tool_call_id: tc.id,
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          onEvent({ type: "thinking", text: `❌ ${worker.emoji} ${fn.name}: ${errMsg}\n` });
          isolatedMessages.push({
            role: "tool",
            content: `Error: ${errMsg}`,
            tool_call_id: tc.id,
          });
        }
      }
      workerToolCalls += msg.tool_calls!.length;
      // Force stop after 5 total tool calls to prevent runaway loops
      if (workerToolCalls >= 5) {
        const toolMsgs = isolatedMessages.filter(m => m.role === "tool").map(m => m.content).filter(Boolean);
        const summary = toolMsgs.length > 0 ? (toolMsgs as string[]).join("\n\n").slice(0, 5000) : "Tool calls completed";
        onEvent({ type: "text", text: summary });
        fullOutput = summary;
        break;
      }
      // Compatible provider: emit tool results directly and stop
      if (config.provider === "compatible") {
        const toolMsgs = isolatedMessages.filter(m => m.role === "tool").map(m => m.content).filter(Boolean);
        const summary = toolMsgs.length > 0 ? toolMsgs.join("\n\n").slice(0, 5000) : t("coordinator.toolDoneNoResult");
        onEvent({ type: "text", text: summary });
        fullOutput = summary;
        break;
      }
      continue;
    }

    // 纯文本回复 — Worker 完成
    fullOutput = msg.content || "";
    onEvent({ type: "text", text: fullOutput });
    break;
  }

  // ── 只返回摘要，隔离上下文被丢弃 ──
  return fullOutput;
}

// ═══════════ 多步骤编排 ═══════════

/**
 * @deprecated Superseded by scenario-engine's runScenario(). Kept for
 *             backward compat in case callers return. Prefer runScenario
 *             for new multi-step orchestration.
 *
 * 多步骤任务编排 — 按依赖关系顺序/并行执行
 */
export async function orchestrateMultiStep(
  message: string,
  workerIds: string[],
  config: AgentConfig,
  onEvent: EventCallback,
  history?: Array<{ role: string; content: string }>,
): Promise<string> {
  onEvent({
    type: "thinking",
    text: `\n📋 ${t("coordinator.secretaryOrchestrating", { count: workerIds.length })}\n`,
  });

  const results: WorkerResult[] = [];
  let previousOutput = "";

  // 顺序执行各 Worker（后续可扩展为并行）
  for (const workerId of workerIds) {
    const worker = getWorker(workerId);
    const workerName = worker?.name || workerId;

    // 为每个 Worker 构建上下文（包含前一步的输出）
    let taskForWorker = message;
    if (previousOutput) {
      taskForWorker = `${message}\n\n${t("coordinator.previousWorkerOutput")}:\n${previousOutput.slice(0, 3000)}`;
    }

    onEvent({
      type: "thinking",
      text: `\n📌 ${t("coordinator.stepProgress", { current: results.length + 1, total: workerIds.length, worker: workerName })}\n`,
    });

    const result = await dispatchToWorker(
      workerId,
      taskForWorker,
      config,
      onEvent,
      history,
    );
    results.push(result);
    previousOutput = result.output;
  }

  // 汇总结果
  const summary = buildSummary(results);
  onEvent({ type: "text", text: `\n\n${summary}` });
  return summary;
}

/** 汇总多个 Worker 的执行结果 */
function buildSummary(results: WorkerResult[]): string {
  const lines: string[] = ["---", `📊 **${t("coordinator.summaryReport")}**\n`];
  for (const r of results) {
    const status = r.success ? "✅" : "❌";
    lines.push(`${status} **${r.workerName}**: ${r.output.slice(0, 200)}`);
    if (r.output.length > 200) lines.push("...");
    lines.push("");
  }
  const successCount = results.filter(r => r.success).length;
  lines.push(`\n**${t("coordinator.completionRate")}**: ${successCount}/${results.length}`);
  return lines.join("\n");
}

// ═══════════ Worker 工具白名单 ═══════════

/** 获取 Worker 可用的工具白名单 */
function getWorkerToolWhitelist(role: string): string[] {
  const whitelists: Record<string, string[]> = {
    product: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_write", "memory_read", "todo_write",
    ],
    developer: [
      "bash", "file_write", "file_read", "file_edit", "list_dir",
      "grep", "glob", "web_search", "web_fetch", "browser_open",
      "todo_write", "diff_view", "undo", "project_detect",
    ],
    tester: [
      "bash", "file_write", "file_read", "file_edit", "list_dir",
      "grep", "glob", "todo_write", "diff_view",
    ],
    devops: [
      "bash", "file_write", "file_read", "file_edit", "list_dir",
      "grep", "glob", "web_search", "web_fetch", "todo_write",
      "project_detect",
    ],
    writer: [
      "file_write", "file_read", "list_dir", "grep",
      "web_search", "web_fetch", "todo_write",
    ],
    ops_director: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_write", "memory_read", "todo_write",
    ],
    growth_hacker: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_write", "memory_read", "todo_write", "bash",
    ],
    content_ops: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_write", "memory_read", "todo_write",
    ],
    legal_compliance: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_read", "todo_write",
    ],
    financial_analyst: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_read", "todo_write", "bash",
    ],
    project_manager: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_write", "memory_read", "todo_write",
    ],
    customer_support: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_write", "memory_read", "todo_write",
    ],
    risk_analyst: [
      "web_search", "web_fetch", "file_write", "file_read",
      "memory_read", "todo_write", "bash",
    ],
  };
  return whitelists[role] || whitelists.developer;
}

/**
 * @deprecated Currently unused — kept for potential UI display of per-role tool lists.
 *
 * 获取 Worker 工具白名单（对外暴露，供 UI 展示用）
 */
export function getWorkerTools(role: string): string[] {
  return getWorkerToolWhitelist(role);
}
