/**
 * HUDMonitor — live dashboard with color-coded health (oh-my-codex HUD pattern)
 *
 * Displays iteration count, active modes, worker count, context usage.
 * Context thresholds: green <70%, yellow 70-90%, red >90%.
 */
import { useEffect, useState } from "react";
import { Card, Group, Progress, Stack, Text, Badge, SimpleGrid } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getLastReport } from "../lib/health-monitor";
import { sessionStats } from "../lib/audit-logger";

export interface HUDMetrics {
  iterations: number;
  workers: number;
  contextUsed: number;
  contextLimit: number;
  activeModes: string[];
  healthStatus: "healthy" | "degraded" | "critical" | "unknown";
  toolCalls: number;
  errors: number;
}

function collectMetrics(): HUDMetrics {
  let iterations = 0;
  let workers = 0;
  let activeModes: string[] = [];

  try {
    const raw = localStorage.getItem("ralph-session");
    if (raw) {
      const s = JSON.parse(raw);
      iterations = Array.isArray(s?.iterations) ? s.iterations.length : 0;
      if (!s?.done) activeModes.push("ralph");
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem("worker-pool");
    if (raw) {
      const pool = JSON.parse(raw);
      workers = Array.isArray(pool) ? pool.filter((w: { status?: string }) => w?.status === "busy").length : 0;
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem("security-policy");
    if (raw) {
      const pol = JSON.parse(raw);
      activeModes.push(`approval:${pol.approvalMode}`);
      if (pol.networkEnabled) activeModes.push("network");
    }
  } catch { /* ignore */ }

  let contextUsed = 0;
  let contextLimit = 200_000;
  try {
    const budget = localStorage.getItem("token-budget");
    if (budget) {
      const b = JSON.parse(budget);
      contextUsed = b.used ?? 0;
      contextLimit = b.limit ?? contextLimit;
    }
  } catch { /* ignore */ }

  const health = getLastReport();
  const stats = sessionStats();

  return {
    iterations,
    workers,
    contextUsed,
    contextLimit,
    activeModes,
    healthStatus: health?.overallStatus ?? "unknown",
    toolCalls: stats.toolCalls,
    errors: stats.errors,
  };
}

function contextColor(ratio: number): string {
  if (ratio >= 0.9) return "red";
  if (ratio >= 0.7) return "yellow";
  return "green";
}

function healthColor(s: HUDMetrics["healthStatus"]): string {
  switch (s) {
    case "healthy": return "green";
    case "degraded": return "yellow";
    case "critical": return "red";
    default: return "gray";
  }
}

export default function HUDMonitor() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<HUDMetrics>(() => collectMetrics());

  useEffect(() => {
    const tick = () => setMetrics(collectMetrics());
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  const ratio = metrics.contextLimit > 0 ? metrics.contextUsed / metrics.contextLimit : 0;
  const ratioPct = Math.min(100, Math.round(ratio * 100));

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>{t("hud.title", "HUD")}</Text>
          <Badge color={healthColor(metrics.healthStatus)} variant="light">
            {metrics.healthStatus}
          </Badge>
        </Group>

        <SimpleGrid cols={2} spacing="sm">
          <Stack gap={4}>
            <Text size="xs" c="dimmed">{t("hud.iterations", "Iterations")}</Text>
            <Text size="xl" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
              {metrics.iterations}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text size="xs" c="dimmed">{t("hud.workers", "Active Workers")}</Text>
            <Text size="xl" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
              {metrics.workers}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text size="xs" c="dimmed">{t("hud.toolCalls", "Tool Calls")}</Text>
            <Text size="xl" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
              {metrics.toolCalls}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text size="xs" c="dimmed">{t("hud.errors", "Errors")}</Text>
            <Text size="xl" fw={700} c={metrics.errors > 0 ? "red" : undefined} style={{ fontVariantNumeric: "tabular-nums" }}>
              {metrics.errors}
            </Text>
          </Stack>
        </SimpleGrid>

        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{t("hud.contextUsage", "Context Usage")}</Text>
            <Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
              {metrics.contextUsed.toLocaleString()} / {metrics.contextLimit.toLocaleString()} ({ratioPct}%)
            </Text>
          </Group>
          <Progress value={ratioPct} color={contextColor(ratio)} size="md" />
        </Stack>

        {metrics.activeModes.length > 0 && (
          <Group gap={4}>
            <Text size="xs" c="dimmed">{t("hud.modes", "Active modes")}:</Text>
            {metrics.activeModes.map(m => (
              <Badge key={m} size="xs" variant="light" color="blue">{m}</Badge>
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
}
