import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, TextInput, Select, Button, Text, Paper, Group,
  PasswordInput, Notification,
} from "@mantine/core";
import { loadConfig, saveConfig } from "../lib/agent-bridge";
import type { AgentConfig } from "../lib/agent-bridge";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "compatible", label: "Compatible Endpoint" },
];

const MODEL_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-6", label: "Claude Opus 4" },
    { value: "claude-haiku-3-5", label: "Claude Haiku 3.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o3-mini", label: "o3-mini" },
  ],
  compatible: [
    { value: "custom", label: "Custom Model" },
  ],
};

interface SettingsPageProps {
  onBack: () => void;
}

function SettingsPage({ onBack }: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<AgentConfig>(loadConfig());
  const [saved, setSaved] = useState(false);
  const [customModel, setCustomModel] = useState("");

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const handleSave = () => {
    const toSave = { ...config };
    if (config.provider === "compatible" && customModel) {
      toSave.model = customModel;
    }
    saveConfig(toSave);
    setSaved(true);
  };

  const models = MODEL_OPTIONS[config.provider] || MODEL_OPTIONS.compatible;

  return (
    <Stack maw={600} mx="auto">
      <Group justify="space-between">
        <Text size="xl" fw={700}>{t("settings.title")}</Text>
        <Button variant="subtle" onClick={onBack}>← {t("nav.conversations")}</Button>
      </Group>

      {saved && (
        <Notification color="green" withCloseButton={false}>
          ✅ {t("settings.saved")}
        </Notification>
      )}

      <Paper p="md" radius="md" withBorder>
        <Stack gap="md">
          <Select
            label={t("settings.provider")}
            data={PROVIDER_OPTIONS}
            value={config.provider}
            onChange={(val) => setConfig({ ...config, provider: val as AgentConfig["provider"] })}
          />

          <PasswordInput
            label={t("settings.apiKey")}
            placeholder="sk-..."
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.currentTarget.value })}
          />

          {config.provider === "compatible" && (
            <TextInput
              label={t("settings.baseUrl")}
              placeholder="https://api.example.com"
              value={config.baseURL || ""}
              onChange={(e) => setConfig({ ...config, baseURL: e.currentTarget.value })}
            />
          )}

          <Select
            label={t("settings.model")}
            data={models}
            value={models.find(m => m.value === config.model) ? config.model : "custom"}
            onChange={(val) => setConfig({ ...config, model: val || config.model })}
          />

          {(config.provider === "compatible" || !models.find(m => m.value === config.model)) && (
            <TextInput
              label="Custom Model ID"
              placeholder="model-name"
              value={customModel || config.model}
              onChange={(e) => setCustomModel(e.currentTarget.value)}
            />
          )}

          <Select
            label={t("settings.language")}
            data={[
              { value: "zh-CN", label: "中文" },
              { value: "en-US", label: "English" },
            ]}
            value={i18n.language}
            onChange={(val) => val && i18n.changeLanguage(val)}
          />

          <Button onClick={handleSave} fullWidth>
            {t("settings.save")}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default SettingsPage;
