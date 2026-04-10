/**
 * Workflow Templates — 业务角色工作流引擎
 * 内置多种业务流程模板
 *
 * WorkflowTemplate: 工作流模板定义
 * WorkflowStep: 每一步的角色/动作/输入输出
 */

export interface WorkflowStep {
  role: string;
  action: string;
  input: string;
  output: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export type WorkflowInstanceStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowInstance {
  instanceId: string;
  templateId: string;
  currentStep: number;
  status: WorkflowInstanceStatus;
  startedAt: number;
  completedAt: number | null;
  stepResults: Record<number, string>;
}

/** Built-in workflow templates. */
const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "product_launch",
    name: "产品发布 / Product Launch",
    description: "从需求到部署的完整产品交付流程",
    steps: [
      { role: "product", action: "define_requirements", input: "business_goal", output: "prd_document" },
      { role: "ux_designer", action: "design_ux", input: "prd_document", output: "design_spec" },
      { role: "developer", action: "implement", input: "design_spec", output: "source_code" },
      { role: "tester", action: "test", input: "source_code", output: "test_report" },
      { role: "devops", action: "deploy", input: "test_report", output: "deployment_status" },
    ],
  },
  {
    id: "code_review_flow",
    name: "代码审查 / Code Review Flow",
    description: "开发→审查→测试的代码质量保障流程",
    steps: [
      { role: "developer", action: "write_code", input: "task_description", output: "pull_request" },
      { role: "code_reviewer", action: "review", input: "pull_request", output: "review_feedback" },
      { role: "tester", action: "verify", input: "review_feedback", output: "test_result" },
    ],
  },
  {
    id: "content_publish",
    name: "内容发布 / Content Publish",
    description: "内容创作→合规审核→发布的完整流程",
    steps: [
      { role: "content_ops", action: "create_content", input: "content_brief", output: "draft" },
      { role: "legal_compliance", action: "compliance_review", input: "draft", output: "compliance_report" },
      { role: "ops_director", action: "publish", input: "compliance_report", output: "publish_status" },
    ],
  },
  {
    id: "incident_response",
    name: "事件响应 / Incident Response",
    description: "安全事件检测→评估→修复→复盘",
    steps: [
      { role: "security", action: "detect_and_assess", input: "alert", output: "assessment_report" },
      { role: "developer", action: "hotfix", input: "assessment_report", output: "patch" },
      { role: "devops", action: "deploy_fix", input: "patch", output: "deployment_status" },
      { role: "risk_analyst", action: "post_mortem", input: "deployment_status", output: "post_mortem_report" },
    ],
  },
  {
    id: "data_pipeline",
    name: "数据管线 / Data Pipeline",
    description: "数据采集→分析→可视化→决策",
    steps: [
      { role: "data_analyst", action: "collect_data", input: "data_source", output: "raw_data" },
      { role: "data_analyst", action: "analyze", input: "raw_data", output: "analysis_report" },
      { role: "product", action: "make_decision", input: "analysis_report", output: "action_plan" },
    ],
  },
  {
    id: "requirement_analysis",
    name: "需求分析 / Requirement Analysis",
    description: "需求收集→竞品分析→方案评估→PRD输出",
    steps: [
      { role: "product", action: "gather_requirements", input: "stakeholder_input", output: "requirement_list" },
      { role: "researcher", action: "competitive_analysis", input: "requirement_list", output: "market_report" },
      { role: "architect", action: "technical_assessment", input: "market_report", output: "feasibility_report" },
      { role: "product", action: "write_prd", input: "feasibility_report", output: "prd_document" },
    ],
  },
  {
    id: "data_report",
    name: "数据报告 / Data Report",
    description: "数据采集→清洗分析→可视化→报告生成",
    steps: [
      { role: "data_analyst", action: "collect_data", input: "data_source", output: "raw_data" },
      { role: "data_analyst", action: "clean_and_analyze", input: "raw_data", output: "analysis_result" },
      { role: "ux_designer", action: "create_visualization", input: "analysis_result", output: "charts" },
      { role: "writer", action: "generate_report", input: "charts", output: "final_report" },
    ],
  },
];

const _templates = new Map<string, WorkflowTemplate>();
const _instances = new Map<string, WorkflowInstance>();
let _instanceCounter = 0;

/** Initialize with built-in templates. */
export function initWorkflows(): void {
  for (const t of BUILTIN_TEMPLATES) {
    _templates.set(t.id, t);
  }
}

/** Get all available templates. */
export function getTemplates(): WorkflowTemplate[] {
  return Array.from(_templates.values());
}

/** Get a specific template by ID. */
export function getTemplate(id: string): WorkflowTemplate | null {
  return _templates.get(id) ?? null;
}

/** Register a custom template. */
export function registerTemplate(template: WorkflowTemplate): void {
  _templates.set(template.id, template);
}

/** Start a new workflow instance from a template. */
export function startWorkflow(templateId: string): WorkflowInstance | null {
  const template = _templates.get(templateId);
  if (!template) return null;
  _instanceCounter += 1;
  const instance: WorkflowInstance = {
    instanceId: `wf_${Date.now().toString(36)}_${_instanceCounter}`,
    templateId,
    currentStep: 0,
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
    stepResults: {},
  };
  _instances.set(instance.instanceId, instance);
  return instance;
}

/** Advance a workflow instance to the next step. */
export function advanceWorkflow(instanceId: string, stepResult: string): WorkflowInstance | null {
  const instance = _instances.get(instanceId);
  if (!instance || instance.status !== "running") return null;
  const template = _templates.get(instance.templateId);
  if (!template) return null;

  instance.stepResults[instance.currentStep] = stepResult;
  instance.currentStep += 1;

  if (instance.currentStep >= template.steps.length) {
    instance.status = "completed";
    instance.completedAt = Date.now();
  }
  return instance;
}

/** Get a workflow instance. */
export function getWorkflowInstance(instanceId: string): WorkflowInstance | null {
  return _instances.get(instanceId) ?? null;
}

/** Get all workflow instances. */
export function getAllWorkflowInstances(): WorkflowInstance[] {
  return Array.from(_instances.values()).sort((a, b) => b.startedAt - a.startedAt);
}

/** Reset all state (for testing). */
export function resetWorkflows(): void {
  _templates.clear();
  _instances.clear();
  _instanceCounter = 0;
}
