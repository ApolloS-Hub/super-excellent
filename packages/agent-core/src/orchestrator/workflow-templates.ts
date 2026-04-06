/**
 * Role-specific workflow templates.
 *
 * Each template describes the default steps a role follows when it receives a
 * task from the Secretary. The Secretary can override or trim steps based on the
 * specific request, but the template serves as a reliable baseline so that
 * business roles (not just engineering) produce structured, auditable output.
 */

export interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  outputArtifact?: string;
}

export interface WorkflowTemplate {
  roleId: string;
  name: string;
  steps: WorkflowStep[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    roleId: "operations-director",
    name: "运营方案",
    steps: [
      { id: "context", label: "背景分析", description: "明确业务背景、目标、当前数据基线", outputArtifact: "context.md" },
      { id: "strategy", label: "策略制定", description: "制定 OKR、KPI 体系和执行策略", outputArtifact: "strategy.md" },
      { id: "plan", label: "执行计划", description: "拆解为可执行的周/月计划，标注负责人和里程碑", outputArtifact: "plan.md" },
      { id: "budget", label: "预算估算", description: "列出各项资源需求和预算", outputArtifact: "budget.md" },
      { id: "risk", label: "风险评估", description: "识别 Top 3 风险并给出应对方案" },
    ],
  },
  {
    roleId: "growth-hacker",
    name: "增长实验",
    steps: [
      { id: "hypothesis", label: "假设定义", description: "明确增长假设和预期提升指标", outputArtifact: "hypothesis.md" },
      { id: "design", label: "实验设计", description: "设计 A/B 测试方案：变量、样本量、周期、成功标准", outputArtifact: "experiment-design.md" },
      { id: "implement", label: "实施", description: "落地实验所需的产品/技术改动" },
      { id: "measure", label: "数据收集", description: "收集实验数据，对比实验组与对照组" },
      { id: "conclude", label: "结论 & 迭代", description: "得出结论，决定推广/迭代/放弃，记录 learnings", outputArtifact: "experiment-result.md" },
    ],
  },
  {
    roleId: "content-operations",
    name: "内容排期",
    steps: [
      { id: "audit", label: "内容审计", description: "盘点现有内容资产，识别 gaps", outputArtifact: "content-audit.md" },
      { id: "calendar", label: "内容日历", description: "按周/月排期，标注主题、平台、负责人", outputArtifact: "content-calendar.md" },
      { id: "draft", label: "内容创作", description: "撰写文案 / 脚本 / 视觉素材简报" },
      { id: "review", label: "审核发布", description: "内部审核 → 定时发布 → 分发" },
      { id: "analytics", label: "效果分析", description: "追踪阅读/互动/转化，输出优化建议", outputArtifact: "content-report.md" },
    ],
  },
  {
    roleId: "legal-compliance",
    name: "合规审查",
    steps: [
      { id: "scope", label: "范围界定", description: "明确审查对象（功能/文案/数据处理流程）和适用法规" },
      { id: "checklist", label: "合规检查", description: "逐项核查 GDPR / CCPA / 个保法 / 行业法规", outputArtifact: "compliance-checklist.md" },
      { id: "findings", label: "风险发现", description: "列出风险点、法规依据、严重等级", outputArtifact: "findings.md" },
      { id: "remediation", label: "整改建议", description: "给出具体整改方案和期限" },
      { id: "signoff", label: "签署确认", description: "出具合规意见，等待负责人确认", outputArtifact: "compliance-report.md" },
    ],
  },
  {
    roleId: "finance-analyst",
    name: "财务分析",
    steps: [
      { id: "data", label: "数据收集", description: "收集收入/成本/用户/转化等原始数据" },
      { id: "model", label: "财务建模", description: "搭建收入预测 / 成本结构 / 盈亏平衡模型", outputArtifact: "financial-model.md" },
      { id: "analysis", label: "分析解读", description: "关键指标趋势、异常、对标分析" },
      { id: "recommendation", label: "建议", description: "基于数据给出可操作建议", outputArtifact: "finance-report.md" },
      { id: "review", label: "复核", description: "校验假设敏感性，确认数据来源准确" },
    ],
  },
  {
    roleId: "project-manager",
    name: "项目管理",
    steps: [
      { id: "kickoff", label: "立项", description: "确认目标、范围、干系人、成功标准", outputArtifact: "project-charter.md" },
      { id: "wbs", label: "WBS 拆解", description: "任务拆解 + 依赖关系 + 时间估算", outputArtifact: "wbs.md" },
      { id: "track", label: "进度跟踪", description: "每日/周同步进度，识别风险和阻塞" },
      { id: "risk", label: "风险管理", description: "维护风险登记册，更新应急预案", outputArtifact: "risk-register.md" },
      { id: "retro", label: "复盘", description: "里程碑结束后复盘，提炼 learnings", outputArtifact: "retro.md" },
    ],
  },
  {
    roleId: "customer-support",
    name: "客户支持",
    steps: [
      { id: "triage", label: "分类分级", description: "对问题/反馈按类型和优先级分级" },
      { id: "resolve", label: "问题处理", description: "查找解决方案，回复用户，必要时升级" },
      { id: "faq", label: "知识库更新", description: "把高频问题沉淀为 FAQ", outputArtifact: "faq-update.md" },
      { id: "feedback", label: "反馈聚合", description: "汇总客户反馈，提炼 Top 问题给产品", outputArtifact: "feedback-summary.md" },
      { id: "satisfaction", label: "满意度追踪", description: "发送 NPS/CSAT 调研，追踪趋势" },
    ],
  },
  {
    roleId: "risk-analyst",
    name: "风控分析",
    steps: [
      { id: "identify", label: "风险识别", description: "系统性扫描业务/技术/运营面的潜在风险" },
      { id: "assess", label: "风险评估", description: "量化概率 × 影响，建立风险矩阵", outputArtifact: "risk-matrix.md" },
      { id: "rules", label: "规则设计", description: "编写风控规则、阈值、告警条件", outputArtifact: "risk-rules.md" },
      { id: "monitor", label: "监控部署", description: "部署规则到监控系统，验证误报率" },
      { id: "report", label: "风控报告", description: "输出周期性风控报告和处置建议", outputArtifact: "risk-report.md" },
    ],
  },
];

export function getTemplateForRole(roleId: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.roleId === roleId);
}

export function getAllTemplates(): WorkflowTemplate[] {
  return [...WORKFLOW_TEMPLATES];
}
