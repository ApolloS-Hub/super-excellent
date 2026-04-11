/**
 * OnboardingWizard — First-time setup wizard for non-technical users.
 *
 * Guides new users (operations, marketing, HR) through:
 *   0. Welcome & explanation of the Secretary-Worker pattern
 *   1. Select AI provider
 *   2. Enter & validate API key
 *   3. Choose language
 *   4. Summary / Get Started
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Stepper, Button, Select, PasswordInput, Text, Paper, Stack,
  Group, Badge, Center, Title,
} from "@mantine/core";

// ── Provider definitions ────────────────────────────────────────────

interface ProviderInfo {
  value: string;
  label: string;
  defaultModel: string;
}

const PROVIDERS: ProviderInfo[] = [
  { value: "anthropic",  label: "Anthropic (Claude)",  defaultModel: "claude-sonnet-4-6" },
  { value: "openai",     label: "OpenAI (GPT)",        defaultModel: "gpt-4o" },
  { value: "google",     label: "Google (Gemini)",      defaultModel: "gemini-2.5-flash" },
  { value: "deepseek",   label: "DeepSeek",             defaultModel: "deepseek-chat" },
  { value: "kimi",       label: "Kimi (Moonshot)",      defaultModel: "moonshot-v1-128k" },
  { value: "ollama",     label: "Ollama (Local)",       defaultModel: "llama3.1" },
  { value: "compatible", label: "Custom / Other",       defaultModel: "" },
];

const LANGUAGES = [
  { value: "zh-CN", label: "中文" },
  { value: "en-US", label: "English" },
];

// ── Props ───────────────────────────────────────────────────────────

export interface OnboardingWizardProps {
  onComplete: (config: {
    provider: string;
    apiKey: string;
    model: string;
    language: string;
  }) => void;
  onSkip: () => void;
}

// ── Team member badges shown on the welcome screen ──────────────────

const TEAM_MEMBERS = [
  { name: "Secretary", color: "blue" },
  { name: "Developer", color: "grape" },
  { name: "Tester",    color: "green" },
  { name: "DevOps",    color: "orange" },
  { name: "Writer",    color: "pink" },
  { name: "Product",   color: "cyan" },
];

// ── Component ───────────────────────────────────────────────────────

export default function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const { t } = useTranslation();

  const [active, setActive] = useState(0);
  const [provider, setProvider] = useState<string>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [keyValidated, setKeyValidated] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [language, setLanguage] = useState<string>("en-US");

  // Derive the model from the selected provider
  const selectedProvider = PROVIDERS.find(p => p.value === provider);
  const model = selectedProvider?.defaultModel ?? "";

  // ── Navigation ──────────────────────────────────────────────────

  const nextStep = useCallback(() => setActive(prev => Math.min(prev + 1, 4)), []);
  const prevStep = useCallback(() => setActive(prev => Math.max(prev - 1, 0)), []);

  // ── Validate API key (lightweight client-side check) ────────────

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setValidationError("");

    try {
      // Basic format validation — a real call would hit the provider
      if (!apiKey.trim()) {
        setValidationError(t("onboarding.keyEmpty"));
        return;
      }

      // Provider-specific format hints
      if (provider === "anthropic" && !apiKey.startsWith("sk-ant-")) {
        setValidationError(t("onboarding.keyFormatHintAnthropic"));
        return;
      }
      if (provider === "openai" && !apiKey.startsWith("sk-")) {
        setValidationError(t("onboarding.keyFormatHintOpenAI"));
        return;
      }

      // Treat as valid for now — full verification happens at first request
      setKeyValidated(true);
    } finally {
      setValidating(false);
    }
  }, [apiKey, provider, t]);

  // ── Finish ──────────────────────────────────────────────────────

  const handleComplete = useCallback(() => {
    onComplete({ provider, apiKey, model, language });
  }, [onComplete, provider, apiKey, model, language]);

  // ── Can-advance guards ──────────────────────────────────────────

  const canAdvanceFromStep1 = !!provider;
  const canAdvanceFromStep2 = provider === "ollama" || keyValidated;
  const canAdvanceFromStep3 = !!language;

  // ── Render ──────────────────────────────────────────────────────

  return (
    <Center mih="100vh" p="md">
      <Paper shadow="lg" radius="md" p="xl" w="100%" maw={600}>
        <Stack gap="lg">
          <Stepper active={active} onStepClick={setActive} size="sm" allowNextStepsSelect={false}>
            {/* ── Step 0: Welcome ────────────────────────────── */}
            <Stepper.Step label={t("onboarding.stepWelcome")}>
              <Stack gap="md" mt="md">
                <Title order={2} ta="center">
                  {t("onboarding.welcomeTitle")}
                </Title>

                <Text size="md" ta="center" c="dimmed">
                  {t("onboarding.welcomeSubtitle")}
                </Text>

                <Paper p="md" radius="sm" withBorder>
                  <Text size="sm" mb="xs" fw={600}>
                    {t("onboarding.howItWorks")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {t("onboarding.secretaryWorkerExplanation")}
                  </Text>
                </Paper>

                <Text size="sm" fw={600}>
                  {t("onboarding.yourTeam")}
                </Text>
                <Group gap="xs" justify="center">
                  {TEAM_MEMBERS.map(member => (
                    <Badge key={member.name} color={member.color} variant="light" size="lg">
                      {member.name}
                    </Badge>
                  ))}
                </Group>
              </Stack>
            </Stepper.Step>

            {/* ── Step 1: Choose provider ────────────────────── */}
            <Stepper.Step label={t("onboarding.stepProvider")}>
              <Stack gap="md" mt="md">
                <Title order={3}>{t("onboarding.chooseProvider")}</Title>
                <Text size="sm" c="dimmed">
                  {t("onboarding.providerHint")}
                </Text>

                <Select
                  label={t("onboarding.providerLabel")}
                  data={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                  value={provider}
                  onChange={val => {
                    setProvider(val ?? "anthropic");
                    // Reset validation when switching providers
                    setKeyValidated(false);
                    setValidationError("");
                  }}
                  allowDeselect={false}
                />

                {selectedProvider && selectedProvider.defaultModel && (
                  <Text size="xs" c="dimmed">
                    {t("onboarding.defaultModel")}: <strong>{selectedProvider.defaultModel}</strong>
                  </Text>
                )}
              </Stack>
            </Stepper.Step>

            {/* ── Step 2: API Key ────────────────────────────── */}
            <Stepper.Step label={t("onboarding.stepApiKey")}>
              <Stack gap="md" mt="md">
                <Title order={3}>{t("onboarding.enterApiKey")}</Title>

                {provider === "ollama" ? (
                  <Text size="sm" c="dimmed">
                    {t("onboarding.ollamaNoKey")}
                  </Text>
                ) : (
                  <>
                    <Text size="sm" c="dimmed">
                      {t("onboarding.apiKeyHint")}
                    </Text>

                    <PasswordInput
                      label={t("onboarding.apiKeyLabel")}
                      placeholder={t("onboarding.apiKeyPlaceholder")}
                      value={apiKey}
                      onChange={e => {
                        setApiKey(e.currentTarget.value);
                        setKeyValidated(false);
                        setValidationError("");
                      }}
                    />

                    {validationError && (
                      <Text size="sm" c="red">
                        {validationError}
                      </Text>
                    )}

                    {keyValidated && (
                      <Text size="sm" c="green">
                        {t("onboarding.keyValid")}
                      </Text>
                    )}

                    <Button
                      variant="light"
                      onClick={handleValidate}
                      loading={validating}
                      disabled={!apiKey.trim()}
                    >
                      {t("onboarding.validate")}
                    </Button>
                  </>
                )}
              </Stack>
            </Stepper.Step>

            {/* ── Step 3: Language ───────────────────────────── */}
            <Stepper.Step label={t("onboarding.stepLanguage")}>
              <Stack gap="md" mt="md">
                <Title order={3}>{t("onboarding.chooseLanguage")}</Title>
                <Text size="sm" c="dimmed">
                  {t("onboarding.languageHint")}
                </Text>

                <Select
                  label={t("onboarding.languageLabel")}
                  data={LANGUAGES}
                  value={language}
                  onChange={val => setLanguage(val ?? "en-US")}
                  allowDeselect={false}
                />
              </Stack>
            </Stepper.Step>

            {/* ── Step 4: Ready ──────────────────────────────── */}
            <Stepper.Completed>
              <Stack gap="md" mt="md">
                <Title order={3} ta="center">
                  {t("onboarding.readyTitle")}
                </Title>
                <Text size="sm" ta="center" c="dimmed">
                  {t("onboarding.readySummary")}
                </Text>

                <Paper p="md" radius="sm" withBorder>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>{t("onboarding.summaryProvider")}:</Text>
                      <Badge variant="light">{selectedProvider?.label ?? provider}</Badge>
                    </Group>
                    {model && (
                      <Group justify="space-between">
                        <Text size="sm" fw={600}>{t("onboarding.summaryModel")}:</Text>
                        <Text size="sm" c="dimmed">{model}</Text>
                      </Group>
                    )}
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>{t("onboarding.summaryApiKey")}:</Text>
                      <Text size="sm" c="dimmed">
                        {provider === "ollama"
                          ? t("onboarding.notRequired")
                          : apiKey
                            ? `${apiKey.slice(0, 6)}${"*".repeat(Math.min(apiKey.length - 6, 20))}`
                            : "-"}
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>{t("onboarding.summaryLanguage")}:</Text>
                      <Text size="sm" c="dimmed">
                        {LANGUAGES.find(l => l.value === language)?.label ?? language}
                      </Text>
                    </Group>
                  </Stack>
                </Paper>

                <Button fullWidth size="md" onClick={handleComplete}>
                  {t("onboarding.getStarted")}
                </Button>
              </Stack>
            </Stepper.Completed>
          </Stepper>

          {/* ── Bottom navigation ──────────────────────────────── */}
          {active < 4 && (
            <Group justify="space-between">
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                onClick={onSkip}
              >
                {t("onboarding.skip")}
              </Button>

              <Group gap="sm">
                {active > 0 && (
                  <Button variant="default" onClick={prevStep}>
                    {t("onboarding.back")}
                  </Button>
                )}
                <Button
                  onClick={nextStep}
                  disabled={
                    (active === 1 && !canAdvanceFromStep1) ||
                    (active === 2 && !canAdvanceFromStep2) ||
                    (active === 3 && !canAdvanceFromStep3)
                  }
                >
                  {t("onboarding.next")}
                </Button>
              </Group>
            </Group>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
