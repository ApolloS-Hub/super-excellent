import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AppShell, Burger, Group, Title, ActionIcon, Menu, Text, Box, Mark,
  NavLink, Divider, Button, Stack, ScrollArea, TextInput,
  CloseButton, Tooltip, useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import MonitorPage from "./pages/MonitorPage";
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

type Page = "chat" | "settings" | "monitor";

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

  // Initialize runtime
  useEffect(() => {
    // Register built-in agents
    ["secretary", "developer", "tester", "devops", "writer", "product"].forEach(id => {
      registerAgent({ agentId: id, displayName: id });
    });
    startMonitor();
  }, []);

  // Check for updates on mount
  useEffect(() => {
    check().then(async (update) => {
      if (update) {
        console.log(`Update available: ${update.version}`);
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

  // Persist conversations when active one changes
  useEffect(() => {
    const active = conversations.find(c => c.id === activeConvId);
    if (active) {
      saveConversationsAsync([active]).catch(console.error);
    }
  }, [conversations, activeConvId]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        handleNewConversation();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setCurrentPage("settings");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
    setConversations(prev => {
      const current = prev.find(c => c.id === activeConvId);
      if (current && current.messages.length === 0) {
        setCurrentPage("chat");
        close();
        return prev;
      }
      const conv = createConversation();
      setActiveConvId(conv.id);
      setCurrentPage("chat");
      close();
      return [conv, ...prev];
    });
  }, [close, activeConvId]);

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

  // Group conversations by date (Today / This Week / Older)
  const groupedConversations = groupConversationsByDate(filteredConversations);

  // Auto-create a conversation if none exist
  useEffect(() => {
    if (conversations.length === 0) {
      handleNewConversation();
    } else if (!activeConvId || !conversations.find(c => c.id === activeConvId)) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations.length]);

  const activeConversation = conversations.find(c => c.id === activeConvId) || null;

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{
        width: 280,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={3}>🌟 {t("app.title")}</Title>
          </Group>
          <Group gap="xs">
            <ActionIcon variant="subtle" size="lg" onClick={() => toggleColorScheme()}>
              <Text size="sm">{colorScheme === "dark" ? "🌙" : "☀️"}</Text>
            </ActionIcon>
            <Menu>
              <Menu.Target>
                <ActionIcon variant="subtle" size="lg">
                  <Text size="sm">{currentLang === "zh-CN" ? "中" : "EN"}</Text>
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
        <Stack gap="xs" h="100%">
          {/* Search */}
          <TextInput
            placeholder={t("nav.searchConversations")}
            size="xs"
            value={searchQuery}
            onChange={e => setSearchQuery(e.currentTarget.value)}
            rightSection={searchQuery ? <CloseButton size="xs" onClick={() => setSearchQuery("")} /> : undefined}
          />

          {/* New conversation button */}
          <Button
            fullWidth
            variant="light"
            size="sm"
            onClick={handleNewConversation}
            leftSection={<Text size="sm">➕</Text>}
          >
            {t("nav.newConversation")}
          </Button>

          {/* Conversation list — grouped by date */}
          <ScrollArea flex={1} offsetScrollbars>
            <Stack gap={2}>
              {filteredConversations.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  {t("nav.noConversations")}
                </Text>
              )}
              {groupedConversations.map(group => (
                <Box key={group.label}>
                  <Text size="xs" fw={700} c="dimmed" px="xs" pt="sm" pb={4}
                    style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
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

          {/* Cost summary */}
          {sessionCost > 0 && (
            <Text size="xs" c="dimmed" ta="center" py={4}>
              💰 {sessionCost < 0.01 ? `$${sessionCost.toFixed(4)}` : `$${sessionCost.toFixed(2)}`}
            </Text>
          )}

          {/* Bottom nav */}
          <Divider />
          <NavLink
            label={t("nav.settings")}
            leftSection={<Text size="sm">⚙️</Text>}
            active={currentPage === "settings"}
            onClick={() => { setCurrentPage("settings"); close(); }}
            py={6}
          />
          <NavLink
            label={t("nav.agents")}
            leftSection={<Text size="sm">🤖</Text>}
            active={currentPage === "monitor"}
            onClick={() => { setCurrentPage("monitor"); close(); }}
            py={6}
          />
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {currentPage === "chat" && (
          <ChatPage
            conversation={activeConversation}
            conversations={conversations}
            onConversationsUpdate={handleConversationsUpdate}
            onNewConversation={handleNewConversation}
          />
        )}
        {currentPage === "settings" && (
          <SettingsPage onBack={() => setCurrentPage("chat")} />
        )}
        {currentPage === "monitor" && (
          <MonitorPage onBack={() => setCurrentPage("chat")} />
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

// ═══════ Grouping helper (inspired by Hive HistorySidebar) ═══════

function groupConversationsByDate(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekAgo = todayStart - 7 * 86_400_000;
  const groups: { label: string; items: Conversation[] }[] = [
    { label: "📅 今天", items: [] },
    { label: "📆 本周", items: [] },
    { label: "🗓️ 更早", items: [] },
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
  const preview = lastMsg
    ? lastMsg.content.slice(0, 40) + (lastMsg.content.length > 40 ? "..." : "")
    : t("nav.noMessages");

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
      px="xs"
      py={6}
      style={{
        borderRadius: 6,
        cursor: "pointer",
        backgroundColor: active ? "var(--mantine-color-blue-light)" : "transparent",
      }}
      onClick={() => !editing && onSelect(conv.id)}
      onContextMenu={e => {
        e.preventDefault();
        const action = window.prompt("操作: 输入新名称(改名) 或输入 delete(删除)", conv.title);
        if (action === null) return;
        if (action.toLowerCase() === "delete") {
          onDelete(conv.id);
        } else if (action.trim() && action.trim() !== conv.title) {
          onRename(conv.id, action.trim());
        }
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--mantine-color-default-hover)";
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
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
          <Text size="xs" c="dimmed" truncate>{preview}</Text>
          {msgCount > 0 && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{msgCount}条</Text>
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
