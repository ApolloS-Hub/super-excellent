/**
 * Coordinator — 秘书路由调度器
 * 负责：意图分析 → 任务拆分 → 派发给合适的 Worker → 汇总结果
 */

import type { AgentConfig, AgentEvent } from "./agent-bridge";
import { fetchWithRetry } from "./api-retry";
import {
  getWorker,
  assignTask,
  completeWorkerTask,
  type Worker,
} from "./team";
import { emitAgentEvent } from "./event-bus";

/** Worker 所属团队映射 */
const ENGINEERING_IDS = new Set([
  "product", "architect", "developer", "frontend", "code_reviewer",
  "tester", "devops", "security", "writer", "researcher", "ux_designer", "data_analyst",
]);

function getWorkerTeam(workerId: string): string {
  return ENGINEERING_IDS.has(workerId) ? "研发团队" : "业务团队";
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
      plan: `多步骤任务，涉及: ${workers.join(", ")}`,
    };
  }

  // 单步任务：只匹配到一个 Worker
  if (matchedWorkers.length === 1) {
    return {
      type: "task",
      workers: matchedWorkers,
      plan: `单任务，由 ${matchedWorkers[0]} 执行`,
    };
  }

  // 检查是否为纯闲聊
  const isChatOnly = CHAT_KEYWORDS.some(kw => msg.includes(kw));
  if (isChatOnly && matchedWorkers.length === 0) {
    return { type: "chat", workers: [], plan: "闲聊对话" };
  }

  // 默认：如果消息较长且不像闲聊，当作开发任务
  if (message.length > 30 && !isChatOnly) {
    return {
      type: "task",
      workers: ["developer"],
      plan: "默认由开发工程师处理",
    };
  }

  return { type: "chat", workers: [], plan: "闲聊对话" };
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
      output: `未找到 Worker: ${workerId}`,
    };
  }

  // 标记 Worker 为工作状态
  assignTask(workerId, task.slice(0, 50));

  const team = getWorkerTeam(workerId);

  // Emit worker_activate event for MonitorPage real-time tracking
  emitAgentEvent({ type: "worker_activate", worker: worker.name, workerId, team });
  emitAgentEvent({ type: "worker_dispatch", worker: worker.name, workerId, team });

  onEvent({
    type: "thinking",
    text: `\n🎯 派给 ${worker.emoji} ${worker.name}（${team}）\n`,
  });

  try {
    // 用 Worker 自己的 system prompt 构建上下文，调用 LLM
    const result = await callWorkerLLM(worker, task, config, onEvent, history);
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

    return {
      workerId,
      workerName: worker.name,
      success: false,
      output: `执行失败: ${errMsg}`,
    };
  }
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
  // 60-second overall timeout for worker execution
  const timeoutMs = 60000;
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("Worker 执行超时 (60s)")), timeoutMs)
  );
  return Promise.race([callWorkerLLMInner(worker, task, config, onEvent, _history), timeoutPromise]);
}

async function callWorkerLLMInner(
  worker: Worker,
  task: string,
  config: AgentConfig,
  onEvent: EventCallback,
  _history?: Array<{ role: string; content: string }>,
): Promise<string> {
  const rawBaseURL = config.baseURL || "https://api.openai.com";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");
  const { getAllToolDefinitions, executeTool } = await import("./tools");
  const TOOL_DEFINITIONS = getAllToolDefinitions();

  // 根据 Worker 角色过滤可用工具
  const allowedTools = getWorkerToolWhitelist(worker.role);
  const filteredTools = TOOL_DEFINITIONS.filter(t =>
    allowedTools.includes(t.function.name),
  );

  // ── 上下文隔离：独立 messages，不包含父 agent 历史 ──
  const isolatedMessages: Array<{
    role: string;
    content: string | null;
    tool_call_id?: string;
    tool_calls?: unknown[];
  }> = [
    { role: "system", content: worker.systemPrompt + `\n\n今天的日期是 ${new Date().toISOString().split("T")[0]}。搜索时不要在关键词里加年份数字。` },
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
      apiUrl = `${baseURL}/v1/messages`;
      const anthropicMsgs = isolatedMessages.filter(m => m.role !== "system").map(m => ({
        role: m.role, content: m.content || "",
      }));
      body = {
        model: config.model || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: worker.systemPrompt + "\n\n今天的日期是 " + new Date().toISOString().split("T")[0] + "。搜索时不要在关键词里加年份数字。",
        messages: anthropicMsgs,
      };
      if (filteredTools.length > 0 && config.provider !== "compatible") {
        body.tools = filteredTools.map(t => ({
          name: t.function.name, description: t.function.description,
          input_schema: t.function.parameters,
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
      if (!choice) throw new Error("Worker API \u65e0\u54cd\u5e94");
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
            content: `⛔ Worker ${worker.name} 无权使用工具: ${fn.name}`,
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
          const result = await executeTool(fn.name, args);
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
        const summary = toolMsgs.length > 0 ? toolMsgs.join("\n\n").slice(0, 5000) : "工具执行完成，但无返回结果";
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
 * 多步骤任务编排
 * 按依赖关系顺序/并行执行
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
    text: `\n📋 秘书开始编排多步骤任务，涉及 ${workerIds.length} 个 Worker...\n`,
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
      taskForWorker = `${message}\n\n前序 Worker 的输出供你参考:\n${previousOutput.slice(0, 3000)}`;
    }

    onEvent({
      type: "thinking",
      text: `\n📌 步骤 ${results.length + 1}/${workerIds.length}: ${workerName}\n`,
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
  const lines: string[] = ["---", "📊 **秘书汇总报告**\n"];
  for (const r of results) {
    const status = r.success ? "✅" : "❌";
    lines.push(`${status} **${r.workerName}**: ${r.output.slice(0, 200)}`);
    if (r.output.length > 200) lines.push("...");
    lines.push("");
  }
  const successCount = results.filter(r => r.success).length;
  lines.push(`\n**完成率**: ${successCount}/${results.length}`);
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
 * 获取 Worker 工具白名单（对外暴露，供 UI 展示用）
 */
export function getWorkerTools(role: string): string[] {
  return getWorkerToolWhitelist(role);
}
