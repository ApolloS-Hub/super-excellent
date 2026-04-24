/**
 * Scenario Engine — Framework-First Scaffolding
 *
 * Turns the 7-phase workflow from a display widget into a real state machine.
 * Defines structured step-by-step scenarios for common secretary tasks.
 * Each scenario has explicit steps, worker assignments, and IO contracts.
 *
 * Inspired by product-playbook's "one sentence triggers entire process" pattern.
 */
import { emitAgentEvent } from "./event-bus";
import { assignTask, completeWorkerTask } from "./team";

// ── Types ──

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface ScenarioStep {
  id: string;
  label: string;
  labelEn: string;
  workerId?: string;
  action: string;
  inputFrom?: string[];       // step IDs whose output feeds this step
  optional?: boolean;
  timeoutMs?: number;
}

export interface ScenarioTemplate {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  triggerKeywords: string[];
  steps: ScenarioStep[];
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output: string;
  startedAt: number;
  completedAt?: number;
}

export interface ScenarioInstance {
  instanceId: string;
  templateId: string;
  currentStepIndex: number;
  status: "running" | "completed" | "failed" | "paused";
  stepResults: Record<string, StepResult>;
  context: Record<string, string>;  // user-provided context injected at start
  createdAt: number;
  updatedAt: number;
}

// ── Built-in Scenarios ──

const WEEKLY_PLANNING: ScenarioTemplate = {
  id: "weekly_planning",
  name: "周计划制定",
  nameEn: "Weekly Planning",
  description: "Structured 5-step weekly planning with calendar sync and priority matrix",
  triggerKeywords: ["规划本周", "plan this week", "weekly plan", "周计划", "plan my week", "本周安排"],
  steps: [
    { id: "gather",   label: "收集事项",   labelEn: "Gather Items",      workerId: "product",           action: "Collect all pending tasks, calendar events, and deadlines for this week from context and memory." },
    { id: "prioritize", label: "优先排序", labelEn: "Prioritize",        workerId: "project_manager",   action: "Apply Eisenhower matrix: categorize gathered items into urgent-important / important-not-urgent / urgent-not-important / neither. Output a ranked list." },
    { id: "conflicts", label: "冲突检测",  labelEn: "Detect Conflicts",  workerId: "project_manager",   action: "Check for scheduling conflicts, resource overlaps, and deadline collisions. Flag issues.", inputFrom: ["gather", "prioritize"] },
    { id: "schedule",  label: "生成日程",  labelEn: "Generate Schedule",  workerId: "product",           action: "Create a day-by-day schedule for Mon-Fri based on priorities and conflicts. Include time blocks.", inputFrom: ["prioritize", "conflicts"] },
    { id: "sync",      label: "确认同步",  labelEn: "Confirm & Sync",    workerId: "ops_director",      action: "Present the final weekly plan to the user. If Lark calendar is connected, offer to sync events.", inputFrom: ["schedule"], optional: true },
  ],
};

const MEETING_PREP: ScenarioTemplate = {
  id: "meeting_prep",
  name: "会议准备",
  nameEn: "Meeting Preparation",
  description: "Structured meeting preparation: agenda, background research, action items",
  triggerKeywords: ["准备会议", "prepare meeting", "meeting prep", "会议准备", "开会前"],
  steps: [
    { id: "context",   label: "理解背景",   labelEn: "Understand Context",  workerId: "researcher",   action: "Identify meeting topic, participants, and past related decisions from memory and conversation." },
    { id: "research",  label: "背景调研",   labelEn: "Background Research", workerId: "researcher",   action: "Research relevant background for the meeting topics. Summarize key data points.", inputFrom: ["context"] },
    { id: "agenda",    label: "拟定议程",   labelEn: "Draft Agenda",        workerId: "product",      action: "Create a structured meeting agenda with time allocations based on context and research.", inputFrom: ["context", "research"] },
    { id: "prep_doc",  label: "准备材料",   labelEn: "Prepare Materials",   workerId: "writer",       action: "Draft a one-page meeting brief with key points, data, and proposed discussion items.", inputFrom: ["research", "agenda"] },
    { id: "actions",   label: "预设行动项", labelEn: "Pre-set Actions",     workerId: "project_manager", action: "List expected outcomes and draft follow-up action item templates.", inputFrom: ["agenda"] },
  ],
};

const EMAIL_TRIAGE: ScenarioTemplate = {
  id: "email_triage",
  name: "邮件处理",
  nameEn: "Email Triage",
  description: "Structured email triage: categorize, draft replies, summarize",
  triggerKeywords: ["处理邮件", "triage email", "email triage", "邮件整理", "check emails", "看邮件"],
  steps: [
    { id: "fetch",     label: "获取邮件",   labelEn: "Fetch Emails",       workerId: "ops_director",  action: "Fetch recent unread emails from Lark Mail. List sender, subject, and preview." },
    { id: "classify",  label: "分类归档",   labelEn: "Classify",           workerId: "ops_director",  action: "Categorize emails: urgent-action / needs-reply / FYI / spam. Rank by priority.", inputFrom: ["fetch"] },
    { id: "summarize", label: "摘要总结",   labelEn: "Summarize",          workerId: "writer",        action: "Write a 1-paragraph summary for each important email.", inputFrom: ["classify"] },
    { id: "drafts",    label: "草拟回复",   labelEn: "Draft Replies",      workerId: "writer",        action: "Draft reply templates for urgent-action and needs-reply emails.", inputFrom: ["classify", "summarize"] },
  ],
};

const DAILY_STANDUP: ScenarioTemplate = {
  id: "daily_standup",
  name: "每日站会",
  nameEn: "Daily Standup",
  description: "Generate daily standup report: yesterday, today, blockers",
  triggerKeywords: ["日报", "standup", "daily report", "每日站会", "今日进展", "daily standup"],
  steps: [
    { id: "yesterday", label: "昨日回顾", labelEn: "Yesterday Review", workerId: "project_manager", action: "Summarize what was accomplished yesterday based on task history, git commits, and memory." },
    { id: "today",     label: "今日计划", labelEn: "Today Plan",      workerId: "project_manager", action: "List today's planned tasks based on weekly schedule and pending items.", inputFrom: ["yesterday"] },
    { id: "blockers",  label: "障碍风险", labelEn: "Blockers & Risks", workerId: "risk_analyst",   action: "Identify any blockers, risks, or dependencies that could affect today's plan.", inputFrom: ["today"] },
    { id: "report",    label: "生成报告", labelEn: "Generate Report",  workerId: "writer",         action: "Format a concise standup report: Done / Doing / Blocked.", inputFrom: ["yesterday", "today", "blockers"] },
  ],
};

const DOC_REVIEW: ScenarioTemplate = {
  id: "doc_review",
  name: "文档审查",
  nameEn: "Document Review",
  description: "Structured document review: clarity, accuracy, actionability",
  triggerKeywords: ["审查文档", "review doc", "document review", "帮我看看这个文档", "review this"],
  steps: [
    { id: "read",      label: "通读理解",   labelEn: "Read & Understand",  workerId: "writer",         action: "Read the document and summarize its purpose, audience, and key claims." },
    { id: "clarity",   label: "清晰度检查", labelEn: "Clarity Check",      workerId: "writer",         action: "Identify unclear sections, jargon, ambiguous statements. Suggest rewrites.", inputFrom: ["read"] },
    { id: "accuracy",  label: "准确性验证", labelEn: "Accuracy Verify",    workerId: "researcher",     action: "Fact-check key claims and data points. Flag anything unverifiable.", inputFrom: ["read"] },
    { id: "structure",  label: "结构优化",  labelEn: "Structure Optimize", workerId: "ux_designer",    action: "Assess document structure, flow, and readability. Suggest reorganization.", inputFrom: ["read"] },
    { id: "final",     label: "综合建议",   labelEn: "Final Recommendations", workerId: "code_reviewer", action: "Synthesize all review feedback into a prioritized list of changes.", inputFrom: ["clarity", "accuracy", "structure"] },
  ],
};

const SPEC_DRIVEN: ScenarioTemplate = {
  id: "spec_driven",
  name: "需求规格化",
  nameEn: "Spec-Driven Development",
  description: "Turn a vague idea into a structured proposal → spec → design → tasks pipeline (OpenSpec-inspired)",
  triggerKeywords: ["propose", "proposal", "写需求", "需求文档", "spec", "写方案", "feature request", "功能提案"],
  steps: [
    { id: "proposal",  label: "生成提案",   labelEn: "Generate Proposal",   workerId: "product",           action: "Write a concise proposal for this change. Include: 1) Problem statement — what pain point does this solve? 2) Proposed solution — high-level approach, 3) Scope boundaries — what's in and what's explicitly NOT in, 4) Risks and open questions, 5) Success criteria — how do we know it worked? Format as structured markdown." },
    { id: "spec",      label: "详细规格",   labelEn: "Detailed Spec",       workerId: "product",           action: "Based on the proposal, write detailed specs. For each user scenario: Given [context], When [action], Then [expected outcome]. Cover the happy path, edge cases, and error cases. List acceptance criteria as a checkable list.", inputFrom: ["proposal"] },
    { id: "design",    label: "技术方案",   labelEn: "Technical Design",    workerId: "architect",         action: "Based on the proposal and specs, write a technical design. Cover: 1) Architecture / component changes, 2) Data model changes (if any), 3) API / interface changes, 4) Dependencies and integration points, 5) Migration / rollback plan. Keep it actionable — a developer should be able to start coding from this.", inputFrom: ["proposal", "spec"] },
    { id: "tasks",     label: "任务拆分",   labelEn: "Task Breakdown",      workerId: "project_manager",   action: "Based on the design, break down into an ordered task list. Each task: title, owner (worker role), estimated effort (S/M/L), dependencies on other tasks. Output as a markdown checklist: - [ ] Task title (owner, size). Order by dependency — independent tasks first.", inputFrom: ["design"] },
    { id: "review",    label: "方案评审",   labelEn: "Review & Refine",     workerId: "code_reviewer",     action: "Review the full proposal→spec→design→tasks pipeline for: 1) Gaps — any scenario not covered? 2) Risks — any technical risk not mitigated? 3) Scope creep — anything that should be deferred? 4) Clarity — would a new team member understand this? Output a short review with verdict: APPROVE / REVISE (with specific items).", inputFrom: ["proposal", "spec", "design", "tasks"], optional: true },
  ],
};

// ── Registry ──

const _templates = new Map<string, ScenarioTemplate>();
const _instances = new Map<string, ScenarioInstance>();
let _instanceCounter = 0;

function registerDefaults(): void {
  for (const t of [WEEKLY_PLANNING, MEETING_PREP, EMAIL_TRIAGE, DAILY_STANDUP, DOC_REVIEW, SPEC_DRIVEN]) {
    _templates.set(t.id, t);
  }
}

export function registerScenario(template: ScenarioTemplate): void {
  _templates.set(template.id, template);
}

export function getScenarioTemplates(): ScenarioTemplate[] {
  return Array.from(_templates.values());
}

export function getScenarioTemplate(id: string): ScenarioTemplate | undefined {
  return _templates.get(id);
}

// ── Intent Matching ──

export function matchScenario(userInput: string): ScenarioTemplate | null {
  const lower = userInput.toLowerCase();
  for (const t of _templates.values()) {
    if (t.triggerKeywords.some(kw => lower.includes(kw.toLowerCase()))) return t;
  }
  return null;
}

// ── Execution ──

export function startScenario(templateId: string, context?: Record<string, string>): ScenarioInstance {
  const template = _templates.get(templateId);
  if (!template) throw new Error(`Scenario template not found: ${templateId}`);

  const instance: ScenarioInstance = {
    instanceId: `scenario_${++_instanceCounter}`,
    templateId,
    currentStepIndex: 0,
    status: "running",
    stepResults: {},
    context: context || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  _instances.set(instance.instanceId, instance);

  emitAgentEvent({
    type: "worker_dispatch",
    worker: "scenario_engine",
    text: `Started scenario: ${template.name} (${template.steps.length} steps)`,
  });

  return instance;
}

export function getScenarioInstance(id: string): ScenarioInstance | undefined {
  return _instances.get(id);
}

export function getAllScenarioInstances(): ScenarioInstance[] {
  return Array.from(_instances.values());
}

export async function executeScenarioStep(
  instance: ScenarioInstance,
  executeWorker: (workerId: string, task: string) => Promise<string>,
): Promise<StepResult> {
  const template = _templates.get(instance.templateId)!;
  const step = template.steps[instance.currentStepIndex];
  if (!step) throw new Error("No more steps");

  const result: StepResult = {
    stepId: step.id,
    status: "running",
    output: "",
    startedAt: Date.now(),
  };
  instance.stepResults[step.id] = result;
  instance.updatedAt = Date.now();

  // Build prompt with upstream outputs
  let prompt = step.action;
  if (step.inputFrom?.length) {
    const upstreamContext = step.inputFrom
      .map(sid => {
        const r = instance.stepResults[sid];
        return r?.output ? `[${sid}]: ${r.output}` : null;
      })
      .filter(Boolean)
      .join("\n\n");
    if (upstreamContext) prompt = `Previous step outputs:\n${upstreamContext}\n\nYour task: ${step.action}`;
  }

  // Inject user-provided context
  if (Object.keys(instance.context).length > 0) {
    const ctx = Object.entries(instance.context).map(([k, v]) => `${k}: ${v}`).join("\n");
    prompt = `User context:\n${ctx}\n\n${prompt}`;
  }

  const workerId = step.workerId || "product";

  emitAgentEvent({
    type: "worker_activate",
    worker: workerId,
    text: `[${template.name}] Step ${instance.currentStepIndex + 1}/${template.steps.length}: ${step.label}`,
  });

  try {
    if (step.workerId) assignTask(workerId, `[${template.name}] ${step.label}`);
    const output = await executeWorker(workerId, prompt);
    result.output = output;
    result.status = "done";
    result.completedAt = Date.now();
    if (step.workerId) completeWorkerTask(workerId, output.slice(0, 200));

    // Advance
    instance.currentStepIndex++;
    if (instance.currentStepIndex >= template.steps.length) {
      instance.status = "completed";
    }
    instance.updatedAt = Date.now();
    persistInstances(); // durable checkpoint after each step
  } catch (err) {
    result.status = "failed";
    result.output = err instanceof Error ? err.message : String(err);
    result.completedAt = Date.now();
    if (!step.optional) instance.status = "failed";
    else {
      instance.currentStepIndex++;
      if (instance.currentStepIndex >= template.steps.length) instance.status = "completed";
    }
    persistInstances(); // persist even on failure
    instance.updatedAt = Date.now();
  }

  return result;
}

export async function runScenario(
  templateId: string,
  executeWorker: (workerId: string, task: string) => Promise<string>,
  context?: Record<string, string>,
  onStepComplete?: (step: StepResult, instance: ScenarioInstance) => void,
): Promise<ScenarioInstance> {
  const instance = startScenario(templateId, context);
  const template = _templates.get(templateId)!;

  while (instance.status === "running") {
    const result = await executeScenarioStep(instance, executeWorker);
    onStepComplete?.(result, instance);
  }

  emitAgentEvent({
    type: instance.status === "completed" ? "worker_complete" : "error",
    worker: "scenario_engine",
    text: `Scenario ${template.name}: ${instance.status} (${Object.keys(instance.stepResults).length} steps)`,
  });

  return instance;
}

// ── Collect final output ──

export function collectScenarioOutput(instance: ScenarioInstance): string {
  const template = _templates.get(instance.templateId);
  if (!template) return "";
  const sections = template.steps
    .map(step => {
      const r = instance.stepResults[step.id];
      if (!r || r.status !== "done") return null;
      return `## ${step.label}\n\n${r.output}`;
    })
    .filter(Boolean);
  return `# ${template.name}\n\n${sections.join("\n\n---\n\n")}`;
}

// ── Durable persistence (crash recovery) ──

const PERSIST_KEY = "scenario-engine-instances";

function persistInstances(): void {
  try {
    const running = Array.from(_instances.values()).filter(i => i.status === "running" || i.status === "paused");
    localStorage.setItem(PERSIST_KEY, JSON.stringify(running));
  } catch (e) {
    console.warn("scenario-engine: failed to persist instances", e);
  }
}

export function restoreInstances(): ScenarioInstance[] {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return [];
    const instances = JSON.parse(raw) as ScenarioInstance[];
    for (const inst of instances) {
      // Mark as paused (was running when app crashed)
      if (inst.status === "running") inst.status = "paused";
      _instances.set(inst.instanceId, inst);
    }
    return instances;
  } catch {
    return [];
  }
}

export function getPausedInstances(): ScenarioInstance[] {
  return Array.from(_instances.values()).filter(i => i.status === "paused");
}

export function resumeScenarioInstance(instanceId: string): ScenarioInstance | null {
  const inst = _instances.get(instanceId);
  if (!inst || inst.status !== "paused") return null;
  inst.status = "running";
  inst.updatedAt = Date.now();
  return inst;
}

// ── Init ──

export function initScenarioEngine(): void {
  registerDefaults();
  const restored = restoreInstances();
  if (restored.length > 0) {
    emitAgentEvent({
      type: "intent_analysis",
      intentType: "scenario_restore",
      text: `Restored ${restored.length} paused scenario(s) from previous session`,
    });
  }
}
