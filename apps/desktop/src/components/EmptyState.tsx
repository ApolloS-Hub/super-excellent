/**
 * EmptyState — welcome screen shown when a conversation has no messages.
 *
 * Calm, focused hero — logo mark, title, subtitle, suggestion cards.
 * Team roster is shown as subtle text chips grouped by domain,
 * not as a rainbow of emoji badges.
 */
import { useTranslation } from "react-i18next";
import { Box, Center, Stack, Text, Title, Group, SimpleGrid } from "@mantine/core";
import Icon, { type IconName } from "./Icon";

interface EmptyStateProps {
  onSuggestion: (text: string) => void;
}

interface Suggestion {
  icon: IconName;
  zh: string;
  en: string;
}

const SUGGESTIONS: Suggestion[] = [
  { icon: "chart",   zh: "帮我分析一份市场报告",   en: "Analyze a market report" },
  { icon: "feather", zh: "起草一封客户邮件",       en: "Draft a customer email" },
  { icon: "book",    zh: "规划一下本周工作",       en: "Plan this week's work" },
  { icon: "globe",   zh: "搜索最新的 AI 新闻",    en: "Search for latest AI news" },
  { icon: "file",    zh: "整理会议纪要",           en: "Organize meeting notes" },
  { icon: "sliders", zh: "帮我做个 PPT",           en: "Create a presentation" },
];

const TEAM_GROUPS: Array<{ zh: string; en: string; roles: Array<{ zh: string; en: string }>; tone: string }> = [
  {
    zh: "研发", en: "Engineering", tone: "var(--accent)",
    roles: [
      { zh: "产品", en: "Product" },
      { zh: "架构", en: "Architect" },
      { zh: "开发", en: "Dev" },
      { zh: "测试", en: "QA" },
      { zh: "运维", en: "Ops" },
      { zh: "安全", en: "Security" },
    ],
  },
  {
    zh: "业务", en: "Business", tone: "oklch(62% 0.14 155)",
    roles: [
      { zh: "运营", en: "Ops" },
      { zh: "增长", en: "Growth" },
      { zh: "客服", en: "CX" },
      { zh: "法务", en: "Legal" },
      { zh: "财务", en: "Finance" },
    ],
  },
];

export default function EmptyState({ onSuggestion }: EmptyStateProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <Center className="empty-hero" style={{ padding: "28px 24px" }}>
      <Stack gap={32} align="center" style={{ maxWidth: 620, width: "100%" }}>

        {/* Hero */}
        <Stack gap={14} align="center">
          <span className="empty-hero-mark">
            <Icon name="sparkle" size={22} stroke={2} />
          </span>
          <Title order={2} ta="center" style={{ letterSpacing: "-0.02em" }}>
            {isZh ? "你的 AI 秘书团队已就绪" : "Your AI Secretary team is ready"}
          </Title>
          <Text c="dimmed" ta="center" size="sm" maw={440} style={{ lineHeight: 1.6 }}>
            {t("chat.emptyState")}
          </Text>
        </Stack>

        {/* Team roster — two groups, subtle chips */}
        <Stack gap={10} align="center" w="100%">
          {TEAM_GROUPS.map(group => (
            <Group gap={6} justify="center" key={group.en} wrap="wrap" maw={560}>
              <Text
                size="10.5px"
                fw={600}
                tt="uppercase"
                style={{ letterSpacing: "0.08em", color: group.tone, minWidth: 76, textAlign: "right" }}
              >
                {isZh ? group.zh : group.en}
              </Text>
              {group.roles.map(r => (
                <span key={r.en} className="role-chip">
                  <span className="role-chip-dot" style={{ background: group.tone }} />
                  {isZh ? r.zh : r.en}
                </span>
              ))}
            </Group>
          ))}
        </Stack>

        {/* Suggestion grid */}
        <Box w="100%">
          <Text
            size="10.5px"
            c="dimmed"
            ta="center"
            tt="uppercase"
            mb={10}
            style={{ letterSpacing: "0.1em", fontWeight: 600 }}
          >
            {t("chat.trySuggestions")}
          </Text>
          <SimpleGrid cols={2} spacing={8}>
            {SUGGESTIONS.map((s) => {
              const text = isZh ? s.zh : s.en;
              return (
                <button
                  key={text}
                  className="suggestion-chip"
                  onClick={() => onSuggestion(text)}
                  type="button"
                >
                  <span className="suggestion-chip-icon">
                    <Icon name={s.icon} size={15} />
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>{text}</span>
                </button>
              );
            })}
          </SimpleGrid>
        </Box>

        <Text c="dimmed" ta="center" size="xs" maw={400} style={{ lineHeight: 1.6, opacity: 0.75 }}>
          {isZh
            ? "直接说出需求，秘书会自动调度合适的 AI 员工。"
            : "Just describe what you need. The Secretary dispatches the right AI workers."}
        </Text>
      </Stack>
    </Center>
  );
}
