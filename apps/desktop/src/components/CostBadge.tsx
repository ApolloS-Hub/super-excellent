/**
 * CostBadge — displays cumulative cost and token count for the current conversation.
 * Inspired by Claude Code and Hive context usage bars.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Group, Text, Badge, Tooltip, useMantineColorScheme,
} from "@mantine/core";
import { getConversationUsage, formatCost, formatTokens } from "../lib/cost-tracker";

interface CostBadgeProps {
  conversationId: string | null;
  /** Inline mode for chat header — compact display */
  compact?: boolean;
}

export default function CostBadge({ conversationId, compact }: CostBadgeProps) {
  const [totalCost, setTotalCost] = useState(0);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    const usage = await getConversationUsage(conversationId);
    if (usage) {
      setTotalCost(usage.totalCost);
      setInputTokens(usage.totalInputTokens);
      setOutputTokens(usage.totalOutputTokens);
    }
  }, [conversationId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const total = inputTokens + outputTokens;
  if (total === 0 && totalCost === 0) return null;

  const tooltipContent = [
    `输入: ${formatTokens(inputTokens)} tokens`,
    `输出: ${formatTokens(outputTokens)} tokens`,
    `费用: ${formatCost(totalCost)}`,
  ].join("\n");

  if (compact) {
    return (
      <Tooltip label={tooltipContent} multiline withArrow>
        <Badge
          size="xs"
          variant="light"
          color={isDark ? "gray" : "dark"}
          style={{ cursor: "default", fontVariantNumeric: "tabular-nums" }}
        >
          💰 {formatCost(totalCost)} · {formatTokens(total)}
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={tooltipContent} multiline withArrow>
      <Group gap={6} style={{ cursor: "default" }}>
        <Badge size="sm" variant="light" color="yellow" leftSection="💰">
          {formatCost(totalCost)}
        </Badge>
        <Badge size="sm" variant="light" color="blue" leftSection="📊">
          {formatTokens(total)} tokens
        </Badge>
        <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
          ({formatTokens(inputTokens)} in / {formatTokens(outputTokens)} out)
        </Text>
      </Group>
    </Tooltip>
  );
}
