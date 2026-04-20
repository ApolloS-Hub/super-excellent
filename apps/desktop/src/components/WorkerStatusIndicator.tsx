/**
 * WorkerStatusIndicator — Shows live worker state in the chat thinking area.
 * When a worker is active, displays:
 *   - Worker name + emoji
 *   - Current state (thinking / running tool)
 *   - Current tool name (if applicable)
 *   - Elapsed time (auto-updating)
 *
 * Subscribes to worker-state-machine state.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Text, Box } from "@mantine/core";
import { getAllActiveStates } from "../lib/worker-state-machine";
import type { WorkerStateEntry } from "../lib/worker-state-machine";

export default function WorkerStatusIndicator() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [states, setStates] = useState<WorkerStateEntry[]>([]);

  useEffect(() => {
    const tick = () => {
      const active = getAllActiveStates().filter((s) =>
        ["spawning", "thinking", "tool_running", "waiting_approval"].includes(s.state),
      );
      setStates(active);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, []);

  if (states.length === 0) return null;

  const labels = {
    spawning: isZh ? "初始化" : "starting",
    thinking: isZh ? "思考中" : "thinking",
    tool_running: isZh ? "执行工具" : "running",
    waiting_approval: isZh ? "等待授权" : "awaiting",
  } as const;

  return (
    <Box
      className="tool-card tool-card-running"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
        alignSelf: "flex-start",
        maxWidth: "100%",
      }}
    >
      {states.map((s) => {
        const elapsed = Math.floor((Date.now() - s.enteredAt) / 1000);
        const label = labels[s.state as keyof typeof labels] ?? s.state;
        return (
          <Group key={s.workerId} gap={8} wrap="nowrap">
            <div className="typing-dots">
              <span />
              <span />
              <span />
            </div>
            <Text size="xs" fw={500}>
              {s.workerName}
            </Text>
            <Text size="xs" c="dimmed">
              · {label}
              {s.currentTool ? ` (${s.currentTool})` : ""}
            </Text>
            <Text size="xs" c="dimmed" style={{ marginLeft: "auto", fontFamily: "monospace" }}>
              {elapsed}s
            </Text>
          </Group>
        );
      })}
    </Box>
  );
}
