/**
 * Skill Market — 展示/安装预设 Skill 模板
 * 每个 Skill 是一个预设的工作流模板
 * 一键「安装」= 添加到可用工作流列表
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, Text, Paper, Group, Badge, Button, SimpleGrid,
  ScrollArea, useMantineColorScheme,
} from "@mantine/core";
import { registerTemplate, getTemplates, type WorkflowTemplate } from "../lib/workflows";

// ═══════════ Built-in Skills ═══════════

interface SkillDefinition {
  id: string;
  name: string;
  nameEn: string;
  emoji: string;
  description: string;
  descriptionEn: string;
  category: string;
  tags: string[];
  template: WorkflowTemplate;
}

const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    id: "skill_daily_report",
    name: "日报生成器",
    nameEn: "Daily Report Generator",
    emoji: "📊",
    description: "收集各角色的产出，汇总生成结构化日报",
    descriptionEn: "Collect outputs from each role and generate structured daily reports",
    category: "效率",
    tags: ["报告", "汇总", "日常"],
    template: {
      id: "skill_daily_report",
      name: "日报生成 / Daily Report",
      description: "收集各角色产出→汇总分析→生成日报→分发",
      steps: [
        { role: "data_analyst", action: "collect_outputs", input: "team_activities", output: "raw_data" },
        { role: "writer", action: "summarize", input: "raw_data", output: "summary_draft" },
        { role: "product", action: "review_and_finalize", input: "summary_draft", output: "daily_report" },
        { role: "content_ops", action: "distribute", input: "daily_report", output: "distribution_status" },
      ],
    },
  },
  {
    id: "skill_meeting_minutes",
    name: "会议纪要",
    nameEn: "Meeting Minutes",
    emoji: "📝",
    description: "录音转文字，提取要点，生成结构化会议纪要",
    descriptionEn: "Transcribe recording, extract key points, generate structured minutes",
    category: "协作",
    tags: ["会议", "纪要", "转录"],
    template: {
      id: "skill_meeting_minutes",
      name: "会议纪要 / Meeting Minutes",
      description: "录音转文字→提取要点→生成纪要→分发参会者",
      steps: [
        { role: "researcher", action: "transcribe_audio", input: "meeting_recording", output: "transcript" },
        { role: "data_analyst", action: "extract_key_points", input: "transcript", output: "key_points" },
        { role: "writer", action: "generate_minutes", input: "key_points", output: "meeting_minutes" },
        { role: "project_manager", action: "assign_action_items", input: "meeting_minutes", output: "action_items" },
      ],
    },
  },
  {
    id: "skill_competitive_analysis",
    name: "竞品分析",
    nameEn: "Competitive Analysis",
    emoji: "🔍",
    description: "搜索竞品信息，对比分析，生成竞品报告",
    descriptionEn: "Research competitors, compare features, generate analysis report",
    category: "市场",
    tags: ["竞品", "分析", "市场"],
    template: {
      id: "skill_competitive_analysis",
      name: "竞品分析 / Competitive Analysis",
      description: "搜索竞品→收集数据→对比分析→生成报告",
      steps: [
        { role: "researcher", action: "search_competitors", input: "target_market", output: "competitor_list" },
        { role: "data_analyst", action: "collect_metrics", input: "competitor_list", output: "comparison_data" },
        { role: "product", action: "analyze_gaps", input: "comparison_data", output: "gap_analysis" },
        { role: "writer", action: "generate_report", input: "gap_analysis", output: "competitive_report" },
      ],
    },
  },
  {
    id: "skill_content_calendar",
    name: "内容排期",
    nameEn: "Content Calendar",
    emoji: "📅",
    description: "规划一周内容，分配给角色，跟踪进度",
    descriptionEn: "Plan weekly content, assign to roles, track progress",
    category: "内容",
    tags: ["排期", "内容", "规划"],
    template: {
      id: "skill_content_calendar",
      name: "内容排期 / Content Calendar",
      description: "规划内容→分配角色→创作→审核→发布跟踪",
      steps: [
        { role: "content_ops", action: "plan_content", input: "content_strategy", output: "content_plan" },
        { role: "project_manager", action: "assign_tasks", input: "content_plan", output: "task_assignments" },
        { role: "writer", action: "create_content", input: "task_assignments", output: "content_drafts" },
        { role: "legal_compliance", action: "review", input: "content_drafts", output: "approved_content" },
        { role: "ops_director", action: "track_publication", input: "approved_content", output: "publication_status" },
      ],
    },
  },
  {
    id: "skill_data_dashboard",
    name: "数据报表",
    nameEn: "Data Dashboard",
    emoji: "📈",
    description: "从表格读数据，分析趋势，生成可视化报告",
    descriptionEn: "Read data from sheets, analyze trends, generate visual reports",
    category: "数据",
    tags: ["数据", "报表", "可视化"],
    template: {
      id: "skill_data_dashboard",
      name: "数据报表 / Data Dashboard",
      description: "读取数据→清洗分析→生成图表→输出报告",
      steps: [
        { role: "data_analyst", action: "read_data", input: "data_sources", output: "raw_data" },
        { role: "data_analyst", action: "clean_and_analyze", input: "raw_data", output: "analysis_result" },
        { role: "ux_designer", action: "design_charts", input: "analysis_result", output: "chart_designs" },
        { role: "writer", action: "compile_report", input: "chart_designs", output: "dashboard_report" },
      ],
    },
  },
];

// ═══════════ Persistence ═══════════

function getInstalledSkillIds(): Set<string> {
  try {
    const raw = localStorage.getItem("installed-skills");
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveInstalledSkillIds(ids: Set<string>): void {
  try { localStorage.setItem("installed-skills", JSON.stringify([...ids])); } catch {}
}

// ═══════════ Component ═══════════

interface SkillMarketPageProps {
  onBack: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  "效率": "blue",
  "协作": "violet",
  "市场": "orange",
  "内容": "green",
  "数据": "cyan",
};

const CATEGORY_I18N_KEYS: Record<string, string> = {
  "效率": "skills.catEfficiency",
  "协作": "skills.catCollaboration",
  "市场": "skills.catMarket",
  "内容": "skills.catContent",
  "数据": "skills.catData",
};

const TAG_I18N_KEYS: Record<string, string> = {
  "报告": "skills.tagReport",
  "汇总": "skills.tagSummary",
  "日常": "skills.tagDaily",
  "会议": "skills.tagMeeting",
  "纪要": "skills.tagMinutes",
  "转录": "skills.tagTranscription",
  "竞品": "skills.tagCompetitor",
  "分析": "skills.tagAnalysis",
  "市场": "skills.tagMarket",
  "排期": "skills.tagSchedule",
  "内容": "skills.tagContent",
  "规划": "skills.tagPlanning",
  "数据": "skills.tagData",
  "报表": "skills.tagDashboard",
  "可视化": "skills.tagVisualization",
};

function SkillMarketPage({ onBack }: SkillMarketPageProps) {
  const { t } = useTranslation();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const [installed, setInstalled] = useState<Set<string>>(() => getInstalledSkillIds());
  const [filter, setFilter] = useState<string | null>(null);

  // Check what templates are already registered
  useEffect(() => {
    const existing = getTemplates().map(t => t.id);
    const existingSet = new Set(existing);
    // Auto-mark already-registered templates
    let changed = false;
    for (const skill of BUILTIN_SKILLS) {
      if (existingSet.has(skill.id) && !installed.has(skill.id)) {
        installed.add(skill.id);
        changed = true;
      }
    }
    if (changed) {
      setInstalled(new Set(installed));
      saveInstalledSkillIds(installed);
    }
  }, []);

  const handleInstall = useCallback((skill: SkillDefinition) => {
    registerTemplate(skill.template);
    const next = new Set(installed);
    next.add(skill.id);
    setInstalled(next);
    saveInstalledSkillIds(next);
  }, [installed]);

  const handleUninstall = useCallback((skill: SkillDefinition) => {
    const next = new Set(installed);
    next.delete(skill.id);
    setInstalled(next);
    saveInstalledSkillIds(next);
  }, [installed]);

  const categories = [...new Set(BUILTIN_SKILLS.map(s => s.category))];
  const filtered = filter
    ? BUILTIN_SKILLS.filter(s => s.category === filter)
    : BUILTIN_SKILLS;

  return (
    <ScrollArea style={{ height: "calc(100vh - 70px)" }} offsetScrollbars>
    <Stack maw={900} mx="auto" pb="xl">
      <Group justify="space-between">
        <Group gap="xs">
          <Text size="xl" fw={700}>{`🛒 ${t("skills.title")}`}</Text>
          <Badge variant="light" color="blue">{t("skills.skillCount", { count: BUILTIN_SKILLS.length })}</Badge>
          <Badge variant="light" color="green">{t("skills.installedCount", { count: installed.size })}</Badge>
        </Group>
        <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
      </Group>

      <Text size="sm" c="dimmed">
        {t("skills.subtitle")}
      </Text>

      {/* Category filter */}
      <Group gap="xs">
        <Badge
          variant={filter === null ? "filled" : "light"}
          color="gray"
          style={{ cursor: "pointer" }}
          onClick={() => setFilter(null)}
        >
          {t("skills.all")}
        </Badge>
        {categories.map(cat => (
          <Badge
            key={cat}
            variant={filter === cat ? "filled" : "light"}
            color={CATEGORY_COLORS[cat] || "gray"}
            style={{ cursor: "pointer" }}
            onClick={() => setFilter(filter === cat ? null : cat)}
          >
            {t(CATEGORY_I18N_KEYS[cat] || cat)}
          </Badge>
        ))}
      </Group>

      {/* Skill cards */}
      <ScrollArea>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {filtered.map(skill => {
            const isInstalled = installed.has(skill.id);
            return (
              <Paper
                key={skill.id}
                p="md"
                radius="md"
                withBorder
                style={{
                  borderColor: isInstalled
                    ? `var(--mantine-color-green-${isDark ? "8" : "3"})`
                    : undefined,
                  borderWidth: isInstalled ? 2 : undefined,
                }}
              >
                <Group justify="space-between" mb="xs" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap">
                    <Text size="xl">{skill.emoji}</Text>
                    <Stack gap={0}>
                      <Text size="sm" fw={600}>{t(`skills.${skill.id}.name`)}</Text>
                      <Text size="xs" c="dimmed">{skill.nameEn}</Text>
                    </Stack>
                  </Group>
                  <Badge size="xs" color={CATEGORY_COLORS[skill.category] || "gray"} variant="light">
                    {t(CATEGORY_I18N_KEYS[skill.category] || skill.category)}
                  </Badge>
                </Group>

                <Text size="xs" c="dimmed" mb="sm">{t(`skills.${skill.id}.description`)}</Text>

                {/* Workflow steps preview */}
                <Group gap={4} mb="sm" wrap="wrap">
                  {skill.template.steps.map((step, i) => (
                    <Group key={i} gap={2} wrap="nowrap">
                      {i > 0 && <Text size="xs" c="dimmed">→</Text>}
                      <Badge size="xs" variant="outline" color="gray">
                        {step.role.replace(/_/g, " ")}
                      </Badge>
                    </Group>
                  ))}
                </Group>

                <Group gap="xs" wrap="wrap">
                  {skill.tags.map(tag => (
                    <Badge key={tag} size="xs" variant="light" color="gray">#{t(TAG_I18N_KEYS[tag] || tag)}</Badge>
                  ))}
                </Group>

                <Group mt="sm">
                  {isInstalled ? (
                    <Group gap="xs">
                      <Badge color="green" variant="light">{`✅ ${t("skills.installed")}`}</Badge>
                      <Button size="xs" variant="subtle" color="red"
                        onClick={() => handleUninstall(skill)}>
                        {t("skills.uninstall")}
                      </Button>
                    </Group>
                  ) : (
                    <Button size="xs" variant="light" color="blue"
                      onClick={() => handleInstall(skill)}>
                      {`📥 ${t("skills.install")}`}
                    </Button>
                  )}
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      </ScrollArea>
    </Stack>
    </ScrollArea>
  );
}

export default SkillMarketPage;
