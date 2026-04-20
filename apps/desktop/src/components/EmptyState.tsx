/**
 * EmptyState — Welcome screen shown when a conversation has no messages.
 * Modern design with suggestion chips and team intro.
 */
import { useTranslation } from "react-i18next";
import { Box, Center, Stack, Text, Title, Group } from "@mantine/core";

interface EmptyStateProps {
  onSuggestion: (text: string) => void;
}

interface Suggestion {
  emoji: string;
  zh: string;
  en: string;
}

const SUGGESTIONS: Suggestion[] = [
  { emoji: "📊", zh: "帮我分析一份市场报告", en: "Help me analyze a market report" },
  { emoji: "✍️", zh: "起草一封客户邮件", en: "Draft a customer email" },
  { emoji: "📅", zh: "规划一下本周工作", en: "Plan this week's work" },
  { emoji: "🔍", zh: "搜索最新的 AI 新闻", en: "Search for latest AI news" },
  { emoji: "💡", zh: "给我一些新产品的灵感", en: "Brainstorm new product ideas" },
  { emoji: "📝", zh: "整理会议纪要", en: "Organize meeting notes" },
];

const TEAM_MEMBERS = [
  { emoji: "📋", zh: "产品经理", en: "Product" },
  { emoji: "💻", zh: "开发", en: "Developer" },
  { emoji: "🧪", zh: "测试", en: "Tester" },
  { emoji: "🚀", zh: "运维", en: "DevOps" },
  { emoji: "📊", zh: "数据分析", en: "Analyst" },
  { emoji: "✍️", zh: "内容运营", en: "Content" },
  { emoji: "🎧", zh: "客户支持", en: "Support" },
  { emoji: "⚖️", zh: "法务", en: "Legal" },
];

export default function EmptyState({ onSuggestion }: EmptyStateProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <Center style={{ minHeight: "70vh", padding: "24px" }}>
      <Stack gap="xl" align="center" style={{ maxWidth: 720, width: "100%" }}>
        {/* Hero */}
        <Stack gap="xs" align="center">
          <Text className="empty-hero-icon" size="xl" style={{ fontSize: 56 }}>
            ✨
          </Text>
          <Title order={2} ta="center" className="app-title" style={{ letterSpacing: "-0.02em" }}>
            {isZh ? "你的 AI 秘书团队已就绪" : "Your AI Team is Ready"}
          </Title>
          <Text c="dimmed" ta="center" size="sm" maw={460}>
            {t("chat.emptyState")}
          </Text>
        </Stack>

        {/* Team members row */}
        <Box>
          <Text size="xs" c="dimmed" ta="center" tt="uppercase" mb={8} style={{ letterSpacing: "0.1em", fontWeight: 600 }}>
            {isZh ? "你的 AI 团队" : "Your team"}
          </Text>
          <Group gap="xs" justify="center">
            {TEAM_MEMBERS.map((m) => (
              <Box
                key={m.en}
                px="sm"
                py={6}
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 20,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span>{m.emoji}</span>
                <span>{isZh ? m.zh : m.en}</span>
              </Box>
            ))}
          </Group>
        </Box>

        {/* Suggestion chips */}
        <Stack gap="sm" w="100%">
          <Text size="xs" c="dimmed" ta="center" tt="uppercase" style={{ letterSpacing: "0.1em", fontWeight: 600 }}>
            {t("chat.trySuggestions")}
          </Text>
          <Group gap="xs" justify="center">
            {SUGGESTIONS.map((s) => {
              const text = isZh ? s.zh : s.en;
              return (
                <button
                  key={text}
                  className="suggestion-chip"
                  onClick={() => onSuggestion(text)}
                  type="button"
                >
                  <span style={{ marginRight: 6 }}>{s.emoji}</span>
                  {text}
                </button>
              );
            })}
          </Group>
        </Stack>

        {/* Quick tip */}
        <Text c="dimmed" ta="center" size="xs" maw={420}>
          {isZh
            ? "提示：直接说出你的需求即可，秘书会自动调度合适的 AI 员工帮你完成。"
            : "Tip: Just describe what you need — the Secretary will dispatch the right AI workers for you."}
        </Text>
      </Stack>
    </Center>
  );
}
