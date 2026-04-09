import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, Text, Paper, Badge, Group, Button, Box,
  Notification, Code, Stepper, SimpleGrid, ScrollArea, Tabs,
} from "@mantine/core";
import { healthCheck, repairConfig, listenAgentStream, isTauriAvailable } from "../lib/tauri-bridge";
import { onAgentEvent, getEventLog, clearEventLog } from "../lib/event-bus";
import { getTeamConfig, type Worker as TeamWorker } from "../lib/team";
import type { HealthStatus } from "../lib/tauri-bridge";
import { startMonitor, stopMonitor, isMonitorRunning, getAllTasks } from "../lib/runtime";
import { permissionEngine, PERMISSION_LEVEL_META } from "../lib/permission-engine";

interface MonitorPageProps {
  onBack: () => void;
}

const WORKFLOW_PHASES = [
  { id: "think", emoji: "💭", label: "Think", labelZh: "构思", desc: "Clarify goals, challenge assumptions" },
  { id: "plan", emoji: "📋", label: "Plan", labelZh: "规划", desc: "Architecture, task breakdown" },
  { id: "build", emoji: "🔨", label: "Build", labelZh: "构建", desc: "Execute, write code" },
  { id: "review", emoji: "🔍", label: "Review", labelZh: "审查", desc: "Code review, security" },
  { id: "test", emoji: "🧪", label: "Test", labelZh: "测试", desc: "Verify, validate" },
  { id: "ship", emoji: "🚀", label: "Ship", labelZh: "交付", desc: "Deploy, deliver" },
  { id: "reflect", emoji: "🔬", label: "Reflect", labelZh: "复盘", desc: "Extract learnings" },
];

/* Worker 列表现在从 team.ts getTeamConfig() 动态读取 */

const ENGINEERING_IDS = new Set([
  "product", "architect", "developer", "frontend", "code_reviewer",
  "tester", "devops", "security", "writer", "researcher", "ux_designer", "data_analyst",
]);
const BUSINESS_IDS = new Set([
  "ops_director", "growth_hacker", "content_ops", "legal_compliance",
  "financial_analyst", "project_manager", "customer_support", "risk_analyst",
]);

function MonitorPage({ onBack }: MonitorPageProps) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshInterval = 5;
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [costData, setCostData] = useState({ totalCost: 0, totalTokens: 0 });
  const [fileChanges, setFileChanges] = useState<Array<{ path: string; action: string; timestamp: number }>>([]);
  const [teamWorkers, setTeamWorkers] = useState<TeamWorker[]>([]);
  const [runtimeTasks, setRuntimeTasks] = useState<Array<{ status: string }>>([]);
  useEffect(() => {
    const refresh = () => {
      try {
        const tasks = getAllTasks();
        setRuntimeTasks(tasks.map(t => ({ status: t.status })));
      } catch { /* */ }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  // Start runtime monitor
  useEffect(() => {
    if (!isMonitorRunning()) startMonitor();
    return () => { stopMonitor(); };
  }, []);

  const taskCounts = {
    running: runtimeTasks.filter(t => t.status === "in_progress").length,
    done: runtimeTasks.filter(t => t.status === "done" || t.status === "completed").length,
    pending: runtimeTasks.filter(t => t.status === "todo" || t.status === "pending").length,
    failed: runtimeTasks.filter(t => t.status === "blocked" || t.status === "failed").length,
  };
  // Legacy worker counts merged into runtime taskCounts
  taskCounts.running += teamWorkers.filter(w => w.status === "working").length;
  taskCounts.failed += teamWorkers.filter(w => w.status === "error").length;

  // Real-time event log — seeded from global event log
  const [eventLog, setEventLog] = useState<Array<{ time: string; type: string; detail: string }>>(() => {
    return getEventLog().reverse().map(e => ({ time: e.time, type: e.type, detail: e.detail }));
  });
  const logViewport = useRef<HTMLDivElement>(null);

  // 加载 Worker 状态、费用数据、文件变更
  useEffect(() => {
    const refreshAll = () => {
      import("../lib/cost-tracker").then(m => m.getTotalUsage().then(setCostData));
      import("../lib/file-tracker").then(m => setFileChanges(m.getFileChanges()));
      setTeamWorkers([...getTeamConfig().workers]);
    };
    refreshAll();
    const timer = setInterval(refreshAll, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Listen from event bus (works in both Tauri and browser)
    const unsubBus = onAgentEvent((event: Record<string, unknown>) => {
      const type = (event.type as string) || "unknown";

      // Real-time worker status updates (P0-2)
      if (type === "worker_activate" || type === "worker_complete") {
        setTeamWorkers([...getTeamConfig().workers]);
      }

      // Event log entries are now handled by the global event log in event-bus.ts
      // We still build local log for backward compat with Tauri stream below
      const time = new Date().toLocaleTimeString();
      let detail = "";
      switch (type) {
        case "text": detail = `${((event.text as string) || "").slice(0, 80)}${((event.text as string) || "").length > 80 ? "..." : ""}`; break;
        case "thinking": detail = `💭 ${((event.text as string) || "").slice(0, 60)}...`; break;
        case "tool_use": detail = `🔧 ${event.toolName}(${((event.toolInput as string) || "").slice(0, 60)})`; break;
        case "tool_result": detail = `✅ ${((event.toolOutput as string) || "").slice(0, 80)}`; break;
        case "error": detail = `❌ ${event.text}`; break;
        case "result": detail = `✓ 完成`; break;
        case "worker_activate": detail = `🟢 ${event.worker} 开始工作`; break;
        case "worker_complete": detail = `⚪ ${event.worker} 完成`; break;
        case "user_message": detail = `💬 ${((event.text as string) || "").slice(0, 60)}`; break;
        case "intent_analysis": detail = `🧠 ${event.intentType}: ${((event.plan as string) || "").slice(0, 60)}`; break;
        case "worker_dispatch": detail = `🎯 派发给 ${event.worker}`; break;
        default: detail = JSON.stringify(event).slice(0, 100);
      }
      setEventLog(prev => [...prev.slice(-99), { time, type, detail }]);
    });

    // Also try Tauri event stream if available
    let unlistenTauri: (() => void) | undefined;
    if (isTauriAvailable()) {
      const u = listenAgentStream((event) => {
        const time = new Date().toLocaleTimeString();
        let detail = "";
        switch (event.type) {
          case "text": detail = `${(event.text || "").slice(0, 80)}`; break;
          case "thinking": detail = `💭 ${(event.text || "").slice(0, 60)}...`; break;
          case "tool_use": detail = `🔧 ${event.name}(${JSON.stringify(event.input).slice(0, 60)})`; break;
          case "tool_result": detail = `✅ ${(event.output || "").slice(0, 80)}`; break;
          case "error": detail = `❌ ${event.error}`; break;
          case "done": detail = `✓ ${event.stop_reason}`; break;
          case "usage": detail = `📊 in:${event.usage?.input_tokens} out:${event.usage?.output_tokens}`; break;
          default: detail = JSON.stringify(event).slice(0, 100);
        }
        setEventLog(prev => [...prev.slice(-99), { time, type: event.type, detail }]);
      });
      unlistenTauri = () => u?.();
    }

    return () => {
      unsubBus();
      unlistenTauri?.();
    };
  }, []);

  useEffect(() => {
    logViewport.current?.scrollTo({ top: logViewport.current.scrollHeight, behavior: "smooth" });
  }, [eventLog]);

  const runHealthCheck = async () => {
    try {
      const status = await healthCheck();
      setHealth(status);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health check failed (Tauri not available in dev mode)");
      setHealth({ config_valid: true, config_error: null, app_version: "0.1.0-dev" });
      setLastRefresh(new Date());
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

  // Initial load
  useEffect(() => { runHealthCheck(); }, []);

  // Auto-refresh polling
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(runHealthCheck, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval]);

  return (
    <Stack maw={800} mx="auto">
      <Group justify="space-between">
        <Text size="xl" fw={700}>🤖 {t("nav.agents")}</Text>
        <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
      </Group>

      {error && <Notification color="yellow" withCloseButton={false}>⚠️ {error}</Notification>}
      {repairResult && <Notification color="green" withCloseButton onClose={() => setRepairResult(null)}>{repairResult}</Notification>}

      {/* System Health */}
      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={600}>系统健康 / System Health</Text>
          <Group gap="xs">
            <Badge
              color={autoRefresh ? "green" : "gray"}
              variant="light"
              style={{ cursor: "pointer" }}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? `🔄 ${refreshInterval}s` : "⏸️ 暂停"}
            </Badge>
            {lastRefresh && (
              <Text size="xs" c="dimmed">{lastRefresh.toLocaleTimeString()}</Text>
            )}
            <Button size="xs" variant="light" onClick={runHealthCheck}>刷新</Button>
            {health && !health.config_valid && (
              <Button size="xs" color="red" onClick={handleRepair} loading={repairing}>修复配置</Button>
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
            {health.config_error && <Code block color="red">{health.config_error}</Code>}
            <Group>
              <Text size="sm">版本:</Text>
              <Badge variant="outline">{health.app_version}</Badge>
            </Group>
          </Stack>
        )}
      </Paper>

      {/* 7-Phase Workflow Pipeline */}
      <Paper p="md" radius="md" withBorder>
        <Text fw={600} mb="md">工作流管线 / Workflow Pipeline</Text>
        <Stepper active={-1} size="xs" color="blue">
          {WORKFLOW_PHASES.map(p => (
            <Stepper.Step
              key={p.id}
              label={`${p.emoji} ${p.labelZh}`}
              description={p.label}
            />
          ))}
        </Stepper>
        <Text size="xs" c="dimmed" mt="xs" ta="center">
          Think → Plan → Build → Review → Test → Ship → Reflect
        </Text>
      </Paper>

      {/* AI 员工团队 — 分团队展示 + 记忆 + 任务 */}
      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={600}>🤖 AI 员工团队 / Workers ({teamWorkers.length})</Text>
          <Badge color={teamWorkers.some(w => w.status === "working") ? "green" : "gray"} variant="light">
            {teamWorkers.filter(w => w.status === "working").length} 工作中
          </Badge>
        </Group>
        <Tabs defaultValue="engineering">
          <Tabs.List>
            <Tabs.Tab value="engineering">
              🛠️ 研发团队 ({teamWorkers.filter(w => ENGINEERING_IDS.has(w.id)).length})
            </Tabs.Tab>
            <Tabs.Tab value="business">
              💼 业务团队 ({teamWorkers.filter(w => BUSINESS_IDS.has(w.id)).length})
            </Tabs.Tab>
            <Tabs.Tab value="memory">
              🧠 记忆
            </Tabs.Tab>
            <Tabs.Tab value="tasks">
              📋 任务
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="engineering" pt="sm">
            <WorkerGrid workers={teamWorkers.filter(w => ENGINEERING_IDS.has(w.id))} />
          </Tabs.Panel>
          <Tabs.Panel value="business" pt="sm">
            <WorkerGrid workers={teamWorkers.filter(w => BUSINESS_IDS.has(w.id))} />
          </Tabs.Panel>
          <Tabs.Panel value="memory" pt="sm">
            <MemoryPanel />
          </Tabs.Panel>
          <Tabs.Panel value="tasks" pt="sm">
            <TaskPanel tasks={runtimeTasks} />
          </Tabs.Panel>
        </Tabs>
      </Paper>

      {/* Cost & Usage */}
      <Paper p="md" radius="md" withBorder>
        <Text fw={600} mb="sm">💰 费用 & Token 使用 / Cost & Usage</Text>
        <SimpleGrid cols={4}>
          <Stack gap={0} align="center">
            <Text size="xl" fw={700}>{costData.totalCost < 0.01 ? `$${costData.totalCost.toFixed(4)}` : `$${costData.totalCost.toFixed(2)}`}</Text>
            <Text size="xs" c="dimmed">总费用</Text>
          </Stack>
          <Stack gap={0} align="center">
            <Text size="xl" fw={700}>{costData.totalTokens > 1000 ? `${(costData.totalTokens/1000).toFixed(1)}K` : costData.totalTokens}</Text>
            <Text size="xs" c="dimmed">总 Token</Text>
          </Stack>
          <Stack gap={0} align="center">
            <Text size="xl" fw={700}>{taskCounts.running}</Text>
            <Text size="xs" c="dimmed">进行中</Text>
          </Stack>
          <Stack gap={0} align="center">
            <Text size="xl" fw={700}>{taskCounts.done}</Text>
            <Text size="xs" c="dimmed">已完成</Text>
          </Stack>
        </SimpleGrid>
      </Paper>

      {/* Permission Overview */}
      <PermissionOverviewPanel />

      {/* File Changes */}
      {fileChanges.length > 0 && (
        <Paper p="md" radius="md" withBorder>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>📁 文件变更 / File Changes ({fileChanges.length})</Text>
            <Button size="xs" variant="light" onClick={() => { import("../lib/file-tracker").then(m => m.clearFileChanges()); setFileChanges([]); }}>清空</Button>
          </Group>
          <Stack gap={2}>
            {fileChanges.slice(-20).map((fc, i: number) => (
              <Group key={i} gap="xs">
                <Badge size="xs" color={fc.action === "create" ? "green" : fc.action === "modify" ? "yellow" : fc.action === "delete" ? "red" : "gray"}>
                  {fc.action}
                </Badge>
                <Text size="xs" style={{ fontFamily: "monospace" }}>{fc.path}</Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      {/* Tools & Integrations */}
      <Paper p="md" radius="md" withBorder>
        <Text fw={600} mb="sm">工具与集成 / Tools</Text>
        <Group gap="xs">
          <Badge variant="light" color="blue">11 内置工具</Badge>
          <Badge variant="light" color="green">5 LLM 提供商</Badge>
          <Badge variant="light" color="violet">MCP 扩展协议</Badge>
          <Badge variant="light" color="orange">浏览器控制</Badge>
          <Badge variant="light" color="cyan">持续学习引擎</Badge>
          <Badge variant="light" color="red">Rust 后端</Badge>
        </Group>
      </Paper>

      {/* Activity Timeline — last 20 events */}
      <Paper p="md" radius="md" withBorder>
        <Text fw={600} mb="sm">⏱️ 活动时间线 / Activity Timeline</Text>
        <ScrollArea h={160}>
          {eventLog.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="md">暂无活动</Text>
          ) : (
            <Stack gap={4}>
              {eventLog.slice(-20).reverse().map((entry: { time: string; type: string; detail: string }, i: number) => (
                <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                  <Box style={{ width: 2, minHeight: 20, background: "var(--mantine-color-blue-5)", borderRadius: 1, flexShrink: 0 }} />
                  <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="xs" c="dimmed" style={{ fontFamily: "monospace", flexShrink: 0 }}>{entry.time}</Text>
                      <Badge size="xs" variant="light" color={
                        entry.type === "worker_activate" || entry.type === "worker_dispatch" ? "blue" :
                        entry.type === "worker_complete" || entry.type === "result" ? "green" :
                        entry.type === "error" ? "red" :
                        entry.type === "tool_use" || entry.type === "tool_result" ? "yellow" :
                        "gray"
                      }>{entry.type}</Badge>
                    </Group>
                    <Text size="xs" truncate>{entry.detail}</Text>
                  </Stack>
                </Group>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Paper>

      {/* Real-time Event Log */}
      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={600}>📋 实时事件日志 / Event Log</Text>
          <Group gap="xs">
            <Badge color={eventLog.length > 0 ? "green" : "gray"} variant="light">
              {eventLog.length} 条
            </Badge>
            <Button size="xs" variant="light" onClick={() => { clearEventLog(); setEventLog([]); }}>清空</Button>
          </Group>
        </Group>
        <ScrollArea h={200} viewportRef={logViewport}>
          {eventLog.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="md">
              等待 Agent 活动...（在聊天中发送消息后，这里会实时显示事件）
            </Text>
          ) : (
            <Stack gap={2}>
              {eventLog.map((entry: { time: string; type: string; detail: string }, i: number) => (
                <Group key={i} gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0, fontFamily: "monospace" }}>{entry.time}</Text>
                  <Badge size="xs" variant="dot" color={
                    entry.type === "error" ? "red" :
                    entry.type === "tool_use" || entry.type === "tool_result" ? "yellow" :
                    entry.type === "done" || entry.type === "result" || entry.type === "worker_complete" ? "green" :
                    entry.type === "thinking" ? "violet" :
                    entry.type === "worker_activate" || entry.type === "worker_dispatch" ? "teal" :
                    entry.type === "intent_analysis" ? "grape" :
                    entry.type === "user_message" ? "indigo" :
                    "blue"
                  }>{entry.type}</Badge>
                  <Text size="xs" truncate style={{ fontFamily: "monospace" }}>{entry.detail}</Text>
                </Group>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

function WorkerGrid({ workers }: { workers: TeamWorker[] }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
      {workers.map(w => {
        const isWorking = w.status === "working";
        const isDone = w.status === "done";
        const isError = w.status === "error";
        return (
          <Paper
            key={w.id}
            p="xs"
            radius="sm"
            withBorder
            style={{
              borderColor: isWorking ? "var(--mantine-color-blue-5)"
                : isDone ? "var(--mantine-color-green-5)"
                : isError ? "var(--mantine-color-red-5)" : undefined,
              borderWidth: isWorking ? 2 : undefined,
              animation: isWorking ? "worker-pulse 2s ease-in-out infinite" : undefined,
            }}
          >
            <Group gap={6} wrap="nowrap">
              <Text size="lg">{w.emoji}</Text>
              <Stack gap={0}>
                <Text size="xs" fw={500} truncate>{w.name}</Text>
                <Text size="xs" c="dimmed" truncate>{w.role}</Text>
              </Stack>
            </Group>
            <Badge
              color={isWorking ? "blue" : isDone ? "green" : isError ? "red" : "gray"}
              size="xs"
              mt={4}
              fullWidth
              variant={isWorking ? "filled" : "light"}
            >
              {isWorking ? "🔵 工作中" : isDone ? "🟢 完成" : isError ? "🔴 异常" : "⚪ 空闲"}
            </Badge>
            {w.currentTask && (
              <Text size="xs" c="blue" mt={2} truncate>📌 {w.currentTask}</Text>
            )}
            {w.lastResult && (
              <Text size="xs" c="dimmed" mt={2} truncate>📄 {w.lastResult.slice(0, 60)}</Text>
            )}
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

function PermissionOverviewPanel() {
  const [level, setLevel] = useState(() => permissionEngine.getLevel());
  const [rules, setRules] = useState(() => permissionEngine.getRules());
  const [stats, setStats] = useState(() => permissionEngine.getDenialStats());
  const [recentCount, setRecentCount] = useState(() => permissionEngine.getRecentDenialCount(300_000));

  useEffect(() => {
    const refresh = () => {
      setLevel(permissionEngine.getLevel());
      setRules(permissionEngine.getRules());
      setStats(permissionEngine.getDenialStats());
      setRecentCount(permissionEngine.getRecentDenialCount(300_000));
    };
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  const meta = PERMISSION_LEVEL_META[level];

  return (
    <Paper p="md" radius="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Text fw={600}>🛡️ 权限概览 / Permission Overview</Text>
        <Badge color={meta.color} variant="light">
          {meta.symbol} {meta.label}
        </Badge>
      </Group>

      <SimpleGrid cols={3} mb="sm">
        <Stack gap={0} align="center">
          <Text size="xl" fw={700}>{rules.length}</Text>
          <Text size="xs" c="dimmed">自定义规则</Text>
        </Stack>
        <Stack gap={0} align="center">
          <Text size="xl" fw={700} c={stats.length > 0 ? "red" : "green"}>{stats.reduce((s, v) => s + v.count, 0)}</Text>
          <Text size="xs" c="dimmed">总拒绝次数</Text>
        </Stack>
        <Stack gap={0} align="center">
          <Text size="xl" fw={700} c={recentCount > 0 ? "orange" : "green"}>{recentCount}</Text>
          <Text size="xs" c="dimmed">近5分钟拒绝</Text>
        </Stack>
      </SimpleGrid>

      {stats.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={600}>拒绝 TOP 工具:</Text>
          {stats.slice(0, 5).map(s => (
            <Group key={s.tool} gap="xs">
              <Badge size="xs" color="red" variant="light">{s.count}×</Badge>
              <Text size="xs" ff="monospace">{s.tool}</Text>
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 200 }}>
                {s.topReasons.join(" · ")}
              </Text>
            </Group>
          ))}
        </Stack>
      )}

      {rules.length > 0 && (
        <Stack gap={4} mt="xs">
          <Text size="xs" c="dimmed" fw={600}>活跃规则:</Text>
          {rules.map((r, i) => (
            <Group key={i} gap="xs">
              <Badge size="xs" color={r.action === "allow" ? "green" : r.action === "deny" ? "red" : "yellow"}>
                {r.action}
              </Badge>
              <Text size="xs" ff="monospace">{r.tool}</Text>
              {r.path && <Text size="xs" c="dimmed">{r.path}</Text>}
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function MemoryPanel() {
  const [entries, setEntries] = useState<Array<{ key: string; content: string; category: string; timestamp: number; accessCount: number }>>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const refresh = async () => {
      const { memoryStore } = await import("../lib/memory-store");
      const all = await memoryStore.load();
      setEntries(all);
      setCount(all.length);
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  const catColor: Record<string, string> = {
    preference: "blue", fact: "green", project: "violet", instruction: "orange",
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge variant="light" color="blue">{count} 条记忆</Badge>
      </Group>
      {entries.length === 0 ? (
        <Text size="xs" c="dimmed">暂无记忆条目。AI 会在对话中自动学习。</Text>
      ) : (
        <ScrollArea h={200}>
          <Stack gap={4}>
            {entries.map(e => (
              <Paper key={e.key} p="xs" radius="sm" withBorder>
                <Group gap="xs" justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                    <Badge size="xs" color={catColor[e.category] || "gray"}>{e.category}</Badge>
                    <Text size="xs" truncate>{e.content}</Text>
                  </Group>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    ×{e.accessCount}
                  </Text>
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}

function TaskPanel({ tasks }: { tasks: Array<{ status: string }> }) {
  const [allTasks, setAllTasks] = useState<Array<{ taskId: string; title: string; status: string; owner: string }>>([]);

  useEffect(() => {
    const refresh = () => {
      try {
        const items = getAllTasks();
        setAllTasks(items.map(t => ({ taskId: t.taskId, title: t.title, status: t.status, owner: t.owner })));
      } catch { /* */ }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  const statusIcon: Record<string, string> = {
    todo: "⬜", in_progress: "🔄", blocked: "🚫", done: "✅",
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge variant="light" color="blue">{allTasks.length} 个任务</Badge>
        <Badge variant="light" color="green">{tasks.filter(t => t.status === "done" || t.status === "completed").length} 已完成</Badge>
      </Group>
      {allTasks.length === 0 ? (
        <Text size="xs" c="dimmed">暂无任务。使用 AI 创建任务。</Text>
      ) : (
        <ScrollArea h={200}>
          <Stack gap={4}>
            {allTasks.map(t => (
              <Group key={t.taskId} gap="xs" wrap="nowrap">
                <Text size="xs">{statusIcon[t.status] || "❓"}</Text>
                <Text size="xs" fw={500} truncate style={{ flex: 1 }}>{t.title}</Text>
                <Badge size="xs" variant="outline">{t.owner}</Badge>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}

export default MonitorPage;
