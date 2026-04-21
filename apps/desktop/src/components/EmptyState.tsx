/**
 * EmptyState — Welcome screen shown when a conversation has no messages.
 *
 * Design critique applied (our own design-critique skill):
 * - Visual Hierarchy: gradient hero → section headers → suggestion cards (3 levels)
 * - Typography: serif display title, medium section labels, body suggestion text
 * - Color: team badges color-coded by role type (not all gray)
 * - Layout: 2-column suggestion grid with generous padding
 * - Content: bilingual, clear CTA, minimal tip at bottom
 */
import { useTranslation } from "react-i18next";
import { Box, Center, Stack, Text, Title, Group, SimpleGrid } from "@mantine/core";

interface EmptyStateProps {
  onSuggestion: (text: string) => void;
}

interface Suggestion {
  emoji: string;
  zh: string;
  en: string;
  /** Subtle color tint for the card border on hover */
  color: string;
}

const SUGGESTIONS: Suggestion[] = [
  { emoji: "📊", zh: "帮我分析一份市场报告", en: "Analyze a market report", color: "indigo" },
  { emoji: "✍️", zh: "起草一封客户邮件", en: "Draft a customer email", color: "violet" },
  { emoji: "📅", zh: "规划一下本周工作", en: "Plan this week's work", color: "teal" },
  { emoji: "🔍", zh: "搜索最新的 AI 新闻", en: "Search for latest AI news", color: "blue" },
  { emoji: "📝", zh: "整理会议纪要", en: "Organize meeting notes", color: "orange" },
  { emoji: "📋", zh: "帮我做个 PPT", en: "Create a presentation", color: "grape" },
];

const TEAM_MEMBERS = [
  { emoji: "📋", zh: "产品", en: "Product", color: "blue" },
  { emoji: "💻", zh: "开发", en: "Dev", color: "indigo" },
  { emoji: "🧪", zh: "测试", en: "QA", color: "teal" },
  { emoji: "🚀", zh: "运维", en: "Ops", color: "orange" },
  { emoji: "📊", zh: "数据", en: "Data", color: "cyan" },
  { emoji: "✍️", zh: "运营", en: "Ops", color: "grape" },
  { emoji: "🎧", zh: "客服", en: "CX", color: "pink" },
  { emoji: "🎨", zh: "设计", en: "UX", color: "violet" },
  { emoji: "⚖️", zh: "法务", en: "Legal", color: "gray" },
  { emoji: "💰", zh: "财务", en: "Fin", color: "yellow" },
];

export default function EmptyState({ onSuggestion }: EmptyStateProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <Center style={{ minHeight: "72vh", padding: "32px 24px" }}>
      <Stack gap={36} align="center" style={{ maxWidth: 640, width: "100%" }}>

        {/* ── Hero: big icon + serif title + subtitle ── */}
        <Stack gap={8} align="center">
          <div style={{
            fontSize: 48,
            lineHeight: 1,
            animation: "pulse 3s ease-in-out infinite",
          }}>
            ✨
          </div>
          <Title
            order={2}
            ta="center"
            className="app-title"
            style={{ fontSize: "1.75rem", letterSpacing: "-0.02em", lineHeight: 1.3 }}
          >
            {isZh ? "你的 AI 秘书团队已就绪" : "Your AI Secretary Team"}
          </Title>
          <Text c="dimmed" ta="center" size="sm" maw={420} style={{ lineHeight: 1.6 }}>
            {t("chat.emptyState")}
          </Text>
        </Stack>

        {/* ── Team roster: color-coded role badges ── */}
        <Box>
          <Text
            size="10px"
            c="dimmed"
            ta="center"
            tt="uppercase"
            mb={10}
            style={{ letterSpacing: "0.12em", fontWeight: 700 }}
          >
            {isZh ? "你的 AI 团队" : "Your team"}
          </Text>
          <Group gap={6} justify="center">
            {TEAM_MEMBERS.map((m) => (
              <Box
                key={m.en}
                px={10}
                py={5}
                style={{
                  border: `1px solid var(--mantine-color-${m.color}-2)`,
                  background: `var(--mantine-color-${m.color}-0)`,
                  borderRadius: 16,
                  fontSize: 11,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  color: `var(--mantine-color-${m.color}-7)`,
                  transition: "transform 0.15s ease",
                }}
              >
                <span style={{ fontSize: 13 }}>{m.emoji}</span>
                <span>{isZh ? m.zh : m.en}</span>
              </Box>
            ))}
          </Group>
        </Box>

        {/* ── Suggestions: 2-column grid with card-style chips ── */}
        <Box w="100%">
          <Text
            size="10px"
            c="dimmed"
            ta="center"
            tt="uppercase"
            mb={12}
            style={{ letterSpacing: "0.12em", fontWeight: 700 }}
          >
            {t("chat.trySuggestions")}
          </Text>
          <SimpleGrid cols={2} spacing="sm">
            {SUGGESTIONS.map((s) => {
              const text = isZh ? s.zh : s.en;
              return (
                <button
                  key={text}
                  className="suggestion-chip"
                  onClick={() => onSuggestion(text)}
                  type="button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{
                    fontSize: 20,
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    background: `var(--mantine-color-${s.color}-0)`,
                  }}>
                    {s.emoji}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>{text}</span>
                </button>
              );
            })}
          </SimpleGrid>
        </Box>

        {/* ── Tip: subtle bottom hint ── */}
        <Text c="dimmed" ta="center" size="xs" maw={400} style={{ lineHeight: 1.6, opacity: 0.7 }}>
          {isZh
            ? "直接说出需求，秘书会自动调度合适的 AI 员工。"
            : "Just describe what you need. The Secretary dispatches the right AI workers."}
        </Text>
      </Stack>
    </Center>
  );
}
