import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, TextInput, Select, Button, Text, Paper, Group,
  PasswordInput, Notification, Badge, useMantineColorScheme,
  Divider, Box, ActionIcon, Tabs, Switch, ScrollArea,
} from "@mantine/core";
import { loadConfig, saveConfig, validateApiKey } from "../lib/agent-bridge";
import type { AgentConfig } from "../lib/agent-bridge";
import { usePermissionLevel } from "../components/PermissionDialog";
import Icon from "../components/Icon";
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
  { value: "ollama", label: "Ollama (Local)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "Qwen" },
  { value: "minimax", label: "MiniMax" },
  { value: "zhipu", label: "Zhipu (GLM)" },
  { value: "compatible", label: "Custom" },
];

const MODEL_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  anthropic: [
    { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
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
  ollama: "Ollama (Local)",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  minimax: "MiniMax",
  zhipu: "Zhipu (GLM)",
  compatible: "Custom",
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
          setValidationError(result.error || t("settings.apiKeyInvalid"));
        }
      } catch (err) {
        setValidationResult("error");
        setValidationError(err instanceof Error ? err.message : t("settings.validationFailed"));
      } finally {
        setValidating(false);
      }
    }
  };

  const models = MODEL_OPTIONS[config.provider] || [];
  const isCompatible = config.provider === "compatible";
  const providerLabel = PROVIDER_LABELS[config.provider] || config.provider;
  const modelLabel = isCompatible
    ? (customModel || config.model || t("settings.notSet"))
    : (models.find(m => m.value === config.model)?.label || config.model || t("settings.notSet"));
  const hasKey = !!config.apiKey;
  const maskedKey = hasKey ? config.apiKey.slice(0, 5) + "..." + config.apiKey.slice(-4) : t("settings.notConfigured");

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
            {`✅ ${t("settings.configSaved")}`}
          </Notification>
        )}

        <Paper p="lg" radius="md" withBorder>
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{t("settings.currentProvider")}</Text>
                <Group gap="xs">
                  <Badge size="lg" variant="light" color="blue">{providerLabel}</Badge>
                </Group>
              </Stack>
              <Button variant="light" size="xs" onClick={() => setEditing(true)}>
                {`✏️ ${t("settings.edit")}`}
              </Button>
            </Group>

            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{t("settings.model")}</Text>
              <Text size="lg" fw={500}>{modelLabel}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{t("settings.apiKey")}</Text>
              <Text size="sm" c="dimmed" ff="monospace">{maskedKey}</Text>
            </Stack>

            {(isCompatible || config.baseURL) && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{t("settings.apiEndpoint")}</Text>
                <Text size="sm" c="dimmed" ff="monospace">{config.baseURL || t("settings.default")}</Text>
              </Stack>
            )}

            {config.workDir && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{t("settings.workDir")}</Text>
                <Text size="sm" c="dimmed" ff="monospace">{config.workDir}</Text>
              </Stack>
            )}

            {config.proxyURL && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{t("settings.proxy")}</Text>
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
                    <Text size="sm" fw={500}>{t("settings.validatingConnection")}</Text>
                  </>
                ) : validationResult === "error" ? (
                  <>
                    <Text size="lg">❌</Text>
                    <Stack gap={2}>
                      <Text size="sm" fw={500} c={isDark ? "red.4" : "red.7"}>
                        {t("settings.apiValidationFailed")}
                      </Text>
                      <Text size="xs" c="dimmed">{validationError}</Text>
                    </Stack>
                  </>
                ) : validationResult === "success" ? (
                  <>
                    <Text size="lg">✅</Text>
                    <Text size="sm" fw={500} c={isDark ? "green.4" : "green.8"}>
                      {t("settings.apiConnectionOk")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text size="lg">✅</Text>
                    <Text size="sm" fw={500} c={isDark ? "green.4" : "green.8"}>
                      {t("settings.configuredReady")}
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
    <ScrollArea style={{ height: "calc(100vh - 70px)" }} offsetScrollbars>
    <Stack maw={600} mx="auto" pb="xl">
      <Group justify="space-between">
        <Text size="xl" fw={650} style={{ letterSpacing: "-0.015em" }}>{t("settings.title")}</Text>
        <Button variant="subtle" size="sm" leftSection={<Icon name="chevron-right" size={13} style={{ transform: "rotate(180deg)" }} />} onClick={onBack}>
          {t("nav.conversations")}
        </Button>
      </Group>

      {saved && (
        <Notification color="green" withCloseButton={false} icon={<Icon name="check" size={14} stroke={2.2} />}>
          {t("settings.configSaved")}
        </Notification>
      )}

      <Tabs defaultValue="model">
        <Tabs.List>
          <Tabs.Tab value="model"    leftSection={<Icon name="bot" size={14} />}>      {t("settings.modelConfig")}</Tabs.Tab>
          <Tabs.Tab value="general"  leftSection={<Icon name="sliders" size={14} />}>  {t("settings.general")}</Tabs.Tab>
          <Tabs.Tab value="lark"     leftSection={<Icon name="chat" size={14} />}>     {t("settings.lark")}</Tabs.Tab>
          <Tabs.Tab value="advanced" leftSection={<Icon name="shield" size={14} />}>   {t("settings.advanced")}</Tabs.Tab>
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
                  label={t("settings.apiEndpoint")}
                  placeholder={
                    ({ anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1", google: "https://generativelanguage.googleapis.com/v1beta", kimi: "https://api.moonshot.cn/v1", ollama: "http://localhost:11434/v1", deepseek: "https://api.deepseek.com/v1", qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1", minimax: "https://api.minimax.chat/v1", zhipu: "https://open.bigmodel.cn/api/paas/v4" } as Record<string, string>)[config.provider] || "https://api.example.com/v1"
                  }
                  value={config.baseURL || ""}
                  onChange={(e) => setConfig({ ...config, baseURL: e.currentTarget.value })}
                  description={config.provider === "ollama" ? t("settings.ollamaDefaultHint") : t("settings.baseUrlHint")}
                />
              )}

              {isCompatible && (
                <TextInput
                  label={t("settings.modelName")}
                  placeholder="e.g. deepseek-chat, qwen-max, llama-3"
                  value={customModel || config.model}
                  onChange={(e) => {
                    setCustomModel(e.currentTarget.value);
                    setConfig({ ...config, model: e.currentTarget.value });
                  }}
                  description={t("settings.modelIdHint")}
                />
              )}

              {isCompatible && (
                <Switch
                  label={t("settings.enableTools")}
                  description={t("settings.enableToolsHint")}
                  checked={config.enableTools !== false}
                  onChange={(e) => setConfig({ ...config, enableTools: e.currentTarget.checked })}
                />
              )}

              <Group>
                <Button onClick={handleSave} flex={1}>
                  {`💾 ${t("settings.save")}`}
                </Button>
                {hasKey && (
                  <Button variant="subtle" onClick={() => setEditing(false)}>
                    {t("common.cancel")}
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
          <ProviderDiagnosticsPanel config={config} />
        </Tabs.Panel>

        {/* ── 常规设置 (General) ── */}
        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">{`🌐 ${t("settings.languageAppearance")}`}</Text>
              <Stack gap="md">
                <Group justify="space-between">
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>{t("settings.darkMode")}</Text>
                    <Text size="xs" c="dimmed">{t("settings.darkModeHint")}</Text>
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
              <Text fw={600} mb="sm">{`⌨️ ${t("settings.keyboardShortcuts")}`}</Text>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutNewChat")}</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + N</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutSendMessage")}</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + Enter</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutStopGeneration")}</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + Shift + S</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutSwitchChat")}</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + 1~9</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutOpenSettings")}</Text>
                  <Badge variant="outline" size="sm">⌘/Ctrl + ,</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutCloseBack")}</Text>
                  <Badge variant="outline" size="sm">Escape</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutNewline")}</Text>
                  <Badge variant="outline" size="sm">Shift + Enter</Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">{t("settings.shortcutSend")}</Text>
                  <Badge variant="outline" size="sm">Enter</Badge>
                </Group>
              </Stack>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">{`🔌 ${t("settings.mcpExtensions")}`}</Text>
              <Text size="sm" c="dimmed" mb="md">
                {t("settings.mcpExtensionsHint")}
              </Text>
              <MCPConfigPanel />
            </Paper>
          </Stack>
        </Tabs.Panel>

        {/* ── Lark Integration ── */}
        <Tabs.Panel value="lark" pt="md">
          <Stack gap="md">
            <LarkConfigPanel />
            <RemoteBridgePanel />
          </Stack>
        </Tabs.Panel>

        {/* ── 高级设置 (Advanced) ── */}
        <Tabs.Panel value="advanced" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Text fw={600} mb="sm">{`📁 ${t("settings.workspace")}`}</Text>
              <Stack gap="md">
                <TextInput
                  label={t("settings.workDir")}
                  placeholder="~/Projects"
                  value={config.workDir || ""}
                  onChange={(e) => setConfig({ ...config, workDir: e.currentTarget.value })}
                  description={t("settings.workDirHint")}
                />

                <TextInput
                  label={t("settings.proxySettings")}
                  placeholder="http://127.0.0.1:7890"
                  value={config.proxyURL || ""}
                  onChange={(e) => setConfig({ ...config, proxyURL: e.currentTarget.value })}
                  description={t("settings.proxyHint")}
                />

                <Button onClick={handleSave} variant="light">
                  {`💾 ${t("settings.saveWorkspace")}`}
                </Button>
              </Stack>
            </Paper>

            <PermissionSettingsPanel />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
    </ScrollArea>
  );
}
function PermissionSettingsPanel() {
  const { t } = useTranslation();
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
      <Text fw={600} mb="sm">{`🛡️ ${t("settings.permissionsAndDiagnostics")}`}</Text>
      <Text size="sm" c="dimmed" mb="md">
        {t("settings.permissionsHint")}
      </Text>

      <Stack gap="md">
        <Select
          label={t("settings.permissionLevel")}
          data={[
            { value: "default", label: `🛡️ ${t("settings.permDefault")}` },
            { value: "acceptEdits", label: `✏️ ${t("settings.permAcceptEdits")}` },
            { value: "dontAsk", label: `⚡ ${t("settings.permAuto")}` },
            { value: "bypassPermissions", label: `🔓 ${t("settings.permDeveloper")}` },
            { value: "plan", label: `📋 ${t("settings.permPlan")}` },
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
        <Divider label={t("settings.perToolRules")} labelPosition="center" />
        <Stack gap={4}>
          {rules.length === 0 && (
            <Text size="xs" c="dimmed">{t("settings.noCustomRules")}</Text>
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
                title={t("settings.deleteRule")}
              >
                ✕
              </ActionIcon>
            </Group>
          ))}
        </Stack>

        {/* Add rule form */}
        <Paper p="xs" radius="sm" withBorder>
          <Text size="xs" fw={600} mb="xs">{t("settings.addRule")}</Text>
          <Stack gap="xs">
            <Group gap="xs">
              <TextInput
                size="xs"
                placeholder={t("settings.toolNamePlaceholder")}
                value={newTool}
                onChange={e => setNewTool(e.currentTarget.value)}
                style={{ flex: 2 }}
              />
              <TextInput
                size="xs"
                placeholder={t("settings.pathPrefixPlaceholder")}
                value={newPath}
                onChange={e => setNewPath(e.currentTarget.value)}
                style={{ flex: 2 }}
              />
              <Select
                size="xs"
                value={newAction}
                onChange={v => { if (v) setNewAction(v as PermissionAction); }}
                data={[
                  { value: "allow", label: t("settings.actionAllow") },
                  { value: "deny", label: t("settings.actionDeny") },
                  { value: "ask", label: t("settings.actionAsk") },
                ]}
                style={{ flex: 1 }}
              />
              <Button size="xs" onClick={handleAddRule} disabled={!newTool.trim()}>
                {t("settings.add")}
              </Button>
            </Group>
          </Stack>
        </Paper>

        {rules.length > 0 && (
          <Button size="xs" variant="subtle" color="red" onClick={handleClearRules}>
            {t("settings.clearAllRules")}
          </Button>
        )}

        {/* Denial analytics */}
        <Divider label={t("settings.denialAnalysis", { count: denialCount })} labelPosition="center" />
        {denialStats.length === 0 ? (
          <Text size="xs" c="dimmed">{t("settings.noDenialRecords")}</Text>
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
            {t("settings.clearDenialRecords")}
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
  const { t } = useTranslation();
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
        <Text size="xs" c="dimmed">{t("settings.noMcpServers")}</Text>
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
              <Badge size="xs" variant="outline" leftSection={<Icon name="sliders" size={10} />}>{s.toolCount}</Badge>
              <Badge size="xs" variant="outline" leftSection={<Icon name="file" size={10} />}>{s.resourceCount}</Badge>
              {s.status === "connected" && (
                <Button
                  size="xs" variant="subtle"
                  loading={loadingResources === s.name}
                  onClick={() => expandedServer === s.name
                    ? setExpandedServer(null)
                    : handleListResources(s.name)}
                >
                  {expandedServer === s.name ? t("settings.collapse") : t("settings.resources")}
                </Button>
              )}
            </Group>
          </Group>

          {expandedServer === s.name && serverResources[s.name] && (
            <Stack gap={4} mt="xs">
              {serverResources[s.name].length === 0
                ? <Text size="xs" c="dimmed">{t("settings.noPublicResources")}</Text>
                : serverResources[s.name].map((r) => (
                  <Group key={r.uri} gap="xs">
                    <Text size="xs" ff="monospace" style={{ flex: 1 }} truncate>{r.name}</Text>
                    <Text size="xs" c="dimmed" truncate style={{ maxWidth: 120 }}>{r.uri}</Text>
                    <Button size="xs" variant="subtle"
                      onClick={() => handleReadResource(s.name, r.uri)}>
                      {t("settings.read")}
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
              {resourceContent.text.slice(0, 2000)}{resourceContent.text.length > 2000 ? `\n...(${t("settings.truncated")})` : ""}
            </Text>
          </Box>
        </Paper>
      )}

      <Paper p="sm" radius="sm" withBorder>
        <Text size="xs" fw={600} mb="xs">{t("settings.addMcpServer")}</Text>
        <Stack gap="xs">
          <Group gap="xs">
            <TextInput size="xs" placeholder={t("settings.mcpName")} value={newName} onChange={e => setNewName(e.currentTarget.value)} style={{ flex: 1 }} />
            <TextInput size="xs" placeholder="SSE URL" value={newUrl} onChange={e => setNewUrl(e.currentTarget.value)} style={{ flex: 2 }} />
          </Group>
          <Group gap="xs">
            <TextInput size="xs" placeholder={t("settings.mcpBearerTokenOptional")} value={newToken} onChange={e => setNewToken(e.currentTarget.value)} style={{ flex: 1 }} type="password" />
            <Button size="xs" onClick={handleAdd}>{t("settings.add")}</Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

/** Provider Diagnostics Panel — 5 probes: connectivity, auth, model, rate limit, latency */
type DiagSeverity = "ok" | "warn" | "error" | "pending";
interface DiagProbe {
  name: string;
  severity: DiagSeverity;
  message: string;
  detail?: string;
  suggestion?: string;
  durationMs?: number;
}

function ProviderDiagnosticsPanel({ config }: { config: AgentConfig }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [probes, setProbes] = useState<DiagProbe[]>([]);

  const severityColor: Record<DiagSeverity, string> = {
    ok: "green",
    warn: "yellow",
    error: "red",
    pending: "gray",
  };
  const severityIcon: Record<DiagSeverity, string> = {
    ok: "🟢",
    warn: "🟡",
    error: "🔴",
    pending: "⏳",
  };

  const runDiagnostics = async () => {
    if (!config.apiKey && config.provider !== "ollama") {
      setProbes([{
        name: t("settings.diagPrecheck"),
        severity: "error",
        message: t("settings.diagNoApiKey"),
        suggestion: t("settings.diagNoApiKeyHint"),
      }]);
      return;
    }

    setRunning(true);
    const baseURL = config.baseURL || (
      { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1", google: "https://generativelanguage.googleapis.com/v1beta", kimi: "https://api.moonshot.cn/v1", ollama: "http://localhost:11434/v1", deepseek: "https://api.deepseek.com/v1", qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1", minimax: "https://api.minimax.chat/v1", zhipu: "https://open.bigmodel.cn/api/paas/v4" } as Record<string, string>
    )[config.provider] || "";

    // Probe 1: Connectivity
    const initProbes: DiagProbe[] = [
      { name: t("settings.diagConnectivity"), severity: "pending" as DiagSeverity, message: t("settings.diagDetecting") },
      { name: t("settings.diagAuth"), severity: "pending" as DiagSeverity, message: t("settings.diagWaiting") },
      { name: t("settings.diagModelAvail"), severity: "pending" as DiagSeverity, message: t("settings.diagWaiting") },
      { name: t("settings.diagRateLimit"), severity: "pending" as DiagSeverity, message: t("settings.diagWaiting") },
      { name: t("settings.diagLatency"), severity: "pending" as DiagSeverity, message: t("settings.diagWaiting") },
    ];
    setProbes([...initProbes]);

    // Probe 1: Connectivity
    try {
      const t0 = Date.now();
      const resp = await fetch(baseURL.replace(/\/v1\/?$/, "").replace(/\/v1beta\/?$/, ""), {
        method: "HEAD",
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      const dt = Date.now() - t0;
      if (resp && (resp.ok || resp.status === 401 || resp.status === 403 || resp.status === 404)) {
        initProbes[0] = { name: t("settings.diagConnectivity"), severity: "ok", message: t("settings.diagEndpointReachable", { ms: dt }), durationMs: dt };
      } else {
        initProbes[0] = { name: t("settings.diagConnectivity"), severity: "error", message: t("settings.diagCannotConnect", { url: baseURL }), suggestion: t("settings.diagCheckNetwork"), durationMs: dt };
      }
    } catch {
      initProbes[0] = { name: t("settings.diagConnectivity"), severity: "error", message: t("settings.diagConnectionTimeout"), suggestion: t("settings.diagCheckNetworkProxy") };
    }
    setProbes([...initProbes]);

    // Probe 2: Authentication
    try {
      const result = await validateApiKey(config);
      if (result.valid) {
        initProbes[1] = { name: t("settings.diagAuth"), severity: "ok", message: t("settings.diagApiKeyValid") };
      } else {
        initProbes[1] = { name: t("settings.diagAuth"), severity: "error", message: result.error || t("settings.diagAuthFailed"), suggestion: t("settings.diagCheckApiKey") };
      }
    } catch (e) {
      initProbes[1] = { name: t("settings.diagAuth"), severity: "warn", message: `${t("settings.diagValidationException")}: ${e instanceof Error ? e.message : String(e)}`, suggestion: t("settings.diagMaybeNetwork") };
    }
    setProbes([...initProbes]);

    // Probe 3: Model Availability
    try {
      const models = MODEL_OPTIONS[config.provider] || [];
      if (models.length === 0 && config.provider !== "compatible") {
        initProbes[2] = { name: t("settings.diagModelAvail"), severity: "warn", message: t("settings.diagNoModelList"), suggestion: t("settings.diagUseCustomModel") };
      } else if (models.some(m => m.value === config.model)) {
        initProbes[2] = { name: t("settings.diagModelAvail"), severity: "ok", message: t("settings.diagModelInList", { model: config.model }) };
      } else if (config.model) {
        initProbes[2] = { name: t("settings.diagModelAvail"), severity: "warn", message: t("settings.diagModelNotRecommended", { model: config.model }), suggestion: t("settings.diagModelMayWork") };
      } else {
        initProbes[2] = { name: t("settings.diagModelAvail"), severity: "error", message: t("settings.diagNoModelSelected"), suggestion: t("settings.diagSelectModel") };
      }
    } catch {
      initProbes[2] = { name: t("settings.diagModelAvail"), severity: "warn", message: t("settings.diagCannotCheckModel") };
    }
    setProbes([...initProbes]);

    // Probe 4: Rate Limit (check by trying a minimal request)
    try {
      if (config.provider === "ollama") {
        initProbes[3] = { name: t("settings.diagRateLimit"), severity: "ok", message: t("settings.diagLocalNoRateLimit") };
      } else {
        initProbes[3] = { name: t("settings.diagRateLimit"), severity: "ok", message: t("settings.diagNoRateLimitHit"), detail: t("settings.diagCheckAfterRequest") };
      }
    } catch {
      initProbes[3] = { name: t("settings.diagRateLimit"), severity: "warn", message: t("settings.diagCannotDetect") };
    }
    setProbes([...initProbes]);

    // Probe 5: Latency
    try {
      const t0 = Date.now();
      await fetch(baseURL, { method: "OPTIONS", signal: AbortSignal.timeout(5000) }).catch(() => null);
      const latency = Date.now() - t0;
      if (latency < 500) {
        initProbes[4] = { name: t("settings.diagLatency"), severity: "ok", message: t("settings.diagFast", { ms: latency }), durationMs: latency };
      } else if (latency < 2000) {
        initProbes[4] = { name: t("settings.diagLatency"), severity: "warn", message: t("settings.diagSlow", { ms: latency }), suggestion: t("settings.diagConsiderProxy"), durationMs: latency };
      } else {
        initProbes[4] = { name: t("settings.diagLatency"), severity: "error", message: t("settings.diagVerySlow", { ms: latency }), suggestion: t("settings.diagHighLatencyHint"), durationMs: latency };
      }
    } catch {
      initProbes[4] = { name: t("settings.diagLatency"), severity: "error", message: t("settings.diagMeasureTimeout"), suggestion: t("settings.diagCheckConnection") };
    }
    setProbes([...initProbes]);
    setRunning(false);
  };

  return (
    <Paper p="md" radius="md" withBorder mt="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>{`🩺 ${t("settings.providerDiagnostics")}`}</Text>
        <Button size="xs" variant="light" onClick={runDiagnostics} loading={running}>
          {t("settings.runDiagnostics")}
        </Button>
      </Group>
      {probes.length === 0 ? (
        <Text size="xs" c="dimmed">{t("settings.diagClickToRun")}</Text>
      ) : (
        <Stack gap="xs">
          {probes.map((p, i) => (
            <Paper key={i} p="xs" radius="sm" withBorder
              style={{ borderLeftWidth: 3, borderLeftColor: `var(--mantine-color-${severityColor[p.severity]}-5)` }}>
              <Group gap="xs" wrap="nowrap">
                <Text size="sm">{severityIcon[p.severity]}</Text>
                <Stack gap={0} style={{ flex: 1 }}>
                  <Group gap="xs">
                    <Text size="xs" fw={600}>{p.name}</Text>
                    <Badge size="xs" variant="light" color={severityColor[p.severity]}>{p.severity}</Badge>
                    {p.durationMs !== undefined && <Text size="xs" c="dimmed">{p.durationMs}ms</Text>}
                  </Group>
                  <Text size="xs">{p.message}</Text>
                  {p.suggestion && (
                    <Text size="xs" c="blue" mt={2}>💡 {p.suggestion}</Text>
                  )}
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

/** Lark Configuration Panel — app credentials + user OAuth + connection test */
function LarkConfigPanel() {
  const { t } = useTranslation();
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState("");
  const [userInfo, setUserInfo] = useState<{ name: string; email: string } | null>(null);
  const [hasUser, setHasUser] = useState(false);
  const [userExpired, setUserExpired] = useState(false);

  useEffect(() => {
    import("../lib/lark-integration").then(m => {
      const cfg = m.getLarkConfig();
      setAppId(cfg.appId);
      setAppSecret(cfg.appSecret);
      setHasUser(m.hasUserAccess());
      const info = m.loadUserInfo();
      if (info) setUserInfo({ name: info.name, email: info.email });
      if (!m.hasUserAccess() && m.isRefreshTokenValid()) setUserExpired(true);
    });
  }, []);

  const handleSaveAndTest = async () => {
    setTestStatus("testing");
    setTestError("");
    const m = await import("../lib/lark-integration");
    m.setLarkConfig({ appId, appSecret });
    m.registerLarkTools();
    try {
      const result = await m.testConnection();
      if (result.tenantOk) {
        setTestStatus("ok");
      } else {
        setTestStatus("fail");
        setTestError(result.tenantError || "Unknown error");
      }
      if (result.userOk && result.userName) {
        setHasUser(true);
        setUserInfo({ name: result.userName, email: "" });
        setUserExpired(false);
      }
    } catch (e) {
      setTestStatus("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOAuthStart = async () => {
    const m = await import("../lib/lark-integration");
    const state = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    const url = m.buildOAuthUrl(appId, "", state);
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleOAuthExchange = async () => {
    if (!oauthCode.trim()) return;
    setOauthBusy(true);
    setOauthError("");
    try {
      const m = await import("../lib/lark-integration");
      const info = await m.exchangeOAuthCode(oauthCode.trim());
      setUserInfo({ name: info.name, email: info.email });
      setHasUser(true);
      setUserExpired(false);
      setOauthCode("");
      m.refreshUserToolRegistration();
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e));
    } finally {
      setOauthBusy(false);
    }
  };

  const handleDisconnect = async () => {
    const m = await import("../lib/lark-integration");
    m.disconnectUser();
    m.refreshUserToolRegistration();
    setHasUser(false);
    setUserInfo(null);
    setUserExpired(false);
  };

  const isConfigured = !!appId && !!appSecret;

  const USER_TOOLS = ["lark_calendar", "lark_doc", "lark_task", "lark_approval", "lark_sheet", "lark_email"];
  const tools = [
    { name: "lark_im", desc: t("settings.larkIM"), scope: "app" as const },
    { name: "lark_calendar", desc: t("settings.larkCalendar"), scope: "user" as const },
    { name: "lark_doc", desc: t("settings.larkDoc"), scope: "user" as const },
    { name: "lark_task", desc: t("settings.larkTask"), scope: "user" as const },
    { name: "lark_approval", desc: t("settings.larkApproval"), scope: "user" as const },
    { name: "lark_sheet", desc: t("settings.larkSheet"), scope: "user" as const },
    { name: "lark_email", desc: t("settings.larkEmail"), scope: "user" as const },
  ];

  return (
    <Stack gap="md">
      {/* App Credentials */}
      <Paper p="md" radius="md" withBorder>
        <Group gap={8} mb="sm">
          <Icon name="chat" size={15} />
          <Text fw={600}>{t("settings.larkIntegration")}</Text>
        </Group>
        <Text size="sm" c="dimmed" mb="md">{t("settings.larkIntegrationHint")}</Text>

        {testStatus === "ok" && (
          <Notification color="green" withCloseButton={false} mb="md" icon={<Icon name="check" size={14} stroke={2.2} />}>
            {t("settings.larkTestSuccess")}
          </Notification>
        )}
        {testStatus === "fail" && (
          <Notification color="red" withCloseButton={false} mb="md" icon={<Icon name="alert" size={14} />}>
            {t("settings.larkTestFailed")}: {testError}
          </Notification>
        )}

        <Stack gap="md">
          <TextInput
            label="App ID"
            placeholder="cli_xxxxxxxxxx"
            value={appId}
            onChange={(e) => setAppId(e.currentTarget.value)}
            description={t("settings.larkAppIdHint")}
          />
          <PasswordInput
            label="App Secret"
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={appSecret}
            onChange={(e) => setAppSecret(e.currentTarget.value)}
            description={t("settings.larkAppSecretHint")}
          />
          <Button
            onClick={handleSaveAndTest}
            loading={testStatus === "testing"}
            disabled={!appId || !appSecret}
            leftSection={<Icon name="shield" size={14} />}
          >
            {testStatus === "testing" ? t("settings.larkTestTesting") : t("settings.saveLarkConfig")}
          </Button>
        </Stack>
      </Paper>

      {/* User OAuth */}
      {isConfigured && (
        <Paper p="md" radius="md" withBorder>
          <Group gap={8} mb="sm">
            <Icon name="users" size={15} />
            <Text fw={600}>{t("settings.larkOAuthConnect")}</Text>
            {hasUser && (
              <Badge color="green" variant="light" size="sm">{t("settings.larkOAuthConnected")}</Badge>
            )}
            {userExpired && (
              <Badge color="orange" variant="light" size="sm">{t("settings.larkOAuthExpired")}</Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed" mb="md">{t("settings.larkOAuthHint")}</Text>

          {hasUser && userInfo ? (
            <Group justify="space-between">
              <Group gap="xs">
                <Icon name="check" size={14} />
                <Text size="sm" fw={500}>{userInfo.name}</Text>
                {userInfo.email && <Text size="xs" c="dimmed">{userInfo.email}</Text>}
              </Group>
              <Button variant="light" color="red" size="xs" onClick={handleDisconnect}>
                {t("settings.larkOAuthDisconnect")}
              </Button>
            </Group>
          ) : (
            <Stack gap="sm">
              <Button variant="light" onClick={handleOAuthStart} leftSection={<Icon name="globe" size={14} />}>
                {t("settings.larkOAuthConnect")}
              </Button>
              <Divider label={t("settings.larkOAuthPasteHint")} labelPosition="center" />
              <Group gap="xs" wrap="nowrap">
                <TextInput
                  flex={1}
                  size="sm"
                  placeholder={t("settings.larkOAuthPasteCode")}
                  value={oauthCode}
                  onChange={(e) => setOauthCode(e.currentTarget.value)}
                />
                <Button
                  size="sm"
                  onClick={handleOAuthExchange}
                  loading={oauthBusy}
                  disabled={!oauthCode.trim()}
                >
                  {t("settings.larkOAuthExchange")}
                </Button>
              </Group>
              {oauthError && (
                <Text size="xs" c="red">{oauthError}</Text>
              )}
            </Stack>
          )}
        </Paper>
      )}

      {/* Tool Registry */}
      <Paper p="md" radius="md" withBorder>
        <Group gap={8} mb="sm">
          <Icon name="sliders" size={15} />
          <Text fw={600}>{t("settings.registeredTools")}</Text>
        </Group>
        <Group gap="xs" mb="sm">
          <Badge color={isConfigured ? "green" : "gray"} variant="light">
            {isConfigured ? t("settings.configured") : t("settings.notConfigured")}
          </Badge>
          {isConfigured && (
            <Badge color={hasUser ? "green" : "orange"} variant="light">
              {hasUser ? t("settings.larkOAuthConnected") : t("settings.larkOAuthNotConnected")}
            </Badge>
          )}
        </Group>
        <Stack gap="xs">
          {tools.map(tool => {
            const needsUser = USER_TOOLS.includes(tool.name);
            const available = needsUser ? hasUser : isConfigured;
            return (
              <Group key={tool.name} gap="xs" wrap="nowrap">
                <Badge size="xs" variant="outline" color={available ? "blue" : "gray"}>
                  {tool.name}
                </Badge>
                <Badge size="xs" variant="light" color={needsUser ? "violet" : "teal"}>
                  {needsUser ? t("settings.larkScopeUser") : t("settings.larkScopeApp")}
                </Badge>
                <Text size="xs" c={available ? undefined : "dimmed"}>{tool.desc}</Text>
              </Group>
            );
          })}
        </Stack>
      </Paper>
    </Stack>
  );
}

/** Remote Bridge Configuration Panel */
function RemoteBridgePanel() {
  const { t } = useTranslation();
  const [bridgeCfg, setBridgeCfg] = useState(() => {
    try {
      const raw = localStorage.getItem("remote-bridge-config");
      return raw ? JSON.parse(raw) : { enabled: false, allowedChatIds: [], pollIntervalMs: 3000, maxMessageLength: 4000 };
    } catch { return { enabled: false, allowedChatIds: [], pollIntervalMs: 3000, maxMessageLength: 4000 }; }
  });
  const [running, setRunning] = useState(false);
  const [chatIdsInput, setChatIdsInput] = useState(() =>
    (bridgeCfg.allowedChatIds || []).join(", ") as string
  );

  useEffect(() => {
    import("../lib/remote-bridge").then(m => {
      setRunning(m.isRemoteBridgeRunning());
    });
    const timer = setInterval(() => {
      import("../lib/remote-bridge").then(m => {
        setRunning(m.isRemoteBridgeRunning());
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleToggle = async () => {
    const m = await import("../lib/remote-bridge");
    if (running) {
      m.stopRemoteBridge();
      setRunning(false);
      const updated = { ...bridgeCfg, enabled: false };
      setBridgeCfg(updated);
      m.setBridgeConfig(updated);
    } else {
      const chatIds = chatIdsInput.split(",").map((s: string) => s.trim()).filter(Boolean);
      const updated = { ...bridgeCfg, enabled: true, allowedChatIds: chatIds };
      setBridgeCfg(updated);
      m.setBridgeConfig(updated);
      m.startRemoteBridge();
      setRunning(true);
    }
  };

  return (
    <Paper p="md" radius="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Text fw={600}>{`🌐 ${t("settings.remoteBridge")}`}</Text>
        <Badge color={running ? "green" : "gray"} variant="light">
          {running ? `🟢 ${t("settings.bridgeRunning")}` : `⚪ ${t("settings.bridgeStopped")}`}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        {t("settings.remoteBridgeHint")}
      </Text>

      <Stack gap="md">
        <TextInput
          label={t("settings.allowedChatIds")}
          placeholder={t("settings.allowedChatIdsPlaceholder")}
          value={chatIdsInput}
          onChange={(e) => setChatIdsInput(e.currentTarget.value)}
          description={t("settings.allowedChatIdsHint")}
        />

        <TextInput
          label={t("settings.pollInterval")}
          placeholder="3000"
          value={String(bridgeCfg.pollIntervalMs || 3000)}
          onChange={(e) => setBridgeCfg({ ...bridgeCfg, pollIntervalMs: parseInt(e.currentTarget.value) || 3000 })}
          description={t("settings.pollIntervalHint")}
        />

        <Button
          onClick={handleToggle}
          color={running ? "red" : "green"}
          variant="light"
          fullWidth
          leftSection={<Icon name={running ? "stop" : "send"} size={14} />}
        >
          {running ? t("settings.stopRemoteBridge") : t("settings.startRemoteBridge")}
        </Button>
      </Stack>
    </Paper>
  );
}

export default SettingsPage;
