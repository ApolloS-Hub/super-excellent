import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, Text, Paper, Badge, Group, Button, Table,
  Notification, Code,
} from "@mantine/core";
import { healthCheck, repairConfig } from "../lib/tauri-bridge";
import type { HealthStatus } from "../lib/tauri-bridge";

interface MonitorPageProps {
  onBack: () => void;
}

function MonitorPage({ onBack }: MonitorPageProps) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runHealthCheck = async () => {
    try {
      const status = await healthCheck();
      setHealth(status);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health check failed (Tauri not available in dev mode)");
      // Provide mock data in dev mode
      setHealth({
        config_valid: true,
        config_error: null,
        app_version: "0.1.0-dev",
      });
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const result = await repairConfig();
      setRepairResult(result);
      await runHealthCheck();
    } catch (e) {
      setRepairResult(`Repair failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRepairing(false);
    }
  };

  useEffect(() => {
    runHealthCheck();
  }, []);

  const workers = [
    { id: "product", name: "产品经理", nameEn: "Product Manager", status: "idle" },
    { id: "developer", name: "开发工程师", nameEn: "Developer", status: "idle" },
    { id: "tester", name: "测试工程师", nameEn: "QA Engineer", status: "idle" },
    { id: "devops", name: "运维工程师", nameEn: "DevOps", status: "idle" },
    { id: "writer", name: "技术文档", nameEn: "Writer", status: "idle" },
    { id: "researcher", name: "研究员", nameEn: "Researcher", status: "idle" },
  ];

  return (
    <Stack maw={700} mx="auto">
      <Group justify="space-between">
        <Text size="xl" fw={700}>🤖 {t("nav.agents")}</Text>
        <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
      </Group>

      {error && (
        <Notification color="yellow" withCloseButton={false}>
          ⚠️ {error}
        </Notification>
      )}

      {repairResult && (
        <Notification color="green" withCloseButton onClose={() => setRepairResult(null)}>
          {repairResult}
        </Notification>
      )}

      {/* System Health */}
      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={600}>系统健康 / System Health</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={runHealthCheck}>刷新</Button>
            {health && !health.config_valid && (
              <Button size="xs" color="red" onClick={handleRepair} loading={repairing}>
                修复配置
              </Button>
            )}
          </Group>
        </Group>

        {health && (
          <Stack gap="xs">
            <Group>
              <Text size="sm">配置状态:</Text>
              <Badge color={health.config_valid ? "green" : "red"}>
                {health.config_valid ? "✅ 正常" : "❌ 异常"}
              </Badge>
            </Group>
            {health.config_error && (
              <Code block color="red">{health.config_error}</Code>
            )}
            <Group>
              <Text size="sm">版本:</Text>
              <Badge variant="outline">{health.app_version}</Badge>
            </Group>
          </Stack>
        )}
      </Paper>

      {/* Worker Status */}
      <Paper p="md" radius="md" withBorder>
        <Text fw={600} mb="sm">AI 员工 / Workers</Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>角色</Table.Th>
              <Table.Th>状态</Table.Th>
              <Table.Th>任务</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {workers.map(w => (
              <Table.Tr key={w.id}>
                <Table.Td>
                  <Text size="sm">{w.name}</Text>
                  <Text size="xs" c="dimmed">{w.nameEn}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color="gray" size="sm">空闲</Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">—</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      {/* Tool Stats */}
      <Paper p="md" radius="md" withBorder>
        <Text fw={600} mb="sm">工具 / Tools</Text>
        <Text size="sm" c="dimmed">12 个内置工具可用</Text>
        <Text size="sm" c="dimmed">0 个 MCP 服务器已连接</Text>
      </Paper>
    </Stack>
  );
}

export default MonitorPage;
