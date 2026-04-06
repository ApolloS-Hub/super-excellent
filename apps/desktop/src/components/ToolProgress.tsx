/**
 * ToolProgress — tool execution progress component.
 * Shows each tool call with name, param summary, elapsed time, and status.
 * Collapsible detail view.
 */
import { useState, useEffect, useRef, memo } from "react";
import {
  Box, Text, Group, Badge, Stack, UnstyledButton,
  Progress, Paper, useMantineColorScheme, Collapse,
} from "@mantine/core";

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallEntry {
  id: string;
  name: string;
  input: string;
  status: ToolCallStatus;
  startedAt: number;
  endedAt?: number;
  output?: string;
  percent?: number;
  progressMsg?: string;
}

interface ToolProgressProps {
  calls: ToolCallEntry[];
}

const STATUS_CONFIG: Record<ToolCallStatus, { color: string; icon: string; label: string }> = {
  running: { color: "blue", icon: "🔄", label: "运行中" },
  success: { color: "green", icon: "✅", label: "成功" },
  error: { color: "red", icon: "❌", label: "失败" },
};

function paramSummary(input: string): string {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed);
      if (entries.length === 0) return "";
      return entries
        .slice(0, 3)
        .map(([k, v]) => {
          const val = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}=${val.length > 40 ? val.slice(0, 37) + "..." : val}`;
        })
        .join(", ");
    }
  } catch { /* not JSON */ }
  return input.length > 60 ? input.slice(0, 57) + "..." : input;
}

const ToolCallItem = memo(function ToolCallItem({ call }: { call: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const elapsed = useElapsed(call);
  const cfg = STATUS_CONFIG[call.status];
  const summary = paramSummary(call.input);

  return (
    <Paper
      p="xs"
      radius="sm"
      bg={isDark ? "dark.7" : "gray.0"}
      withBorder
      style={{ borderColor: isDark ? "var(--mantine-color-dark-5)" : "var(--mantine-color-gray-3)" }}
    >
      <UnstyledButton onClick={() => setExpanded(v => !v)} w="100%">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Text size="xs">{expanded ? "▼" : "▶"}</Text>
            <Badge size="xs" variant="light" color={cfg.color} leftSection={cfg.icon}>
              {call.name}
            </Badge>
            {summary && (
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 200 }}>
                {summary}
              </Text>
            )}
          </Group>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
              {elapsed}
            </Text>
            <Badge size="xs" variant="dot" color={cfg.color}>
              {cfg.label}
            </Badge>
          </Group>
        </Group>
        {call.status === "running" && (
          <>
            <Progress
              value={call.percent ?? 100}
              size="xs"
              mt={4}
              animated={call.percent === undefined}
              color="blue"
              style={{ opacity: 0.6 }}
            />
            {call.progressMsg && (
              <Text size="xs" c="dimmed" mt={2}>{call.progressMsg}</Text>
            )}
          </>
        )}
      </UnstyledButton>
      <Collapse in={expanded}>
        <Box mt="xs" p="xs" style={{ borderRadius: 4, fontSize: 11, fontFamily: "monospace", overflowX: "auto" }}
          bg={isDark ? "dark.8" : "gray.1"}>
          <Text size="xs" fw={600} mb={4}>参数:</Text>
          <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {formatInput(call.input)}
          </Text>
          {call.output && (
            <>
              <Text size="xs" fw={600} mt="xs" mb={4}>输出:</Text>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {call.output.length > 500 ? call.output.slice(0, 500) + "..." : call.output}
              </Text>
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
});

function formatInput(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

function useElapsed(call: ToolCallEntry): string {
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (call.status === "running") {
      intervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [call.status]);

  const end = call.endedAt ?? Date.now();
  const ms = end - call.startedAt;
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

export default function ToolProgress({ calls }: ToolProgressProps) {
  if (calls.length === 0) return null;

  const running = calls.filter(c => c.status === "running").length;
  const succeeded = calls.filter(c => c.status === "success").length;
  const failed = calls.filter(c => c.status === "error").length;

  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text size="xs" fw={600}>🔧 工具调用</Text>
        <Text size="xs" c="dimmed">
          {running > 0 && `${running} 运行中`}
          {running > 0 && succeeded > 0 && " · "}
          {succeeded > 0 && `${succeeded} 成功`}
          {failed > 0 && ` · ${failed} 失败`}
        </Text>
      </Group>
      {calls.map(call => (
        <ToolCallItem key={call.id} call={call} />
      ))}
    </Stack>
  );
}
