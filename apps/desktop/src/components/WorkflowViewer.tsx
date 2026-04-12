/**
 * WorkflowViewer — SVG-based workflow visualization
 * Shows role nodes connected by arrows with status + content summaries
 * Supports 5 built-in templates and real-time status updates
 */
import { useState, useEffect, useMemo } from "react";
import {
  Stack, Text, Paper, Group, Badge, Button, Select,
  ScrollArea, useMantineColorScheme,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  getTemplates, getAllWorkflowInstances, startWorkflow,
  type WorkflowTemplate, type WorkflowInstance,
} from "../lib/workflows";
import { getTeamConfig, type Worker as TeamWorker } from "../lib/team";

// ═══════════ Types ═══════════

type NodeStatus = "idle" | "working" | "done" | "error";

interface WorkflowNode {
  role: string;
  action: string;
  status: NodeStatus;
  emoji: string;
  label: string;
  result?: string;
}

interface WorkflowEdge {
  from: number;
  to: number;
  label: string;
}

// ═══════════ Role emoji mapping ═══════════

const ROLE_EMOJI: Record<string, string> = {
  product: "📋", architect: "🏗️", developer: "💻", frontend: "🎨",
  code_reviewer: "🔍", tester: "🧪", devops: "🚀", security: "🔒",
  writer: "✍️", researcher: "🔬", ux_designer: "🎯", data_analyst: "📊",
  ops_director: "👔", growth_hacker: "📈", content_ops: "📝",
  legal_compliance: "⚖️", financial_analyst: "💰", project_manager: "📌",
  customer_support: "🎧", risk_analyst: "🛡️",
};

const ROLE_LABEL_KEYS: Record<string, string> = {
  product: "workflow.roleProduct", architect: "workflow.roleArchitect", developer: "workflow.roleDeveloper",
  frontend: "workflow.roleFrontend", code_reviewer: "workflow.roleCodeReviewer", tester: "workflow.roleTester",
  devops: "workflow.roleDevops", security: "workflow.roleSecurity", writer: "workflow.roleWriter",
  researcher: "workflow.roleResearcher", ux_designer: "workflow.roleUxDesigner", data_analyst: "workflow.roleDataAnalyst",
  ops_director: "workflow.roleOpsDirector", growth_hacker: "workflow.roleGrowthHacker", content_ops: "workflow.roleContentOps",
  legal_compliance: "workflow.roleLegalCompliance", financial_analyst: "workflow.roleFinancialAnalyst",
  project_manager: "workflow.roleProjectManager", customer_support: "workflow.roleCustomerSupport",
  risk_analyst: "workflow.roleRiskAnalyst",
};

// ═══════════ SVG Layout Constants ═══════════

const NODE_WIDTH = 140;
const NODE_HEIGHT = 72;
const NODE_GAP_X = 60;
const NODE_PADDING_X = 40;
const NODE_PADDING_Y = 40;
const ARROW_HEAD_SIZE = 8;

// ═══════════ Helpers ═══════════

function buildGraph(template: WorkflowTemplate, instance: WorkflowInstance | null, workers: TeamWorker[], t: (key: string, opts?: Record<string, unknown>) => string): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  const workerMap = new Map(workers.map(w => [w.id, w]));

  const nodes: WorkflowNode[] = template.steps.map((step, i) => {
    let status: NodeStatus = "idle";
    if (instance) {
      if (i < instance.currentStep) status = "done";
      else if (i === instance.currentStep && instance.status === "running") status = "working";
      else if (instance.status === "failed" && i === instance.currentStep) status = "error";
    }
    // Also check live worker status
    const worker = workerMap.get(step.role);
    if (worker?.status === "working" && status === "idle") status = "working";
    if (worker?.status === "done" && status === "idle") status = "done";

    return {
      role: step.role,
      action: step.action,
      status,
      emoji: ROLE_EMOJI[step.role] || "🤖",
      label: ROLE_LABEL_KEYS[step.role] ? t(ROLE_LABEL_KEYS[step.role]) : step.role,
      result: instance?.stepResults[i],
    };
  });

  const edges: WorkflowEdge[] = template.steps.slice(0, -1).map((step, i) => ({
    from: i,
    to: i + 1,
    label: step.output.replace(/_/g, " "),
  }));

  return { nodes, edges };
}

// ═══════════ SVG Components ═══════════

function StatusColor(status: NodeStatus, isDark: boolean): string {
  switch (status) {
    case "working": return isDark ? "#3b82f6" : "#2563eb";
    case "done": return isDark ? "#22c55e" : "#16a34a";
    case "error": return isDark ? "#ef4444" : "#dc2626";
    default: return isDark ? "#6b7280" : "#9ca3af";
  }
}

function StatusBgColor(status: NodeStatus, isDark: boolean): string {
  switch (status) {
    case "working": return isDark ? "rgba(59,130,246,0.15)" : "rgba(37,99,235,0.08)";
    case "done": return isDark ? "rgba(34,197,94,0.15)" : "rgba(22,163,74,0.08)";
    case "error": return isDark ? "rgba(239,68,68,0.15)" : "rgba(220,38,38,0.08)";
    default: return isDark ? "rgba(107,114,128,0.08)" : "rgba(156,163,175,0.06)";
  }
}

function StatusLabel(status: NodeStatus, t: (key: string) => string): string {
  switch (status) {
    case "working": return t("workflow.statusWorking");
    case "done": return t("workflow.statusDone");
    case "error": return t("workflow.statusError");
    default: return t("workflow.statusIdle");
  }
}

function WorkflowSVG({ nodes, edges, isDark, t }: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isDark: boolean;
  t: (key: string) => string;
}) {
  const totalWidth = nodes.length * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X + NODE_PADDING_X * 2;
  const totalHeight = NODE_HEIGHT + NODE_PADDING_Y * 2 + 28; // extra for edge labels

  const textColor = isDark ? "#e5e7eb" : "#1f2937";
  const dimColor = isDark ? "#9ca3af" : "#6b7280";

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      style={{ display: "block", maxWidth: "100%", minHeight: 120 }}
    >
      {/* Edges (arrows) */}
      {edges.map((edge, i) => {
        const x1 = NODE_PADDING_X + edge.from * (NODE_WIDTH + NODE_GAP_X) + NODE_WIDTH;
        const y1 = NODE_PADDING_Y + NODE_HEIGHT / 2;
        const x2 = NODE_PADDING_X + edge.to * (NODE_WIDTH + NODE_GAP_X);
        const y2 = y1;
        const midX = (x1 + x2) / 2;
        const sourceNode = nodes[edge.from];
        const arrowColor = sourceNode.status === "done"
          ? StatusColor("done", isDark)
          : isDark ? "#4b5563" : "#9ca3af";

        return (
          <g key={`edge-${i}`}>
            {/* Line */}
            <line
              x1={x1} y1={y1} x2={x2 - ARROW_HEAD_SIZE} y2={y2}
              stroke={arrowColor}
              strokeWidth={2}
              strokeDasharray={sourceNode.status === "done" ? "none" : "6,4"}
            />
            {/* Arrow head */}
            <polygon
              points={`${x2},${y2} ${x2 - ARROW_HEAD_SIZE},${y2 - ARROW_HEAD_SIZE / 2} ${x2 - ARROW_HEAD_SIZE},${y2 + ARROW_HEAD_SIZE / 2}`}
              fill={arrowColor}
            />
            {/* Label */}
            <text
              x={midX} y={y1 - 10}
              textAnchor="middle"
              fontSize={9}
              fill={dimColor}
              fontFamily="system-ui, sans-serif"
            >
              {edge.label.length > 16 ? edge.label.slice(0, 14) + "..." : edge.label}
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((node, i) => {
        const x = NODE_PADDING_X + i * (NODE_WIDTH + NODE_GAP_X);
        const y = NODE_PADDING_Y;
        const borderColor = StatusColor(node.status, isDark);
        const bgColor = StatusBgColor(node.status, isDark);

        return (
          <g key={`node-${i}`}>
            {/* Working pulse animation */}
            {node.status === "working" && (
              <rect
                x={x - 3} y={y - 3}
                width={NODE_WIDTH + 6} height={NODE_HEIGHT + 6}
                rx={12} ry={12}
                fill="none"
                stroke={borderColor}
                strokeWidth={1.5}
                opacity={0.4}
              >
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
              </rect>
            )}
            {/* Node background */}
            <rect
              x={x} y={y}
              width={NODE_WIDTH} height={NODE_HEIGHT}
              rx={10} ry={10}
              fill={bgColor}
              stroke={borderColor}
              strokeWidth={node.status === "working" ? 2.5 : 1.5}
            />
            {/* Emoji */}
            <text
              x={x + 14} y={y + 28}
              fontSize={18}
              fontFamily="system-ui, sans-serif"
            >
              {node.emoji}
            </text>
            {/* Role name */}
            <text
              x={x + 36} y={y + 24}
              fontSize={11}
              fontWeight={600}
              fill={textColor}
              fontFamily="system-ui, sans-serif"
            >
              {node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label}
            </text>
            {/* Action */}
            <text
              x={x + 36} y={y + 40}
              fontSize={9}
              fill={dimColor}
              fontFamily="system-ui, sans-serif"
            >
              {node.action.replace(/_/g, " ")}
            </text>
            {/* Status badge */}
            <rect
              x={x + 8} y={y + NODE_HEIGHT - 20}
              width={NODE_WIDTH - 16} height={14}
              rx={7} ry={7}
              fill={borderColor}
              opacity={node.status === "idle" ? 0.2 : 0.3}
            />
            <text
              x={x + NODE_WIDTH / 2} y={y + NODE_HEIGHT - 9}
              textAnchor="middle"
              fontSize={8}
              fontWeight={500}
              fill={node.status === "idle" ? dimColor : borderColor}
              fontFamily="system-ui, sans-serif"
            >
              {StatusLabel(node.status, t)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════ Template Selector ═══════════

const TEMPLATE_LABELS: Record<string, string> = {
  product_launch: "🚀 产品发布",
  code_review_flow: "🔍 代码审查",
  content_publish: "📝 内容发布",
  incident_response: "🚨 事件响应",
  data_pipeline: "📊 数据管线",
  requirement_analysis: "📋 需求分析",
  data_report: "📈 数据报告",
};

// ═══════════ Main Component ═══════════

export default function WorkflowViewer() {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [workers, setWorkers] = useState<TeamWorker[]>([]);

  // Load templates + instances + workers
  useEffect(() => {
    const refresh = () => {
      const tmpl = getTemplates();
      setTemplates(tmpl);
      setInstances(getAllWorkflowInstances());
      setWorkers([...getTeamConfig().workers]);
      if (!selectedTemplateId && tmpl.length > 0) {
        setSelectedTemplateId(tmpl[0].id);
      }
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [selectedTemplateId]);

  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  // Find the latest instance for the selected template
  const activeInstance = useMemo(
    () => instances.find(ins => ins.templateId === selectedTemplateId && ins.status === "running")
      || instances.find(ins => ins.templateId === selectedTemplateId) || null,
    [instances, selectedTemplateId],
  );

  const graph = useMemo(() => {
    if (!selectedTemplate) return { nodes: [], edges: [] };
    return buildGraph(selectedTemplate, activeInstance, workers);
  }, [selectedTemplate, activeInstance, workers]);

  const templateSelectData = useMemo(
    () => templates.map(t => ({
      value: t.id,
      label: TEMPLATE_LABELS[t.id] || t.name,
    })),
    [templates],
  );

  const handleStart = () => {
    if (selectedTemplateId) {
      startWorkflow(selectedTemplateId);
    }
  };

  const runningCount = instances.filter(i => i.status === "running").length;
  const completedCount = instances.filter(i => i.status === "completed").length;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between">
        <Group gap="xs">
          <Badge variant="light" color="violet">{templates.length} 模板</Badge>
          <Badge variant="light" color="blue">{runningCount} 运行中</Badge>
          <Badge variant="light" color="green">{completedCount} 已完成</Badge>
        </Group>
        <Button size="xs" variant="light" color="violet" onClick={handleStart}
          disabled={!selectedTemplateId}>
          启动工作流
        </Button>
      </Group>

      {/* Template selector */}
      <Select
        size="xs"
        placeholder="选择工作流模板..."
        data={templateSelectData}
        value={selectedTemplateId}
        onChange={setSelectedTemplateId}
      />

      {/* Description */}
      {selectedTemplate && (
        <Text size="xs" c="dimmed">{selectedTemplate.description}</Text>
      )}

      {/* SVG Workflow Diagram */}
      {selectedTemplate && graph.nodes.length > 0 ? (
        <Paper p="sm" radius="md" withBorder style={{ overflow: "hidden" }}>
          <ScrollArea>
            <WorkflowSVG nodes={graph.nodes} edges={graph.edges} isDark={isDark} />
          </ScrollArea>
        </Paper>
      ) : (
        <Text size="xs" c="dimmed" ta="center" py="md">
          选择一个工作流模板以查看流程图
        </Text>
      )}

      {/* Step detail list */}
      {selectedTemplate && (
        <Stack gap={4}>
          <Text size="xs" fw={600} c="dimmed">步骤详情</Text>
          {selectedTemplate.steps.map((step, i) => {
            const node = graph.nodes[i];
            return (
              <Group key={i} gap="xs" wrap="nowrap">
                <Badge
                  size="xs"
                  color={node?.status === "working" ? "blue" : node?.status === "done" ? "green" : node?.status === "error" ? "red" : "gray"}
                  variant={node?.status === "working" ? "filled" : "light"}
                  style={{ minWidth: 20 }}
                >
                  {i + 1}
                </Badge>
                <Text size="xs">{ROLE_EMOJI[step.role] || "🤖"}</Text>
                <Text size="xs" fw={500}>{ROLE_LABEL[step.role] || step.role}</Text>
                <Text size="xs" c="dimmed">{step.action.replace(/_/g, " ")}</Text>
                <Text size="xs" c="dimmed" style={{ marginLeft: "auto" }}>
                  {step.input.replace(/_/g, " ")} → {step.output.replace(/_/g, " ")}
                </Text>
              </Group>
            );
          })}
        </Stack>
      )}

      {/* Instance history */}
      {instances.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" fw={600} c="dimmed">工作流实例 ({instances.length})</Text>
          <ScrollArea h={120}>
            <Stack gap={4}>
              {instances.slice(0, 20).map(ins => {
                const tmpl = templates.find(t => t.id === ins.templateId);
                return (
                  <Group key={ins.instanceId} gap="xs" wrap="nowrap">
                    <Badge size="xs" color={
                      ins.status === "running" ? "blue" : ins.status === "completed" ? "green" : ins.status === "failed" ? "red" : "gray"
                    } variant="light">
                      {ins.status}
                    </Badge>
                    <Text size="xs" fw={500}>{TEMPLATE_LABELS[ins.templateId] || tmpl?.name || ins.templateId}</Text>
                    <Text size="xs" c="dimmed">
                      步骤 {ins.currentStep}/{tmpl?.steps.length || "?"}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ marginLeft: "auto" }}>
                      {new Date(ins.startedAt).toLocaleTimeString()}
                    </Text>
                  </Group>
                );
              })}
            </Stack>
          </ScrollArea>
        </Stack>
      )}
    </Stack>
  );
}
