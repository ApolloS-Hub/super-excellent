import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, TextInput, Select, Button, Text, Paper, Group,
  PasswordInput, Notification, Badge, useMantineColorScheme,
  Divider, Box, ActionIcon, Tabs, Switch,
} from "@mantine/core";
import { loadConfig, saveConfig, validateApiKey } from "../lib/agent-bridge";
import type { AgentConfig } from "../lib/agent-bridge";
import { usePermissionLevel } from "../components/PermissionDialog";
import {
  PERMISSION_LEVEL_META,
  permissionEngine,
  type PermissionLevel,
  type PermissionAction,
} from "../lib/permission-engine";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "google", label: "Google (Gemini)" },
  { value: "kimi", label: "Kimi (Moonshot)" },
  { value: "ollama", label: "Ollama (本地模型)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "通义千问 (Qwen)" },
  { value: "minimax", label: "MiniMax" },
  { value: "zhipu", label: "智谱 (Zhipu)" },
  { value: "compatible", label: "自定义 / Custom" },
];

const MODEL_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  anthropic: [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4", label: "Claude Haiku 4" },
  ],
  openai: [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "o4-mini", label: "o4-mini" },
    { value: "o3-pro", label: "o3-pro" },
  ],
  google: [
    { value: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    { value: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  kimi: [
    { value: "kimi-k2.5", label: "Kimi K2.5" },
    { value: "moonshot-v1-128k", label: "Moonshot v1 128K" },
    { value: "moonshot-v1-32k", label: "Moonshot v1 32K" },
    { value: "moonshot-v1-8k", label: "Moonshot v1 8K" },
  ],
  ollama: [
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "llama3", label: "Llama 3" },
    { value: "qwen2.5", label: "Qwen 2.5" },
    { value: "mistral", label: "Mistral" },
    { value: "codestral", label: "Codestral" },
    { value: "deepseek-coder-v2", label: "DeepSeek Coder V2" },
    { value: "gemma2", label: "Gemma 2" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat (V3)" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
    { value: "deepseek-coder", label: "DeepSeek Coder" },
  ],
  qwen: [
    { value: "qwen-max", label: "Qwen Max" },
    { value: "qwen-plus", label: "Qwen Plus" },
    { value: "qwen-turbo", label: "Qwen Turbo" },
    { value: "qwen-long", label: "Qwen Long" },
  ],
  minimax: [
    { value: "abab7-chat", label: "ABAB 7 Chat" },
    { value: "abab6.5s-chat", label: "ABAB 6.5s Chat" },
  ],
  zhipu: [
    { value: "glm-4", label: "GLM-4" },
    { value: "glm-4-flash", label: "GLM-4 Flash" },
    { value: "glm-4-long", label: "GLM-4 Long" },
    { value: "glm-4-alltools", label: "GLM-4 AllTools" },
  ],
  compatible: [],
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  kimi: "Kimi (Moonshot)",
  ollama: "Ollama (本地)",
  deepseek: "DeepSeek",
  qwen: "通义千问 (Qwen)",
  minimax: "MiniMax",
  zhipu: "智谱 (Zhipu)",
  compatible: "自定义",
};

interface SettingsPageProps {
  onBack: () => void;
}

function SettingsPage({ onBack }: SettingsPageProps) {
  const { t } = useTranslation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const [config, setConfig] = useState<AgentConfig>(loadConfig());
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<"" | "success" | "error">("");
  const [validationError, setValidationError] = useState("");
  const [customModel, setCustomModel] = useState(config.provider === "compatible" ? config.model : "");

  // If no API key configured, start in edit mode
  useEffect(() => {
    if (!config.apiKey) setEditing(true);
  }, []);

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const handleProviderChange = (val: string | null) => {
    if (!val) return;
    const provider = val as AgentConfig["provider"];
    const models = MODEL_OPTIONS[provider] || [];
    const firstModel = models[0]?.value || "";
    setConfig({ ...config, provider, model: firstModel });
    setCustomModel("");
  };

  const handleSave = async () => {
    const toSave = { ...config };
    if (config.provider === "compatible" && customModel) {
      toSave.model = customModel;
    }
    // Save immediately (no blocking)
    saveConfig(toSave);
    setSaved(true);
    setEditing(false);

    // Then validate in background
    if (toSave.apiKey) {
      setValidating(true);
      setValidationResult("");
      setValidationError("");
      try {
        const result = await validateApiKey(toSave);
        if (result.valid) {
          setValidationResult("success");
        } else {
          setValidationResult("error");
          setValidationError(result.error || "API Key 无效");
        }
      } catch (err) {
        setValidationResult("error");
        setValidationError(err instanceof Error ? err.message : "验证失败");
      } finally {
        setValidating(false);
      }
    }
  };

  const models = MODEL_OPTIONS[config.provider] || [];
  const isCompatible = config.provider === "compatible";
  const providerLabel = PROVIDER_LABELS[config.provider] || config.provider;
  const modelLabel = isCompatible
    ? (customModel || config.model || "未设置")
    : (models.find(m => m.value === config.model)?.label || config.model || "未设置");
  const hasKey = !!config.apiKey;
  const maskedKey = hasKey ? config.apiKey.slice(0, 5) + "..." + config.apiKey.slice(-4) : "未配置";

  // ═══════ Display Mode (configured, not editing) ═══════
  if (!editing && hasKey) {
    return (
      <Stack maw={600} mx="auto">
        <Group justify="space-between">
          <Text size="xl" fw={700}>{t("settings.title")}</Text>
          <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
        </Group>

        {saved && (
          <Notification color="green" withCloseButton={false}>
            ✅ 配置已保存
          </Notification>
        )}

        <Paper p="lg" radius="md" withBorder>
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>当前供应商</Text>
                <Group gap="xs">
                  <Badge size="lg" variant="light" color="blue">{providerLabel}</Badge>
                </Group>
              </Stack>
              <Button variant="light" size="xs" onClick={() => setEditing(true)}>
                ✏️ 编辑
              </Button>
            </Group>

            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>模型</Text>
              <Text size="lg" fw={500}>{modelLabel}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>API Key</Text>
              <Text size="sm" c="dimmed" ff="monospace">{maskedKey}</Text>
            </Stack>

            {(isCompatible || config.baseURL) && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>API 端点</Text>
                <Text size="sm" c="dimmed" ff="monospace">{config.baseURL || "默认"}</Text>
              </Stack>
            )}

            {config.workDir && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>工作目录</Text>
                <Text size="sm" c="dimmed" ff="monospace">{config.workDir}</Text>
              </Stack>
            )}

            {config.proxyURL && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>代理</Text>
                <Text size="sm" c="dimmed" ff="monospace">{config.proxyURL}</Text>
              </Stack>
            )}

            <Paper p="sm" radius="sm" bg={isDark
              ? (validationResult === "error" ? "dark.6" : "dark.6")
              : (validationResult === "error" ? "red.0" : "green.0")
            } withBorder>
              <Group gap="xs">
                {validating ? (
                  <>
                    <Text size="lg">⏳</Text>
                    <Text size="sm" fw={500}>正在验证 API 连接...</Text>
                  </>
                ) : validationResult === "error" ? (
                  <>
                    <Text size="lg">❌</Text>
                    <Stack gap={2}>
                      <Text size="sm" fw={500} c={isDark ? "red.4" : "red.7"}>
                        API 验证失败
                      </Text>
                      <Text size="xs" c="dimmed">{validationError}</Text>
                    </Stack>
                  </>
                ) : validationResult === "success" ? (
                  <>
                    <Text size="lg">✅</Text>
                    <Text size="sm" fw={500} c={isDark ? "green.4" : "green.8"}>
                      API 连接正常，可以开始对话
                    </Text>
                  </>
                ) : (
                  <>
                    <Text size="lg">✅</Text>
                    <Text size="sm" fw={500} c={isDark ? "green.4" : "green.8"}>
                      已配置完成，可以开始对话
                    </Text>
                  </>
                )}
              </Group>
            </Paper>
          </Stack>
        </Paper>
      </Stack>
    );
  }

  // ═══════ Edit Mode (categorized with Tabs) ═══════
  return (
    <Stack maw={600} mx="auto">
      <Group justify="space-between">
        <Text size="xl" fw={700}>{t("settings.title")}</Text>
        <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
      </Group>

      {saved && (
        <Notification color="green" withCloseButton={false}>
          ✅ 配置已保存
        </Notification>
      )}

      <Tabs defaultValue="model">
        <Tabs.List>
          <Tabs.Tab value="model">🤖 模型配置</Tabs.Tab>
          <Tabs.Tab value="general">⚙️ 常规设置</Tabs.Tab>
          <Tabs.Tab value="advanced">🔧 高级设置</Tabs.Tab>
        </Tabs.List>

        {/* ── 模型配置 (Model Config) ── */}
        <Tabs.Panel value="model" pt="md">
          <Paper p="md" radius="md" withBorder>
            <Stack gap="md">
              <Select
                label={t("settings.provider")}
                data={PROVIDER_OPTIONS}
                value={config.provider}
                onChange={handleProviderChange}
              />

              <PasswordInput
                label={t("settings.apiKey")}
                placeholder="sk-..."
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.currentTarget.value })}
              />

              {!isCompatible && models.length > 0 && (
                <Select
                  label={t("settings.model")}
                  data={models}
                  value={config.model}
                  onChange={(val) => val && setConfig({ ...config, model: val })}
                />
              )}

              {(true) && (
                <TextInput
                  label="API 端点 / Base URL"
                  placeholder={
                    ({ anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1", google: "https://generativelanguage.googleapis.com/v1beta", kimi: "https://api.moonshot.cn/v1", ollama: "http://localhost:11434/v1", deepseek: "https://api.deepseek.com/v1", qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1", minimax: "https://api.minimax.chat/v1", zhipu: "https://open.bigmodel.cn/api/paas/v4" } as Record<string, string>)[config.provider] || "https://api.example.com/v1"
                  }
                  value={config.baseURL || ""}
                  onChange={(e) => setConfig({ ...config, baseURL: e.currentTarget.value })}
                  description={config.provider === "ollama" ? "Ollama 默认本地端口 11434，无需 API Key" : "留空使用默认地址，填写自定义地址覆盖（支持内网网关）"}
                />
              )}

              {isCompatible && (
                <TextInput
                  label="模型名称 / Model ID"
                  placeholder="例如: deepseek-chat, qwen-max, llama-3"
                  value={customModel || config.model}
                  onChange={(e) => {
                    setCustomModel(e.currentTarget.value);
                    setConfig({ ...config, model: e.currentTarget.value });
                  }}
                  description="供应商提供的模型标识符"
                />
              )}

              {isCompatible && (
                <Switch
                  label="启用工具调用 / Enable Tools"
                  description="后端模型支持 function calling 时开启（如 Kimi、GPT、Claude）"
                  checked={config.enableTools !== false}
                  onChange={(e) => setConfig({ ...config, enableTools: e.currentTarget.checked })}
                />
              )}

              <Group>
                <Button onClick={handleSave} flex={1}>
                  💾 保存
                </Button>
                {hasKey && (
                  <Button variant="subtle" onClick={() => setEditing(false)}>
                    取消
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        </Tabs.Panel>

        {/* ── 常规设置 (General) ── */}
        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">🌐 语言与外观 / Language & Appearance</Text>
              <Stack gap="md">
                <Group justify="space-between">
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>深色模式 / Dark Mode</Text>
                    <Text size="xs" c="dimmed">切换界面明暗主题</Text>
                  </Stack>
                  <Switch
                    checked={isDark}
                    onChange={() => toggleColorScheme()}
                    size="md"
                  />
                </Group>
              </Stack>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">⌨️ 快捷键 / Keyboard Shortcuts</Text>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm">新对话</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + N</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">设置</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + ,</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">发送消息</Text>
                  <Badge variant="outline" size="sm">Enter</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">换行</Text>
                  <Badge variant="outline" size="sm">Shift + Enter</Badge>
                </Group>
              </Stack>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">🔌 MCP 扩展 / Extensions</Text>
              <Text size="sm" c="dimmed" mb="md">
                通过 MCP (Model Context Protocol) 连接外部工具和服务
              </Text>
              <MCPConfigPanel />
            </Paper>
          </Stack>
        </Tabs.Panel>

        {/* ── 高级设置 (Advanced) ── */}
        <Tabs.Panel value="advanced" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">📁 工作环境 / Workspace</Text>
              <Stack gap="md">
                <TextInput
                  label="工作目录 / Workspace"
                  placeholder="~/Projects"
                  value={config.workDir || ""}
                  onChange={(e) => setConfig({ ...config, workDir: e.currentTarget.value })}
                  description="AI Agent 创建文件、运行命令时的默认目录"
                />

                <TextInput
                  label="代理设置 / Proxy"
                  placeholder="http://127.0.0.1:7890"
                  value={config.proxyURL || ""}
                  onChange={(e) => setConfig({ ...config, proxyURL: e.currentTarget.value })}
                  description="工具的网络请求（搜索、抓取网页）会走此代理"
                />

                <Button onClick={handleSave} variant="light">
                  💾 保存工作环境
                </Button>
              </Stack>
            </Paper>

            <PermissionSettingsPanel />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

/** Permission Level Settings Panel */
function PermissionSettingsPanel() {
  const [level, setLevel] = usePermissionLevel();
  const meta = PERMISSION_LEVEL_META[level];
  // Use local state to force re-render when rules/denials change
  const [rules, setRules] = useState(() => permissionEngine.getRules());
  const [denialStats, setDenialStats] = useState(() => permissionEngine.getDenialStats());
  const [denialCount, setDenialCount] = useState(() => permissionEngine.getDenialHistory().length);

  // New rule form
  const [newTool, setNewTool] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newAction, setNewAction] = useState<PermissionAction>("allow");

  const refresh = () => {
    setRules(permissionEngine.getRules());
    setDenialStats(permissionEngine.getDenialStats());
    setDenialCount(permissionEngine.getDenialHistory().length);
  };

  const handleAddRule = () => {
    if (!newTool.trim()) return;
    permissionEngine.rememberRule({
      tool: newTool.trim(),
      path: newPath.trim() || undefined,
      action: newAction,
    });
    setNewTool("");
    setNewPath("");
    setNewAction("allow");
    refresh();
  };

  const handleDeleteRule = (index: number) => {
    permissionEngine.removeRule(index);
    refresh();
  };

  const handleClearRules = () => {
    permissionEngine.clearRules();
    refresh();
  };

  const handleClearDenials = () => {
    permissionEngine.clearDenials();
    refresh();
  };

  return (
    <Paper p="md" radius="md" withBorder>
      <Text fw={600} mb="sm">🛡️ 权限 & 诊断 / Permissions</Text>
      <Text size="sm" c="dimmed" mb="md">
        控制 AI Agent 执行工具时的权限审批策略，查看拒绝分析
      </Text>

      <Stack gap="md">
        <Select
          label="权限级别"
          data={[
            { value: "default", label: "🛡️ 默认 — 每次都问" },
            { value: "acceptEdits", label: "✏️ 接受编辑 — 自动允许文件编辑" },
            { value: "dontAsk", label: "⚡ 自动模式 — 仅拦截高危操作" },
            { value: "bypassPermissions", label: "🔓 开发者模式 — 全部自动允许" },
            { value: "plan", label: "📋 计划模式 — 只规划不执行" },
          ]}
          value={level}
          onChange={(val) => { if (val) setLevel(val as PermissionLevel); }}
        />

        <Paper p="sm" radius="sm" bg="dark.7">
          <Group gap="xs" mb={4}>
            <Text size="lg">{meta.symbol}</Text>
            <Text size="sm" fw={600}>{meta.label}</Text>
            <Badge color={meta.color} size="xs" variant="light">{meta.labelEn}</Badge>
          </Group>
          <Text size="xs" c="dimmed">{meta.description}</Text>
        </Paper>

        {/* Per-tool / per-path rules */}
        <Divider label="精细规则 / Per-Tool Rules" labelPosition="center" />
        <Stack gap={4}>
          {rules.length === 0 && (
            <Text size="xs" c="dimmed">暂无自定义规则。添加规则可精细控制每个工具的权限。</Text>
          )}
          {rules.map((r, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Badge
                size="xs"
                color={r.action === "allow" ? "green" : r.action === "deny" ? "red" : "yellow"}
                style={{ flexShrink: 0 }}
              >
                {r.action}
              </Badge>
              <Text size="xs" ff="monospace" style={{ flex: 1 }}>{r.tool}</Text>
              {r.path && (
                <Text size="xs" c="dimmed" truncate style={{ maxWidth: 140 }}>{r.path}</Text>
              )}
              <ActionIcon
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => handleDeleteRule(i)}
                title="删除规则"
              >
                ✕
              </ActionIcon>
            </Group>
          ))}
        </Stack>

        {/* Add rule form */}
        <Paper p="xs" radius="sm" withBorder>
          <Text size="xs" fw={600} mb="xs">添加规则</Text>
          <Stack gap="xs">
            <Group gap="xs">
              <TextInput
                size="xs"
                placeholder="工具名 (e.g. bash, *)"
                value={newTool}
                onChange={e => setNewTool(e.currentTarget.value)}
                style={{ flex: 2 }}
              />
              <TextInput
                size="xs"
                placeholder="路径前缀 (可选)"
                value={newPath}
                onChange={e => setNewPath(e.currentTarget.value)}
                style={{ flex: 2 }}
              />
              <Select
                size="xs"
                value={newAction}
                onChange={v => { if (v) setNewAction(v as PermissionAction); }}
                data={[
                  { value: "allow", label: "允许" },
                  { value: "deny", label: "拒绝" },
                  { value: "ask", label: "询问" },
                ]}
                style={{ flex: 1 }}
              />
              <Button size="xs" onClick={handleAddRule} disabled={!newTool.trim()}>
                添加
              </Button>
            </Group>
          </Stack>
        </Paper>

        {rules.length > 0 && (
          <Button size="xs" variant="subtle" color="red" onClick={handleClearRules}>
            清除所有规则
          </Button>
        )}

        {/* Denial analytics */}
        <Divider label={`拒绝分析 (${denialCount} 次)`} labelPosition="center" />
        {denialStats.length === 0 ? (
          <Text size="xs" c="dimmed">暂无拒绝记录。</Text>
        ) : (
          <Stack gap={4}>
            {denialStats.map(stat => (
              <Group key={stat.tool} gap="xs" wrap="nowrap">
                <Badge size="xs" color="red" variant="light" style={{ flexShrink: 0 }}>
                  {stat.count}×
                </Badge>
                <Text size="xs" ff="monospace" style={{ flex: 1 }}>{stat.tool}</Text>
                <Text size="xs" c="dimmed" truncate style={{ maxWidth: 180 }}>
                  {stat.topReasons.join(" · ")}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
        {denialCount > 0 && (
          <Button size="xs" variant="subtle" color="gray" onClick={handleClearDenials}>
            清除拒绝记录
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

interface MCPServerRow {
  name: string;
  url: string;
  status: string;
  toolCount: number;
  resourceCount: number;
}

/** MCP Server Configuration Panel */
function MCPConfigPanel() {
  const [servers, setServers] = useState<MCPServerRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [serverResources, setServerResources] = useState<Record<string, Array<{ uri: string; name: string; content?: string }>>>({});
  const [loadingResources, setLoadingResources] = useState<string | null>(null);
  const [resourceContent, setResourceContent] = useState<{ server: string; uri: string; text: string } | null>(null);

  const refreshServers = () => {
    import("../lib/mcp-client").then(m => {
      const svrs = m.getServers();
      setServers(svrs.map(s => ({
        name: s.name,
        url: s.url || "",
        status: s.status,
        toolCount: s.tools.length,
        resourceCount: s.resources.length,
      })));
    });
  };

  useEffect(() => {
    refreshServers();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const { connectServer, setServerAuth, callMCPTool } = await import("../lib/mcp-client");
    const { registerTool } = await import("../lib/tool-registry");
    if (newToken.trim()) {
      setServerAuth(newName, { type: "bearer", token: newToken.trim() });
    }
    const server = await connectServer({ name: newName, transport: "sse", url: newUrl });

    // Register MCP tools into tool-registry
    for (const tool of server.tools) {
      const sName = server.name;
      registerTool({
        name: `mcp_${tool.name}`,
        description: `[MCP:${sName}] ${tool.description}`,
        inputSchema: tool.inputSchema,
        category: "web",
        execute: async (args) => callMCPTool(sName, tool.name, args),
      });
    }

    // Persist MCP config to localStorage
    const existing = JSON.parse(localStorage.getItem("mcp-config") || '{"servers":[]}');
    const entry = { name: newName, transport: "sse" as const, url: newUrl };
    if (!existing.servers.some((s: { name: string }) => s.name === newName)) {
      existing.servers.push(entry);
      localStorage.setItem("mcp-config", JSON.stringify(existing));
    }

    setServers(prev => [...prev, {
      name: server.name, url: newUrl, status: server.status,
      toolCount: server.tools.length, resourceCount: server.resources.length,
    }]);
    setNewName("");
    setNewUrl("");
    setNewToken("");
  };

  const handleListResources = async (serverName: string) => {
    setLoadingResources(serverName);
    try {
      const { listResources } = await import("../lib/mcp-client");
      const resources = await listResources(serverName);
      setServerResources(prev => ({ ...prev, [serverName]: resources }));
      setExpandedServer(serverName);
      refreshServers();
    } finally {
      setLoadingResources(null);
    }
  };

  const handleReadResource = async (serverName: string, uri: string) => {
    try {
      const { readResource } = await import("../lib/mcp-client");
      const text = await readResource(serverName, uri);
      setResourceContent({ server: serverName, uri, text });
    } catch (e) {
      setResourceContent({ server: serverName, uri, text: `❌ ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <Stack gap="sm">
      {servers.length === 0 && (
        <Text size="xs" c="dimmed">暂无 MCP 服务器。添加一个 SSE 端点以扩展工具。</Text>
      )}
      {servers.map((s) => (
        <Paper key={s.name} p="sm" radius="sm" withBorder>
          <Group justify="space-between" gap="xs">
            <Group gap="xs">
              <Badge color={s.status === "connected" ? "green" : "red"} size="sm">{s.status}</Badge>
              <Text size="sm" fw={500}>{s.name}</Text>
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 140 }}>{s.url}</Text>
            </Group>
            <Group gap={4}>
              <Badge size="xs" variant="outline">🔧 {s.toolCount}</Badge>
              <Badge size="xs" variant="outline">📄 {s.resourceCount}</Badge>
              {s.status === "connected" && (
                <Button
                  size="xs" variant="subtle"
                  loading={loadingResources === s.name}
                  onClick={() => expandedServer === s.name
                    ? setExpandedServer(null)
                    : handleListResources(s.name)}
                >
                  {expandedServer === s.name ? "收起" : "资源"}
                </Button>
              )}
            </Group>
          </Group>

          {expandedServer === s.name && serverResources[s.name] && (
            <Stack gap={4} mt="xs">
              {serverResources[s.name].length === 0
                ? <Text size="xs" c="dimmed">该服务器暂无公开资源</Text>
                : serverResources[s.name].map((r) => (
                  <Group key={r.uri} gap="xs">
                    <Text size="xs" ff="monospace" style={{ flex: 1 }} truncate>{r.name}</Text>
                    <Text size="xs" c="dimmed" truncate style={{ maxWidth: 120 }}>{r.uri}</Text>
                    <Button size="xs" variant="subtle"
                      onClick={() => handleReadResource(s.name, r.uri)}>
                      读取
                    </Button>
                  </Group>
                ))
              }
            </Stack>
          )}
        </Paper>
      ))}

      {resourceContent && (
        <Paper p="sm" radius="sm" withBorder>
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={600}>{resourceContent.uri}</Text>
            <Button size="xs" variant="subtle" onClick={() => setResourceContent(null)}>✕</Button>
          </Group>
          <Box style={{ maxHeight: 160, overflow: "auto" }}>
            <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {resourceContent.text.slice(0, 2000)}{resourceContent.text.length > 2000 ? "\n...(截断)" : ""}
            </Text>
          </Box>
        </Paper>
      )}

      <Paper p="sm" radius="sm" withBorder>
        <Text size="xs" fw={600} mb="xs">添加 MCP 服务器</Text>
        <Stack gap="xs">
          <Group gap="xs">
            <TextInput size="xs" placeholder="名称" value={newName} onChange={e => setNewName(e.currentTarget.value)} style={{ flex: 1 }} />
            <TextInput size="xs" placeholder="SSE URL" value={newUrl} onChange={e => setNewUrl(e.currentTarget.value)} style={{ flex: 2 }} />
          </Group>
          <Group gap="xs">
            <TextInput size="xs" placeholder="Bearer Token（可选）" value={newToken} onChange={e => setNewToken(e.currentTarget.value)} style={{ flex: 1 }} type="password" />
            <Button size="xs" onClick={handleAdd}>添加</Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default SettingsPage;
