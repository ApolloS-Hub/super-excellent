import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, TextInput, Button, Group, Paper, Text,
  ScrollArea, Box, Badge,
} from "@mantine/core";
import { sendMessage, loadConfig } from "../lib/agent-bridge";
import type { ChatMessage, AgentEvent } from "../lib/agent-bridge";

function ChatPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);

    const config = loadConfig();

    const onEvent = (event: AgentEvent) => {
      if (event.type === "text" && event.text) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            last.content += event.text;
          }
          return updated;
        });
      } else if (event.type === "tool_use") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            last.toolCalls = [
              ...(last.toolCalls || []),
              { name: event.toolName || "?", input: event.toolInput || "" },
            ];
          }
          return updated;
        });
      } else if (event.type === "error") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            last.content = `❌ ${event.text}`;
            last.isStreaming = false;
          }
          return updated;
        });
      } else if (event.type === "result") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            last.isStreaming = false;
          }
          return updated;
        });
      }
    };

    try {
      await sendMessage(userMsg.content, config, onEvent);
    } catch (err) {
      onEvent({ type: "error", text: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  return (
    <Stack h="calc(100vh - 100px)" justify="space-between">
      <ScrollArea flex={1} viewportRef={viewport}>
        <Stack gap="sm" p="sm">
          {messages.length === 0 && (
            <Box ta="center" py="xl">
              <Text size="xl" fw={700}>🌟 {t("app.title")}</Text>
              <Text c="dimmed" mt="sm">{t("chat.welcome")}</Text>
              <Group mt="lg" justify="center" gap="xs">
                <Badge variant="light" color="blue">Claude</Badge>
                <Badge variant="light" color="green">OpenAI</Badge>
                <Badge variant="light" color="violet">{t("chat.compatible")}</Badge>
              </Group>
            </Box>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </Stack>
      </ScrollArea>

      <Group gap="sm">
        <TextInput
          flex={1}
          placeholder={t("chat.input_placeholder")}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          disabled={isLoading}
          size="md"
        />
        <Button onClick={handleSend} loading={isLoading} size="md">
          {t("chat.send")}
        </Button>
      </Group>
    </Stack>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <Paper
      p="sm"
      radius="md"
      bg={isUser ? "blue.9" : "dark.6"}
      ml={isUser ? "auto" : 0}
      mr={isUser ? 0 : "auto"}
      maw="85%"
      style={{ position: "relative" }}
    >
      {/* Tool calls indicator */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Group gap="xs" mb="xs">
          {message.toolCalls.map((tc, i) => (
            <Badge key={i} size="xs" variant="outline" color="yellow">
              🔧 {tc.name}
            </Badge>
          ))}
        </Group>
      )}

      {/* Message content */}
      <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {message.content}
        {message.isStreaming && <span className="cursor-blink">▊</span>}
      </Text>
    </Paper>
  );
}

export default ChatPage;
