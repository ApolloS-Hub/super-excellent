import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AppShell, Burger, Group, ActionIcon, Menu, Text, Box, Mark,
  Divider, Button, Stack, ScrollArea, TextInput,
  CloseButton, Tooltip, useMantineColorScheme, Badge,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import MonitorPage from "./pages/MonitorPage";
import SkillMarketPage from "./pages/SkillMarketPage";
import Icon from "./components/Icon";
import { PermissionDialog, permissionManager } from "./components/PermissionDialog";
import type { PermissionRequest } from "./components/PermissionDialog";
import {
  loadConversationsAsync, saveConversationsAsync, createConversation,
  deleteConversation, renameConversation, relativeTime,
} from "./lib/conversations";
import { migrateFromLocalStorage } from "./lib/session-store";
import { registerAgent, startMonitor } from "./lib/runtime";
import type { Conversation } from "./lib/conversations";
import { setState as setAppState } from "./lib/app-state";
import { check } from "@tauri-apps/plugin-updater";
import { startHealthMonitor, stopHealthMonitor, backupConfig } from "./lib/health-monitor";
import { startStaleDetection, stopStaleDetection } from "./lib/worker-state-machine";
import { initStopHooks } from "./lib/stop-hooks";
import OnboardingWizard from "./components/OnboardingWizard";

type Page = "chat" | "settings" | "monitor" | "skills";

function App() {
  const { t, i18n } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure();
  const [currentPage, setCurrentPage] = useState<Page>("chat");
  const [currentLang, setCurrentLang] = useState(i18n.language);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [permRequest, setPermRequest] = useState<PermissionRequest | null>(null);

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionCost, setSessionCost] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Split-screen state
  const [splitMode, setSplitMode] = useState(false);
  const [splitConvId, setSplitConvId] = useState<string | null>(null);

  // Initialize runtime + health monitor
  useEffect(() => {
    // Register built-in agents
    ["secretary", "developer", "tester", "devops", "writer", "product"].forEach(id => {
      registerAgent({ agentId: id, displayName: id });
    });
    startMonitor();
    startHealthMonitor();
    startStaleDetection();
    initStopHooks();
    // Desktop notification hook for turn completion
    import("./lib/desktop-notify").then(m => m.initDesktopNotifications()).catch(console.warn);
    // Load bundled markdown skills for workflow guidance injection
    import("./lib/skills").then(m => m.loadMarkdownSkills()).catch(console.warn);
    // Migrate API keys to secure store
    import("./lib/secure-store").then(m => m.migrateApiKeyFromConfig()).catch(console.warn);
    // Load MCP config and connect servers on startup
    import("./lib/mcp-client").then(m => m.loadMCPConfig()).catch(console.warn);
    // Initialize Lark integration
    import("./lib/lark-integration").then(m => m.initLark()).catch(console.warn);
    // Initialize scenario engine (framework-first scaffolding)
    import("./lib/scenario-engine").then(m => m.initScenarioEngine()).catch(console.warn);
    // Initialize strategy presets (evolver-inspired)
    import("./lib/strategy-presets").then(m => m.initStrategy()).catch(console.warn);
    // Bootstrap cross-session context
    import("./lib/context-bootstrap").then(m => m.autoCollectContext()).catch(console.warn);
    // Start observation log auto-capture (subscribes to event bus)
    import("./lib/observation-log").then(m => m.startAutoCapture()).catch(console.warn);
    // Start memory nudges (proactive memory from conversations)
    import("./lib/memory-nudge").then(async (nudge) => {
      const { onAgentEvent } = await import("./lib/event-bus");
      let lastUserMsg = "";
      onAgentEvent((event) => {
        const type = event.type as string;
        if (type === "user_message") lastUserMsg = (event.text as string) || "";
        if (type === "result" && lastUserMsg) {
          const assistantText = (event.text as string) || "";
          nudge.nudgeMemory(lastUserMsg, assistantText).catch(() => {});
          lastUserMsg = "";
        }
      });
    }).catch(console.warn);
    // Load persisted tasks from IndexedDB
    import("./lib/runtime/task-store").then(m => m.loadTasksFromIDB()).catch(console.warn);
    // Initialize memory bridge
    import("./lib/memory-bridge").then(m => m.initMemoryBridge()).catch(console.warn);
    // Check if onboarding is needed (no API key configured)
    try {
      const raw = localStorage.getItem("agent-config");
      if (!raw) {
        setShowOnboarding(true);
      } else {
        const config = JSON.parse(raw);
        if (!config.apiKey) {
          setShowOnboarding(true);
        }
      }
    } catch { setShowOnboarding(true); }
    return () => { stopHealthMonitor(); stopStaleDetection(); };
  }, []);

  // Auto health check + repair on startup
  useEffect(() => {
    import("./lib/tauri-bridge").then(async ({ healthCheck, repairConfig, isTauriAvailable }) => {
      if (!isTauriAvailable()) return;
      try {
        const status = await healthCheck();
        if (!status.config_valid) {
          console.warn("Config invalid on startup, auto-repairing:", status.config_error);
          await repairConfig();
        }
      } catch (e) {
        console.warn("Startup health check failed:", e);
      }
    }).catch(() => { /* tauri-bridge not available */ });
  }, []);

  // Check for updates on mount
  useEffect(() => {
    check().then(async (update) => {
      if (update) {
        if (window.confirm(`New version ${update.version} available. Update now?`)) {
          await update.downloadAndInstall();
        }
      }
    }).catch((e) => {
      console.warn("Update check failed:", e);
    });
  }, []);

  // Load conversations on mount
  useEffect(() => {
    migrateFromLocalStorage().then(() => {
      loadConversationsAsync().then(convs => {
        setConversations(convs);
        if (convs.length > 0 && !activeConvId) {
          setActiveConvId(convs[0].id);
        }
      });
    });
  }, []); // activeConvId is intentionally omitted to only set it on initial load if null

  // Persist ALL conversations when any change occurs
  useEffect(() => {
    if (conversations.length > 0) {
      saveConversationsAsync(conversations).catch(console.error);
      // Also sync to localStorage as backup
      try {
        localStorage.setItem("conversations", JSON.stringify(conversations));
      } catch (e) {
        console.warn("localStorage quota exceeded on conversations backup:", e);
      }
    } else {
      try {
        localStorage.removeItem("conversations");
      } catch (e) {
        console.warn("localStorage removeItem(conversations) failed:", e);
      }
    }
  }, [conversations]);

  // Load cost data
  useEffect(() => {
    import("./lib/cost-tracker").then(m => {
      m.getTotalUsage().then(d => setSessionCost(d.totalCost));
    });
    const timer = setInterval(() => {
      import("./lib/cost-tracker").then(m => m.getTotalUsage().then(d => setSessionCost(d.totalCost)));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Permission events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as PermissionRequest;
      setPermRequest(detail);
    };
    window.addEventListener("permission-request", handler);
    return () => window.removeEventListener("permission-request", handler);
  }, []);

  // Mirror page / conversations / active conversation into AppState so any
  // consumer (e.g. /context command) can read them via getState() or useAppState().
  useEffect(() => {
    setAppState({ currentPage, conversations, activeConversationId: activeConvId });
  }, [currentPage, conversations, activeConvId]);

  // Keyboard shortcuts — comprehensive system
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + N — New conversation
      if (mod && e.key === "n") {
        e.preventDefault();
        handleNewConversation();
        return;
      }

      // Cmd/Ctrl + , — Open settings
      if (mod && e.key === ",") {
        e.preventDefault();
        setCurrentPage("settings");
        return;
      }

      // Cmd/Ctrl + Enter — Send message (dispatched to active textarea)
      if (mod && e.key === "Enter") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("shortcut-send"));
        return;
      }

      // Cmd/Ctrl + Shift + S — Stop generation
      if (mod && e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("shortcut-stop"));
        return;
      }

      // Cmd/Ctrl + 1/2/3 — Switch to Nth conversation
      if (mod && ["1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const sortedConvs = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
        if (idx < sortedConvs.length) {
          setActiveConvId(sortedConvs[idx].id);
          setCurrentPage("chat");
        }
        return;
      }

      // Escape — Close modals / exit split mode / back to chat
      if (e.key === "Escape") {
        if (splitMode) {
          setSplitMode(false);
          setSplitConvId(null);
          return;
        }
        if (currentPage !== "chat") {
          setCurrentPage("chat");
          return;
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [conversations, currentPage, splitMode]);

  const handlePermApprove = useCallback((id: string, remember: boolean) => {
    permissionManager.approve(id, remember);
    setPermRequest(null);
  }, []);

  const handlePermDeny = useCallback((id: string) => {
    permissionManager.deny(id);
    setPermRequest(null);
  }, []);

  const switchLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    setCurrentLang(lang);
  };

  // Conversation actions
  const handleNewConversation = useCallback(() => {
    // Reuse any existing empty conversation instead of creating duplicates
    const emptyConv = conversations.find(c => c.messages.length === 0);
    if (emptyConv) {
      setActiveConvId(emptyConv.id);
      setCurrentPage("chat");
      close();
      return;
    }
    const conv = createConversation();
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    setCurrentPage("chat");
    close();
  }, [close, conversations]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConvId(id);
    setCurrentPage("chat");
    close();
  }, [close]);

  const handleDeleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const next = deleteConversation(prev, id);
      return next;
    });
    if (activeConvId === id) {
      setActiveConvId(null);
    }
  }, [activeConvId]);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => renameConversation(prev, id, title));
  }, []);

  const handleConversationsUpdate = useCallback((updated: Conversation[]) => {
    setConversations(updated);
  }, []);

  // Filter conversations
  const filteredConversations = searchQuery
    ? conversations.filter(c =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : conversations;

  // Sort by updatedAt (most recent first) then group by date
  const sortedConversations = [...filteredConversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const groupedConversations = groupConversationsByDate(sortedConversations, t);

  // Auto-create a conversation if none exist
  useEffect(() => {
    if (conversations.length === 0) {
      handleNewConversation();
    } else if (!activeConvId || !conversations.find(c => c.id === activeConvId)) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations.length]);

  const activeConversation = conversations.find(c => c.id === activeConvId) || null;

  const handleOnboardingComplete = useCallback((config: { provider: string; apiKey: string; model: string; language: string }) => {
    // Save config
    const fullConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      language: config.language,
      theme: colorScheme,
    };
    localStorage.setItem("agent-config", JSON.stringify(fullConfig));
    backupConfig();
    // Switch language
    i18n.changeLanguage(config.language);
    setCurrentLang(config.language);
    setShowOnboarding(false);
  }, [colorScheme, i18n]);

  const handleOnboardingSkip = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  // Show onboarding wizard if needed
  if (showOnboarding) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} onSkip={handleOnboardingSkip} />;
  }

  return (
    <AppShell
      header={{ height: 46 }}
      navbar={{
        width: 256,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header className="app-header">
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <span className="app-brand">
              <span className="app-brand-mark">
                <Icon name="sparkle" size={14} stroke={2} />
              </span>
              <span className="app-brand-text">{t("app.title")}</span>
            </span>
          </Group>
          <Group gap={2}>
            <Tooltip label={splitMode ? t("nav.singleScreen") : t("nav.splitScreen")} position="bottom" openDelay={400}>
              <ActionIcon
                variant={splitMode ? "light" : "subtle"}
                size="md"
                color={splitMode ? "indigo" : "gray"}
                onClick={() => {
                  if (!splitMode) {
                    const otherConvs = conversations.filter(c => c.id !== activeConvId);
                    if (otherConvs.length > 0) {
                      setSplitConvId(otherConvs[0].id);
                      setSplitMode(true);
                    } else {
                      const newConv = createConversation();
                      setConversations(prev => [newConv, ...prev]);
                      setSplitConvId(newConv.id);
                      setSplitMode(true);
                    }
                  } else {
                    setSplitMode(false);
                    setSplitConvId(null);
                  }
                }}
                aria-label={splitMode ? t("nav.singleScreen") : t("nav.splitScreen")}
              >
                <Icon name={splitMode ? "single" : "split"} size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={colorScheme === "dark" ? t("settings.light") : t("settings.dark")} position="bottom" openDelay={400}>
              <ActionIcon variant="subtle" size="md" color="gray" onClick={() => toggleColorScheme()} aria-label="Toggle theme">
                <Icon name={colorScheme === "dark" ? "sun" : "moon"} size={15} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <ActionIcon variant="subtle" size="md" color="gray" aria-label="Language">
                  <Text size="xs" fw={600} style={{ letterSpacing: "0.03em" }}>
                    {currentLang === "zh-CN" ? "中" : "EN"}
                  </Text>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => switchLanguage("zh-CN")}>中文</Menu.Item>
                <Menu.Item onClick={() => switchLanguage("en-US")}>English</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Stack gap={8} h="100%">
          {/* Search */}
          <TextInput
            placeholder={t("nav.searchConversations")}
            size="xs"
            value={searchQuery}
            onChange={e => setSearchQuery(e.currentTarget.value)}
            leftSection={<Icon name="search" size={13} />}
            leftSectionWidth={28}
            rightSection={searchQuery ? <CloseButton size="xs" onClick={() => setSearchQuery("")} /> : undefined}
            styles={{ input: { height: 32, minHeight: 32 } }}
          />

          {/* New conversation — solid filled, calm */}
          <Button
            fullWidth
            variant="filled"
            color="indigo"
            size="sm"
            radius="md"
            onClick={handleNewConversation}
            leftSection={<Icon name="plus" size={14} stroke={2.2} />}
            styles={{
              root: { fontWeight: 550, letterSpacing: "-0.005em", height: 34 },
            }}
          >
            {t("nav.newConversation")}
          </Button>

          {/* Conversation list */}
          <ScrollArea flex={1} offsetScrollbars scrollbarSize={6}>
            <Stack gap={1}>
              {filteredConversations.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  {t("nav.noConversations")}
                </Text>
              )}
              {groupedConversations.map(group => (
                <Box key={group.label}>
                  <Text className="sidebar-section-label">
                    {group.label}
                  </Text>
                  {group.items.map(conv => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      active={conv.id === activeConvId}
                      searchQuery={searchQuery}
                      onSelect={handleSelectConversation}
                      onDelete={handleDeleteConversation}
                      onRename={handleRenameConversation}
                    />
                  ))}
                </Box>
              ))}
            </Stack>
          </ScrollArea>

          {/* Cost card */}
          {sessionCost > 0 && (
            <div className="cost-card">
              <span className="cost-card-label">{t("monitor.costOverview")}</span>
              <span className="cost-card-value">
                {sessionCost < 0.01 ? `$${sessionCost.toFixed(4)}` : `$${sessionCost.toFixed(2)}`}
              </span>
            </div>
          )}

          {/* Bottom nav */}
          <Divider my={2} />
          <Stack gap={1}>
            <button
              type="button"
              className={`nav-item${currentPage === "monitor" ? " nav-item-active" : ""}`}
              onClick={() => { setCurrentPage("monitor"); close(); }}
            >
              <Icon name="users" size={15} />
              <span>{t("nav.agents")}</span>
            </button>
            <button
              type="button"
              className={`nav-item${currentPage === "skills" ? " nav-item-active" : ""}`}
              onClick={() => { setCurrentPage("skills"); close(); }}
            >
              <Icon name="skills" size={15} />
              <span>{t("nav.skillMarket")}</span>
            </button>
            <button
              type="button"
              className={`nav-item${currentPage === "settings" ? " nav-item-active" : ""}`}
              onClick={() => { setCurrentPage("settings"); close(); }}
            >
              <Icon name="settings" size={15} />
              <span>{t("nav.settings")}</span>
            </button>
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {currentPage === "chat" && !splitMode && (
          <ChatPage
            conversation={activeConversation}
            conversations={conversations}
            onConversationsUpdate={handleConversationsUpdate}
            onNewConversation={handleNewConversation}
          />
        )}
        {currentPage === "chat" && splitMode && (
          <div style={{ display: "flex", gap: 4, height: "calc(100vh - 100px)" }}>
            {/* Left panel */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <SplitPanelHeader
                conversations={conversations}
                selectedId={activeConvId}
                onSelect={setActiveConvId}
                label="L"
              />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <ChatPage
                  conversation={activeConversation}
                  conversations={conversations}
                  onConversationsUpdate={handleConversationsUpdate}
                  onNewConversation={handleNewConversation}
                />
              </div>
            </div>
            {/* Divider */}
            <div style={{ width: 2, background: "var(--mantine-color-dark-4)", flexShrink: 0 }} />
            {/* Right panel */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <SplitPanelHeader
                conversations={conversations}
                selectedId={splitConvId}
                onSelect={setSplitConvId}
                label="R"
              />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <ChatPage
                  conversation={conversations.find(c => c.id === splitConvId) || null}
                  conversations={conversations}
                  onConversationsUpdate={handleConversationsUpdate}
                  onNewConversation={handleNewConversation}
                />
              </div>
            </div>
          </div>
        )}
        {currentPage === "settings" && (
          <SettingsPage onBack={() => setCurrentPage("chat")} />
        )}
        {currentPage === "monitor" && (
          <MonitorPage onBack={() => setCurrentPage("chat")} />
        )}
        {currentPage === "skills" && (
          <SkillMarketPage onBack={() => setCurrentPage("chat")} />
        )}
      </AppShell.Main>

      <PermissionDialog
        request={permRequest}
        onApprove={handlePermApprove}
        onDeny={handlePermDeny}
        onClose={() => setPermRequest(null)}
      />
    </AppShell>
  );
}

/** Split-panel conversation selector header */
function SplitPanelHeader({
  conversations,
  selectedId,
  onSelect,
  label,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const current = conversations.find(c => c.id === selectedId);
  return (
    <Group gap="xs" px="xs" py={4} style={{ borderBottom: "1px solid var(--mantine-color-dark-4)", flexShrink: 0 }}>
      <Badge size="xs" variant="light" color="blue">{label}</Badge>
      <Menu>
        <Menu.Target>
          <Button variant="subtle" size="xs" style={{ fontWeight: 500, maxWidth: 200 }}>
            <Text size="xs" truncate>{current?.title || t("nav.conversations")}</Text>
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {conversations.map(c => (
            <Menu.Item key={c.id} onClick={() => onSelect(c.id)}>
              <Text size="xs" truncate style={{ maxWidth: 250 }}>{c.title}</Text>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

// ═══════ Grouping helper (inspired by Hive HistorySidebar) ═══════

function groupConversationsByDate(convs: Conversation[], t: (key: string) => string): { label: string; items: Conversation[] }[] {
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekAgo = todayStart - 7 * 86_400_000;
  const groups: { label: string; items: Conversation[] }[] = [
    { label: t("nav.today"), items: [] },
    { label: t("nav.thisWeek"), items: [] },
    { label: t("nav.earlier"), items: [] },
  ];
  for (const c of convs) {
    const ts = c.updatedAt || now;
    if (ts >= todayStart) groups[0].items.push(c);
    else if (ts >= weekAgo) groups[1].items.push(c);
    else groups[2].items.push(c);
  }
  return groups.filter(g => g.items.length > 0);
}

// ═══════ Search highlight helper ═══════

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <Mark>{text.slice(idx, idx + query.length)}</Mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Single conversation item in sidebar */
function ConversationItem({
  conversation: conv,
  active,
  searchQuery,
  onSelect,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  active: boolean;
  searchQuery?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const msgCount = conv.messages.filter(m => m.role === "user").length;
  const lastMsg = conv.messages.filter(m => m.role === "assistant").pop();
  const defaultPreview = lastMsg
    ? lastMsg.content.slice(0, 40) + (lastMsg.content.length > 40 ? "..." : "")
    : t("nav.noMessages");

  // When searching, show matching message snippet instead of last message
  let preview = defaultPreview;
  let matchInContent = false;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const matchingMsg = conv.messages.find(m => m.content.toLowerCase().includes(q));
    if (matchingMsg) {
      matchInContent = true;
      const idx = matchingMsg.content.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 15);
      const end = Math.min(matchingMsg.content.length, idx + searchQuery.length + 25);
      preview = (start > 0 ? "..." : "") + matchingMsg.content.slice(start, end) + (end < matchingMsg.content.length ? "..." : "");
    }
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(conv.title);
    setEditing(true);
  };

  const commitRename = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conv.title) {
      onRename(conv.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <Group
      gap={0}
      wrap="nowrap"
      className={`conv-item${active ? " conv-item-active" : ""}`}
      onClick={() => !editing && onSelect(conv.id)}
      onContextMenu={e => {
        e.preventDefault();
        const action = window.prompt(t("nav.renameOrDeletePrompt"), conv.title);
        if (action === null) return;
        if (action.toLowerCase() === "delete") {
          onDelete(conv.id);
        } else if (action.trim() && action.trim() !== conv.title) {
          onRename(conv.id, action.trim());
        }
      }}
    >
      <Stack gap={0} flex={1} miw={0}>
        <Group justify="space-between" wrap="nowrap">
          {editing ? (
            <TextInput
              ref={inputRef}
              size="xs"
              value={editTitle}
              onChange={e => setEditTitle(e.currentTarget.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              onClick={e => e.stopPropagation()}
              styles={{ input: { padding: "0 4px", height: 22, minHeight: 22 } }}
              flex={1}
            />
          ) : (
            <Text size="sm" fw={500} truncate onDoubleClick={startEditing}>
              {searchQuery ? <HighlightText text={conv.title} query={searchQuery} /> : conv.title}
            </Text>
          )}
          {!editing && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{relativeTime(conv.updatedAt)}</Text>
          )}
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c={matchInContent ? "blue" : "dimmed"} truncate>
            {searchQuery ? <HighlightText text={preview} query={searchQuery} /> : preview}
          </Text>
          {msgCount > 0 && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{msgCount} {t("nav.messages")}</Text>
          )}
        </Group>
      </Stack>
      {!editing && (
        <Tooltip label={t("nav.deleteConversation")} position="right">
          <CloseButton
            size="xs"
            variant="subtle"
            onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
            ml={4}
          />
        </Tooltip>
      )}
    </Group>
  );
}

export default App;
