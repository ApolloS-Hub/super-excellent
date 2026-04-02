import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  AppShell, Burger, Group, Title, ActionIcon, Menu, Text,
  NavLink, Divider,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import MonitorPage from "./pages/MonitorPage";
import { PermissionDialog, permissionManager } from "./components/PermissionDialog";
import type { PermissionRequest } from "./components/PermissionDialog";

type Page = "chat" | "settings" | "monitor";

function App() {
  const { t, i18n } = useTranslation();
  const [opened, { toggle }] = useDisclosure();
  const [currentPage, setCurrentPage] = useState<Page>("chat");
  const [currentLang, setCurrentLang] = useState(i18n.language);
  const [permRequest, setPermRequest] = useState<PermissionRequest | null>(null);

  // Listen for permission requests from the PermissionManager
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as PermissionRequest;
      setPermRequest(detail);
    };
    window.addEventListener("permission-request", handler);
    return () => window.removeEventListener("permission-request", handler);
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

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{
        width: 220,
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
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <NavLink
          label={t("nav.conversations")}
          leftSection={<Text>💬</Text>}
          active={currentPage === "chat"}
          onClick={() => setCurrentPage("chat")}
        />
        <NavLink
          label={t("nav.settings")}
          leftSection={<Text>⚙️</Text>}
          active={currentPage === "settings"}
          onClick={() => setCurrentPage("settings")}
        />
        <Divider my="sm" />
        <NavLink
          label={t("nav.agents")}
          leftSection={<Text>🤖</Text>}
          active={currentPage === "monitor"}
          onClick={() => setCurrentPage("monitor")}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        {currentPage === "chat" && <ChatPage />}
        {currentPage === "settings" && (
          <SettingsPage onBack={() => setCurrentPage("chat")} />
        )}
        {currentPage === "monitor" && (
          <MonitorPage onBack={() => setCurrentPage("chat")} />
        )}
      </AppShell.Main>

      {/* Permission approval dialog */}
      <PermissionDialog
        request={permRequest}
        onApprove={handlePermApprove}
        onDeny={handlePermDeny}
        onClose={() => setPermRequest(null)}
      />
    </AppShell>
  );
}

export default App;
