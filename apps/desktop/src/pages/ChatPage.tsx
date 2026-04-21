import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, Textarea, Button, Group, Paper, Text,
  ScrollArea, Box, Badge, ActionIcon, Menu, Tooltip,
  Notification, Collapse, useMantineColorScheme,
} from "@mantine/core";
import { sendMessage, loadConfig } from "../lib/agent-bridge";
import type { ChatMessage } from "../lib/agent-bridge";
import {
  startStream, getSnapshot, subscribe, abortStream, pauseStream, resumeStream,
} from "../lib/stream-manager";
import type { StreamEvent } from "../lib/stream-manager";
import {
  setAskUserHandler, onPlanModeChange, isPlanMode, setProgressEmitter,
} from "../lib/tool-registry";
import type { Conversation } from "../lib/conversations";
import { MarkdownContent } from "../components/MarkdownContent";
import EmptyState from "../components/EmptyState";
import WorkerStatusIndicator from "../components/WorkerStatusIndicator";
import ToolProgress from "../components/ToolProgress";
import type { ToolCallEntry, ToolCallStatus } from "../components/ToolProgress";
import CostBadge from "../components/CostBadge";
import { collectDiagnosticsBundle, formatDiagnosticsText } from "../lib/runtime/diagnostics";
import { getAllBackups, computeDiff, formatDiff, getRewindContent, canRewind } from "../lib/file-history";
import type { FileBackup } from "../lib/file-history";
import { getCachedProject } from "../lib/project-context";
import { loadAgentRoster } from "../lib/runtime/agent-roster";
import { setApprovalGate, getApprovalGate } from "../lib/runtime/approvals";
import { listTasks } from "../lib/runtime/task-store";
import { getFileChanges, getChangeSummary, formatFileChanges } from "../lib/file-tracker";
import { buildUsageCostSnapshot } from "../lib/runtime/usage-cost";
import { getState, setState as setAppState, selectActiveTodo } from "../lib/app-state";
import { loadMemory } from "../lib/memory";
import { permissionEngine, PERMISSION_LEVEL_META } from "../lib/permission-engine";
import { getAllTools } from "../lib/tool-registry";
import "../components/markdown.css";

interface ChatPageProps {
  conversation: Conversation | null;
  conversations: Conversation[];
  onConversationsUpdate: (convs: Conversation[]) => void;
  onNewConversation: () => void;
}

function ChatPage({ conversation, conversations, onConversationsUpdate }: ChatPageProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [exportNotice, setExportNotice] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [planModeActive, setPlanModeActive] = useState(() => isPlanMode());
  const [askPending, setAskPending] = useState<{
    question: string;
    options: string[];
    multiSelect: boolean;
    resolve: (answer: string) => void;
  } | null>(null);
  const [askInput, setAskInput] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  // Sync local messages with conversation on switch; recover from stream-manager snapshot.
  // Loads from DB first (centralized persistence), falls back to React state.
  useEffect(() => {
    const convId = conversation?.id;

    if (convId) {
      const snapshot = getSnapshot(convId);
      if (snapshot && snapshot.status === "active") {
        // Stream still running — restore from snapshot and subscribe
        const msgs = conversation?.messages ?? [];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg?.role === "assistant") {
          lastMsg.content = snapshot.accumulatedText;
          lastMsg.isStreaming = true;
        }
        setLocalMessages([...msgs]);
        setIsLoading(true);
        setIsThinking(snapshot.isThinking);
      } else {
        // Load from DB, fallback to conversation prop
        import("../lib/session-store").then(({ loadMessagesForConversation }) => {
          loadMessagesForConversation(convId).then(dbMsgs => {
            if (dbMsgs.length > 0) {
              setLocalMessages(dbMsgs as ChatMessage[]);
            } else {
              setLocalMessages(conversation?.messages ?? []);
            }
          }).catch(() => {
            setLocalMessages(conversation?.messages ?? []);
          });
        });
        setIsLoading(false);
        setIsThinking(false);
      }
    } else {
      setLocalMessages([]);
      setIsLoading(false);
      setIsThinking(false);
    }

    setToolCalls([]);
    setAskPending(null);
    setAskInput("");
    setDroppedFiles([]);
  }, [conversation?.id]);

  const persistMessages = useCallback((msgs: ChatMessage[]) => {
    const convId = conversation?.id;
    if (!convId) return;
    const title = (conversation?.messages?.length === 0 && msgs.length > 0)
      ? (msgs.find(m => m.role === "user")?.content.slice(0, 30) || conversation?.title || t("chat.newChat"))
      : undefined;
    // Save directly to DB (centralized persistence)
    import("../lib/session-store").then(({ saveMessagesForConversation }) => {
      saveMessagesForConversation(convId, msgs, title).catch(() => {});
    });
    // Also update parent state for sidebar display
    const updated = conversations.map(c => {
      if (c.id !== convId) return c;
      const displayTitle = title || c.title;
      const hasNewMessages = msgs.length > c.messages.length;
      return { ...c, title: displayTitle, messages: msgs, updatedAt: hasNewMessages ? Date.now() : c.updatedAt };
    });
    onConversationsUpdate(updated);
  }, [conversation?.id, conversation?.messages?.length, conversation?.title, conversations, onConversationsUpdate]);

    // Subscribe to stream-manager events for current session
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId) return;

    const listener = (event: StreamEvent) => {
      const snap = event.snapshot;

      // Update assistant message from snapshot
      setLocalMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          last.content = snap.accumulatedText;
          last.isStreaming = snap.status === "active";
          // Sync tool calls into message
          last.toolCalls = snap.toolCalls.map(tc => ({
            name: tc.name,
            input: tc.input,
            output: tc.output,
            status: tc.status,
          }));
        }
        return updated;
      });

      setIsThinking(snap.isThinking);

      // Sync tool progress UI
      setToolCalls(snap.toolCalls.map((tc, i) => ({
        id: `tc_${i}`,
        name: tc.name,
        input: tc.input,
        output: tc.output,
        status: tc.status === "running" ? "running" as ToolCallStatus : tc.status === "error" ? "error" as ToolCallStatus : "success" as ToolCallStatus,
        startedAt: Date.now(),
        ...(tc.status !== "running" ? { endedAt: Date.now() } : {}),
      })));

      if (event.type === "completed" || event.type === "error") {
        setIsLoading(false);
        setIsThinking(false);
        // Persist after completion
        setLocalMessages(prev => {
          persistMessages(prev);
          return prev;
        });
      }
    };

    const unsub = subscribe(convId, listener);
    return unsub;
  }, [conversation?.id, persistMessages]);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [localMessages]);

  useEffect(() => {
    if (exportNotice) {
      const timer = setTimeout(() => setExportNotice(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [exportNotice]);

  // Wire plan mode listener
  useEffect(() => {
    return onPlanModeChange(setPlanModeActive);
  }, []);

  // Wire ask_user handler
  useEffect(() => {
    setAskUserHandler((question, options, multiSelect) => {
      return new Promise<string>(resolve => {
        setAskInput("");
        setAskPending({ question, options, multiSelect, resolve });
      });
    });
    return () => { setAskUserHandler(() => Promise.resolve("")); };
  }, []);

  // Wire progress emitter → update running ToolCallEntry
  useEffect(() => {
    setProgressEmitter((toolName, data) => {
      setToolCalls(prev => {
        const updated = prev.map(c => {
          if (c.name === toolName && c.status === "running") {
            return {
              ...c,
              ...(data.percent !== undefined ? { percent: data.percent } : {}),
              ...(data.message !== undefined ? { progressMsg: data.message } : {}),
            };
          }
          return c;
        });
        return updated;
      });
    });
    return () => { setProgressEmitter(() => undefined); };
  }, []);

  // Persist local messages back to conversation
// [moved up]

  // Global keyboard shortcut listeners (dispatched from App.tsx)
  useEffect(() => {
    const onSend = () => { if (!isLoading && input.trim()) handleSend(); };
    const onStop = () => { if (isLoading) handleStop(); };
    window.addEventListener("shortcut-send", onSend);
    window.addEventListener("shortcut-stop", onStop);
    return () => {
      window.removeEventListener("shortcut-send", onSend);
      window.removeEventListener("shortcut-stop", onStop);
    };
  }, [isLoading, input]);

  // Auto-persist messages on change (debounced) to prevent data loss on conversation switch
  useEffect(() => {
    if (!conversation?.id || localMessages.length === 0) return;
    const timer = setTimeout(() => {
      persistMessages(localMessages);
    }, 500);
    return () => clearTimeout(timer);
  }, [localMessages, conversation?.id, persistMessages]);

  // ═══════════ ask_user answer submission ═══════════
  const handleAskAnswer = useCallback((answer: string) => {
    if (!askPending) return;
    askPending.resolve(answer);
    setAskPending(null);
    setAskInput("");
  }, [askPending]);

  // ═══════════ Rewind — delete messages after a user message ═══════════
  const handleRewind = useCallback((messageIndex: number) => {
    setLocalMessages(prev => {
      // Keep messages up to and including the selected user message
      const rewound = prev.slice(0, messageIndex + 1);
      // Persist immediately
      persistMessages(rewound);
      return rewound;
    });
  }, [persistMessages]);

  // ═══════════ File Drop ═══════════
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) setDroppedFiles(prev => [...prev, ...files]);
  }, []);
  const removeFile = useCallback((index: number) => {
    setDroppedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ═══════════ Export ═══════════
  const exportAsMarkdown = useCallback(() => {
    if (!conversation) return;
    const lines = [`# ${conversation.title}\n`];
    for (const msg of localMessages) {
      const role = msg.role === "user" ? "👤 User" : "🤖 Assistant";
      lines.push(`## ${role}\n\n${msg.content}\n`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conversation.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportNotice(`✅ ${t("chat.exportedMarkdown")}`);
  }, [conversation, localMessages]);

  const exportAsJSON = useCallback(() => {
    if (!conversation) return;
    const blob = new Blob([JSON.stringify({ ...conversation, messages: localMessages }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conversation.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportNotice(`✅ ${t("chat.exportedJSON")}`);
  }, [conversation, localMessages]);

  // ═══════════ Import Claude Code JSONL ═══════════
  const importClaudeJsonl = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jsonl,.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const lines = text.trim().split("\n").filter(Boolean);
        const imported: ChatMessage[] = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            // Claude Code JSONL format: { type: "human"|"assistant", message: { content: ... } }
            // or: { role: "user"|"assistant", content: "..." }
            let role: "user" | "assistant" = "user";
            let content = "";
            if (obj.type === "human" || obj.role === "user") {
              role = "user";
              content = obj.message?.content || obj.content || "";
              if (Array.isArray(content)) {
                content = content.map((c: { text?: string; type?: string }) => c.text || "").join("\n");
              }
            } else if (obj.type === "assistant" || obj.role === "assistant") {
              role = "assistant";
              content = obj.message?.content || obj.content || "";
              if (Array.isArray(content)) {
                content = content.map((c: { text?: string; type?: string }) => c.text || "").join("\n");
              }
            } else {
              continue;
            }
            if (!content.trim()) continue;
            imported.push({
              id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              role,
              content,
              timestamp: new Date(obj.timestamp || obj.created_at || Date.now()),
            });
          } catch {
            // Skip malformed lines
          }
        }
        if (imported.length > 0) {
          setLocalMessages(prev => [...prev, ...imported]);
          setExportNotice(`✅ ${t("chat.importedMessages", { count: imported.length })}`);
        } else {
          setExportNotice(`⚠️ ${t("chat.noImportableMessages")}`);
        }
      } catch {
        setExportNotice(`❌ ${t("chat.fileReadFailed")}`);
      }
    };
    input.click();
  }, []);

  // ═══════════ Export as PDF ═══════════
  const exportAsPDF = useCallback(() => {
    if (!conversation) return;
    // Generate a simple PDF using text layout (no external library)
    const title = conversation.title;
    const msgs = localMessages;

    // Build PDF content manually using minimal PDF spec
    const textLines: string[] = [];
    textLines.push(title);
    textLines.push("=".repeat(title.length));
    textLines.push("");
    for (const msg of msgs) {
      const role = msg.role === "user" ? "[User]" : "[Assistant]";
      textLines.push(`${role} ${msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ""}`);
      textLines.push(msg.content);
      textLines.push("");
    }

    // Use a printable text approach — create a hidden iframe, print to PDF
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:20px;font-size:13px;line-height:1.6}
h1{font-size:18px;border-bottom:2px solid #333;padding-bottom:8px}
.msg{margin:12px 0;padding:8px 12px;border-radius:8px}
.user{background:#e8f4fd;border-left:3px solid #3b82f6}
.assistant{background:#f0f0f0;border-left:3px solid #10b981}
.role{font-weight:bold;font-size:11px;color:#666;margin-bottom:4px}
pre{background:#1e1e1e;color:#d4d4d4;padding:8px;border-radius:4px;overflow-x:auto;font-size:12px}
code{font-family:'JetBrains Mono',monospace;font-size:12px}
</style></head><body>
<h1>${title}</h1>
${msgs.map(m => `<div class="msg ${m.role}"><div class="role">${m.role === "user" ? "User" : "Assistant"}</div><div>${m.content.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div></div>`).join("\n")}
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, "_blank");
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
    }
    setExportNotice(`✅ ${t("chat.pdfWindowOpened")}`);
  }, [conversation, localMessages]);

  // ═══════════ Export as Image ═══════════
  const exportAsImage = useCallback(() => {
    if (!conversation || !viewport.current) return;
    // Use canvas to capture the chat area
    const chatArea = viewport.current;
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = chatArea.scrollWidth * scale;
    canvas.height = Math.min(chatArea.scrollHeight * scale, 8000); // Cap height
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw messages as text
    ctx.scale(scale, scale);
    ctx.font = "13px system-ui, sans-serif";
    let y = 30;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px system-ui";
    ctx.fillText(conversation.title, 16, y);
    y += 30;

    for (const msg of localMessages) {
      const isUser = msg.role === "user";
      ctx.fillStyle = isUser ? "#3b82f6" : "#10b981";
      ctx.font = "bold 11px system-ui";
      ctx.fillText(isUser ? "User" : "Assistant", 16, y);
      y += 16;
      ctx.fillStyle = "#e0e0e0";
      ctx.font = "13px system-ui";
      const lines = msg.content.split("\n");
      for (const line of lines) {
        // Word wrap at ~80 chars
        const chunks = line.match(/.{1,80}/g) || [""];
        for (const chunk of chunks) {
          if (y > canvas.height / scale - 20) break;
          ctx.fillText(chunk, 20, y);
          y += 18;
        }
      }
      y += 12;
      if (y > canvas.height / scale - 20) break;
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conversation.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNotice(`✅ ${t("chat.exportedImage")}`);
    }, "image/png");
  }, [conversation, localMessages]);

  // ═══════════ Export as PPTX ═══════════
  const exportAsPptx = useCallback(async () => {
    if (!conversation || localMessages.length === 0) return;
    try {
      const { conversationToPptx } = await import("../lib/html-to-pptx");
      const messages = localMessages.map(m => ({ role: m.role, content: m.content }));
      const blob = await conversationToPptx(messages, {
        title: conversation.title || "Conversation",
        author: "Super Excellent",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conversation.title.replace(/[^a-zA-Z0-9一-鿿]/g, "_")}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNotice(`✅ ${t("chat.exportedPPTX")}`);
    } catch (e) {
      setExportNotice(`❌ PPTX export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [conversation, localMessages, t]);

  // ═══════════ Pause / Resume / Stop ═══════════
  const [isPausedState, setIsPausedState] = useState(false);

  const handlePause = useCallback(() => {
    if (conversation?.id) {
      pauseStream(conversation.id);
      setIsPausedState(true);
    }
  }, [conversation?.id]);

  const handleResume = useCallback(() => {
    if (conversation?.id) {
      resumeStream(conversation.id, sendMessage);
      setIsPausedState(false);
      setIsLoading(true);
    }
  }, [conversation?.id]);

  const handleStop = useCallback(() => {
    if (conversation?.id) {
      abortStream(conversation.id);
    }
    setIsLoading(false);
    setIsPausedState(false);
    setLocalMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.isStreaming) last.isStreaming = false;
      return updated;
    });
  }, [conversation?.id]);

  // ═══════════ Slash Commands ═══════════
  const handleSlashCommand = useCallback(async (cmd: string): Promise<string | null> => {
    const parts = cmd.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Try the new command registry first (clean, pure commands)
    try {
      const { dispatchCommand } = await import("../lib/commands");
      const registryResult = await dispatchCommand(cmd, {
        conversation,
        localMessages,
        setLocalMessages,
        config: loadConfig(),
      });
      if (registryResult !== null) {
        // Registry handled this command — but skip help so ChatPage's fuller help wins
        if (command !== "help" && command !== "?") {
          return registryResult;
        }
      }
    } catch (e) { /* fall through to legacy switch */ }

    switch (command) {
      case "help":
        return `## ${t("chat.helpTitle")}

| ${t("chat.helpCommand")} | ${t("chat.helpDescription")} |
|------|------|
| /help | ${t("chat.helpShowHelp")} |
| /clear | ${t("chat.helpClear")} |
| /compact | ${t("chat.helpCompact")} |
| /cost | ${t("chat.helpCost")} |
| /todo | ${t("chat.helpTodo")} |
| /memory | ${t("chat.helpMemory")} |
| /diff [path] | ${t("chat.helpDiff")} |
| /undo [path] | ${t("chat.helpUndo")} |
| /project [path] | ${t("chat.helpProject")} |
| /config | ${t("chat.helpConfig")} |
| /commit [msg] | ${t("chat.helpCommit")} |
| /doctor | ${t("chat.helpDoctor")} |
| /context | ${t("chat.helpContext")} |
| /brief | ${t("chat.helpBrief")} |
| /agents | ${t("chat.helpAgents")} |
| /history | ${t("chat.helpHistory")} |
| /export [format] | ${t("chat.helpExport")} |
| /import | ${t("chat.helpImport")} |
| /model [id] | ${t("chat.helpModel")} |
| /permission [level] | ${t("chat.helpPermission")} |
| /tasks | ${t("chat.helpTasks")} |
| /files | ${t("chat.helpFiles")} |
| /usage | ${t("chat.helpUsage")} |`;

      case "clear":
        setLocalMessages([]);
        return `🗑️ ${t("chat.conversationCleared")}`;

      case "compact": {
        const msgs = localMessages;
        const userMsgs = msgs.filter(m => m.role === "user").length;
        const assistantMsgs = msgs.filter(m => m.role === "assistant").length;
        if (msgs.length <= 4) return t("chat.tooShortToCompact");
        const keep = msgs.slice(-4);
        setLocalMessages(keep);
        return `📦 ${t("chat.compacted", { count: userMsgs + assistantMsgs - 4 })}`;
      }

      case "cost":
        return `💰 ${t("chat.costHint")}`;

      case "todo":
        return `📋 ${t("chat.todoHint")}`;

      case "memory": {
        const mem = loadMemory();
        setAppState({ memorySnapshot: mem });
        return mem ? `📝 ${t("chat.currentMemory", { content: mem })}` : `📭 ${t("chat.noMemory")}`;
      }

      case "config": {
        const cfg = loadConfig();
        return `## ⚙️ ${t("chat.configTitle")}

| ${t("chat.configItem")} | ${t("chat.configValue")} |
|------|------|
| Provider | ${cfg.provider} |
| Model | ${cfg.model} |
| Base URL | ${cfg.baseURL || `(${t("chat.configDefault")})`} |
| ${t("chat.configWorkDir")} | ${cfg.workDir || `(${t("chat.configNotSet")})`} |
| API Key | ${cfg.apiKey ? `✅ ${t("chat.configApiKeySet")}` : `❌ ${t("chat.configApiKeyNotSet")}`} |`;
      }

      case "commit": {
        const msg = args.join(" ") || "auto commit";
        return `📌 ${t("chat.commitHint", { msg })}`;
      }

      case "doctor": {
        const { installDefaultCheckers, runQualityGate, formatGateResult } = await import("../lib/runtime/quality-gate");
        installDefaultCheckers();
        const [bundle, gate] = await Promise.all([
          Promise.resolve(collectDiagnosticsBundle({ appName: "super-excellent" })),
          runQualityGate(),
        ]);
        return [
          `## 🩺 ${t("chat.diagnosticReport")}`,
          "",
          "```",
          formatDiagnosticsText(bundle).trimEnd(),
          "```",
          "",
          `## ✅ ${t("chat.qualityGate")}`,
          "",
          "```",
          formatGateResult(gate),
          "```",
        ].join("\n");
      }

      case "context": {
        const cfg = loadConfig();
        const appState = getState();
        // Prefer AppState (synced from App.tsx); fall back to module cache
        const project = appState.projectInfo ?? getCachedProject();
        const memContent = appState.memorySnapshot || loadMemory();
        const memLineCount = memContent
          ? memContent.split("\n").filter(l => l.trim()).length
          : 0;
        const activeTodo = selectActiveTodo(appState);
        const tasks = listTasks();
        const permLevel = appState.permissionMode ?? permissionEngine.getLevel();
        const permMeta = PERMISSION_LEVEL_META[permLevel];
        const toolCount = getAllTools().length;

        const lines = [
          `## 📋 ${t("chat.contextTitle")}`,
          "",
          `### ${t("chat.contextProject")}`,
          `- **${t("chat.contextWorkDir")}**: ${cfg.workDir || `(${t("chat.configNotSet")})`}`,
          `- **Provider**: ${cfg.provider}`,
          `- **Model**: ${cfg.model}`,
        ];
        if (project) {
          lines.push(`- **${t("chat.contextProjectName")}**: ${project.name}`);
          lines.push(`- **${t("chat.contextProjectType")}**: ${project.type}`);
          lines.push(`- **${t("chat.contextProjectPath")}**: ${project.rootPath}`);
          if (project.description) lines.push(`- **${t("chat.contextDescription")}**: ${project.description}`);
          if (project.dependencies?.length) {
            lines.push(`- **${t("chat.contextDepsCount")}**: ${project.dependencies.length}`);
          }
        } else {
          lines.push(`- **${t("chat.contextProject")}**: ${t("chat.contextNoProject")}`);
        }

        lines.push("", `### ${t("chat.contextMemory")}`);
        lines.push(`- **${t("chat.contextLongTermMemory")}**: ${t("chat.contextMemoryRecords", { count: memLineCount })}`);
        if (memLineCount === 0) lines.push(`  *(${t("chat.contextMemoryHint")})*`);

        lines.push("", `### ${t("chat.contextPermission")}`);
        lines.push(`- **${t("chat.contextMode")}**: ${permMeta.symbol} ${permMeta.label} (\`${permLevel}\`)`);
        lines.push(`- **${t("chat.contextModeDescription")}**: ${permMeta.description}`);

        lines.push("", `### ${t("chat.contextActiveTasks")}`);
        if (activeTodo) {
          const statusIcon: Record<string, string> = {
            pending: "⬜", running: "🔄", done: "✅", failed: "❌", blocked: "🚫",
          };
          lines.push(`- **${t("chat.contextTask")}**: ${activeTodo.title}`);
          lines.push(`- **${t("chat.contextStatus")}**: ${statusIcon[activeTodo.status] || "❓"} ${activeTodo.status}`);
        } else {
          lines.push(`- *(${t("chat.contextNoActiveTasks")})*`);
        }
        lines.push(`- **${t("chat.contextRuntimeTasks")}**: ${tasks.length}`);

        lines.push("", `### ${t("chat.contextTools")}`);
        lines.push(`- **${t("chat.contextRegisteredTools")}**: ${t("chat.contextToolCount", { count: toolCount })}`);
        lines.push(`- **${t("chat.contextLLMProviders")}**: Anthropic / OpenAI / Google / Kimi / Ollama / DeepSeek / Qwen / MiniMax / Zhipu / Custom`);
        lines.push(`- **${t("chat.contextMCP")}**: ${t("chat.contextMCPReady")}`);

        return lines.join("\n");
      }

      case "brief": {
        const project = getCachedProject();
        if (!project) return `📭 ${t("chat.briefNoProject")}`;
        const lines = [
          `## 📊 ${t("chat.briefTitle", { name: project.name })}`,
          "",
          `- **${t("chat.briefType")}**: ${project.type}`,
          `- **${t("chat.briefPath")}**: ${project.rootPath}`,
        ];
        if (project.description) lines.push(`- **${t("chat.briefDescription")}**: ${project.description}`);
        if (project.dependencies?.length) {
          lines.push(`- **${t("chat.briefDepsCount")}**: ${project.dependencies.length}`);
          lines.push(`- **${t("chat.briefMainDeps")}**: ${project.dependencies.slice(0, 8).join(", ")}`);
        }
        if (project.scripts) {
          const scriptList = Object.keys(project.scripts).slice(0, 8);
          lines.push(`- **${t("chat.briefScripts")}**: ${scriptList.join(", ")}`);
        }
        return lines.join("\n");
      }

      case "agents": {
        const roster = loadAgentRoster();
        const lines = [
          `## 🤖 ${t("chat.agentStatus", { status: roster.status })}`,
          "",
          `${roster.detail}`,
          "",
          `| ${t("chat.agentId")} | ${t("chat.agentName")} |`,
          "|----------|------|",
          ...roster.entries.map(e => `| ${e.agentId} | ${e.displayName} |`),
        ];
        return lines.join("\n");
      }

      case "history": {
        const userMsgs = localMessages.filter(m => m.role === "user");
        const assistantMsgs = localMessages.filter(m => m.role === "assistant");
        const totalChars = localMessages.reduce((s, m) => s + m.content.length, 0);
        const estimatedTokens = Math.ceil(totalChars / 4);
        return `## 📊 ${t("chat.historyTitle")}

| ${t("chat.historyMetric")} | ${t("chat.historyValue")} |
|------|------|
| ${t("chat.historyTotalMessages")} | ${localMessages.length} |
| ${t("chat.historyUserMessages")} | ${userMsgs.length} |
| ${t("chat.historyAssistantMessages")} | ${assistantMsgs.length} |
| ${t("chat.historyTotalChars")} | ${totalChars.toLocaleString()} |
| ${t("chat.historyEstimatedTokens")} | ~${estimatedTokens.toLocaleString()} |`;
      }

      case "export": {
        const format = (args[0] || "md").toLowerCase();
        if (format === "json") { exportAsJSON(); return null; }
        if (format === "pdf") { exportAsPDF(); return null; }
        if (format === "image" || format === "png") { exportAsImage(); return null; }
        exportAsMarkdown();
        return null;
      }

      case "import": {
        importClaudeJsonl();
        return null;
      }

      case "permission": {
        const levelArg = args[0];
        if (!levelArg) {
          const gate = getApprovalGate();
          const permLevel = permissionEngine.getLevel();
          const permMeta = PERMISSION_LEVEL_META[permLevel];
          const rules = permissionEngine.getRules();
          const stats = permissionEngine.getDenialStats();
          const lines = [
            `## 🔐 ${t("chat.permissionStatus")}`,
            "",
            `**${t("chat.permissionEngineLevel")}**: ${permMeta.symbol} ${permMeta.label} (\`${permLevel}\`)`,
            `**${t("chat.permissionDescription")}**: ${permMeta.description}`,
            "",
            `**${t("chat.permissionGateStatus")}**:`,
            `- ${t("chat.permissionReadonly")}: ${gate.readonlyMode ? "✅" : "❌"}`,
            `- ${t("chat.permissionActionsEnabled")}: ${gate.actionsEnabled ? "✅" : "❌"}`,
            `- ${t("chat.permissionDryRun")}: ${gate.dryRun ? "✅" : "❌"}`,
          ];
          if (rules.length > 0) {
            lines.push("", `**${t("chat.permissionCustomRules", { count: rules.length })}**:`);
            for (const r of rules) {
              lines.push(`- \`${r.action}\` ${r.tool}${r.path ? ` @ ${r.path}` : ""}`);
            }
          }
          if (stats.length > 0) {
            lines.push("", `**${t("chat.permissionDenialStats", { count: Math.min(5, stats.length) })}**:`);
            for (const s of stats.slice(0, 5)) {
              lines.push(`- \`${s.tool}\`: ${s.count}× — ${s.topReasons.join(", ")}`);
            }
          }
          lines.push("", `${t("chat.permissionAvailableLevels")}: \`default\` \`acceptEdits\` \`dontAsk\` \`bypassPermissions\` \`plan\``);
          lines.push(`${t("chat.permissionGateShortcuts")}: \`/permission full\` · \`/permission readonly\` · \`/permission dryrun\``);
          return lines.join("\n");
        }
        switch (levelArg.toLowerCase()) {
          case "full":
            setApprovalGate({ readonlyMode: false, actionsEnabled: true, dryRun: false });
            permissionEngine.setLevel("dontAsk");
            setAppState({ permissionMode: "dontAsk" });
            return `🔓 ${t("chat.permissionSetFull")}`;
          case "readonly":
            setApprovalGate({ readonlyMode: true, actionsEnabled: false, dryRun: false });
            permissionEngine.setLevel("plan");
            setAppState({ permissionMode: "plan" });
            return `🔒 ${t("chat.permissionSetReadonly")}`;
          case "dryrun":
            setApprovalGate({ readonlyMode: false, actionsEnabled: true, dryRun: true });
            permissionEngine.setLevel("default");
            setAppState({ permissionMode: "default" });
            return `🧪 ${t("chat.permissionSetDryRun")}`;
          default:
            return `❌ ${t("chat.permissionUnknownLevel", { level: levelArg })}`;
        }
      }

      case "model": {
        const cfg = loadConfig();
        const modelArg = args[0];
        if (!modelArg) {
          return `## 🧠 ${t("chat.currentModel")}

| ${t("chat.configItem")} | ${t("chat.configValue")} |
|------|------|
| Provider | ${cfg.provider} |
| Model | ${cfg.model} |

${t("chat.modelUseHint")}`;
        }
        const { saveConfig: sc } = await import("../lib/agent-bridge");
        sc({ ...cfg, model: modelArg });
        return `✅ ${t("chat.modelSwitched", { model: modelArg, provider: cfg.provider })}`;
      }

      case "tasks": {
        const tasks = listTasks();
        if (tasks.length === 0) return `📭 ${t("chat.noTasks")}`;
        const statusIcon: Record<string, string> = { todo: "⬜", in_progress: "🔄", blocked: "🚫", done: "✅" };
        const lines = [
          `## 📋 ${t("chat.taskListTitle", { count: tasks.length })}`,
          "",
          `| ${t("chat.taskStatus")} | ${t("chat.taskName")} | ${t("chat.taskOwner")} |`,
          "|------|------|--------|",
          ...tasks.map(tk => `| ${statusIcon[tk.status] || "❓"} | ${tk.title} | ${tk.owner} |`),
        ];
        return lines.join("\n");
      }

      case "files": {
        const changes = getFileChanges();
        if (changes.length === 0) return `📭 ${t("chat.noFileChangesSession")}`;
        return `## 📁 ${t("chat.fileChangesTitle", { count: changes.length })}\n\n${getChangeSummary()}\n\n${formatFileChanges()}`;
      }

      case "usage": {
        const snapshot = buildUsageCostSnapshot();
        const lines = [
          `## 📈 ${t("chat.usageTitle")}`,
          "",
          `### ${t("chat.usagePeriodSummary")}`,
          `| ${t("chat.usagePeriod")} | ${t("chat.usageRequests")} | ${t("chat.usageTokens")} | ${t("chat.usageCost")} |`,
          "|------|--------|-------|------|",
          ...snapshot.periods.map(p =>
            `| ${p.label} | ${p.requestCount} | ${p.tokens.toLocaleString()} | $${p.estimatedCost.toFixed(4)} |`
          ),
          "",
          `### ${t("chat.usageByModel")}`,
          `| ${t("chat.usageModel")} | ${t("chat.usageTokens")} | ${t("chat.usageCost")} |`,
          "|------|-------|------|",
          ...snapshot.breakdown.byModel.map(r =>
            `| ${r.label} | ${r.tokens.toLocaleString()} | $${r.estimatedCost.toFixed(4)} |`
          ),
          "",
          `**${t("chat.usageBudget")}**: ${snapshot.budget.message}`,
        ];
        return lines.join("\n");
      }

      case "diff": {
        const path = args[0];
        if (!path) {
          const all = getAllBackups();
          if (all.length === 0) return `📭 ${t("chat.diffNoRecords")}`;
          const files = [...new Set(all.map(b => b.path))];
          return `## 📜 ${t("chat.diffHistoryTitle", { count: all.length })}\n\n${files.map(f => {
            const bkps = all.filter(b => b.path === f);
            return `- \`${f}\` — ${t("chat.diffModifications", { count: bkps.length })}`;
          }).join("\n")}\n\n${t("chat.diffUseCommand")}`;
        }
        const backups = getAllBackups().filter(b => b.path === path);
        if (backups.length === 0) return `📭 ${t("chat.diffNoFileRecords", { path })}`;
        const last = backups[backups.length - 1];
        const diffLines = formatDiff(computeDiff(last.originalContent, last.newContent));
        return `## 📄 ${t("chat.diffTitle", { path })}\n\n${t("chat.diffLastModified", { time: new Date(last.timestamp).toLocaleString() })}\n\n\`\`\`diff\n${diffLines || `(${t("chat.diffNoChange")})`}\n\`\`\``;
      }

      case "undo": {
        const path = args[0];
        if (!path) return t("chat.undoUsage");
        if (!canRewind(path)) return `📭 ${t("chat.undoNoBackup", { path })}`;
        const original = getRewindContent(path);
        return `## ↩️ ${t("chat.undoTitle", { path })}\n\n${t("chat.undoOriginalContent")}\n\n\`\`\`\n${(original || "").slice(0, 1000)}${(original || "").length > 1000 ? `\n${t("chat.undoContentTruncated")}` : ""}\n\`\`\`\n\n${t("chat.undoExecuteHint")}`;
      }

      default:
        return `❓ ${t("chat.unknownCommand", { command })}`;
    }
  }, [localMessages, setLocalMessages, exportAsMarkdown, exportAsJSON]);

  // ═══════════ Send ═══════════
  const handleSend = useCallback(async () => {
    console.log("[handleSend] called, input=", JSON.stringify(input), "isLoading=", isLoading, "conv=", !!conversation, "convId=", conversation?.id);

    if (!input.trim() || isLoading || !conversation) {
      console.log("[handleSend] BAIL: empty input, loading, or no conversation");
      return;
    }

    // Slash commands
    const trimmed = input.trim();
    if (trimmed.startsWith("/")) {
      const slashResult = await handleSlashCommand(trimmed);
      if (slashResult) {
        setInput("");
        const sysMsg: ChatMessage = {
          id: `sys_${Date.now()}`,
          role: "assistant",
          content: slashResult,
          timestamp: new Date(),
        };
        setLocalMessages(prev => [...prev, sysMsg]);
        return;
      }
    }

    console.log("[handleSend] PROCEEDING with send");
    let content = input.trim();

    // Commands
    if (content.startsWith("/remember ")) {
      const memo = content.slice(10).trim();
      if (memo) {
        const { saveUserMemory } = await import("../lib/agent-bridge");
        saveUserMemory(memo);
        setLocalMessages(prev => [...prev, {
          id: `msg_${Date.now()}_sys`, role: "assistant" as const,
          content: `✅ ${t("chat.remembered", { memo })}`, timestamp: new Date(),
        }]);
        setInput("");
      }
      return;
    }
    if (content === "/memory") {
      const { getUserMemoryText } = await import("../lib/agent-bridge");
      const mem = getUserMemoryText();
      setLocalMessages(prev => [...prev, {
        id: `msg_${Date.now()}_sys`, role: "assistant" as const,
        content: mem ? `📝 ${t("chat.userPreferences", { content: mem })}` : t("chat.noPreferences"),
        timestamp: new Date(),
      }]);
      setInput("");
      return;
    }

    // Secretary routing: /model command to switch model mid-conversation
    if (content.startsWith("/model ")) {
      const modelName = content.slice(7).trim();
      const config = loadConfig();
      const modelMap: Record<string, { provider: string; model: string; baseURL?: string }> = {
        "kimi": { provider: "kimi", model: "moonshot-v1-8k", baseURL: "https://api.moonshot.cn/v1" },
        "claude": { provider: "anthropic", model: "claude-sonnet-4-6" },
        "gpt": { provider: "openai", model: "gpt-5.4" },
        "gemini": { provider: "google", model: "gemini-3.1-flash" },
        "ollama": { provider: "ollama", model: "llama3.1", baseURL: "http://localhost:11434/v1" },
        "deepseek": { provider: "deepseek", model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
        "qwen": { provider: "qwen", model: "qwen-plus", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
        "minimax": { provider: "minimax", model: "abab7-chat", baseURL: "https://api.minimax.chat/v1" },
        "zhipu": { provider: "zhipu", model: "glm-4", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
      };
      const target = modelMap[modelName.toLowerCase()];
      if (target) {
        const { saveConfig } = await import("../lib/agent-bridge");
        saveConfig({ ...config, ...target } as import("../lib/agent-bridge").AgentConfig);
        setLocalMessages(prev => [...prev, {
          id: `msg_${Date.now()}_sys`,
          role: "assistant" as const,
          content: `✅ ${t("chat.switchedToModel", { model: modelName, modelId: target.model })}`,
          timestamp: new Date(),
        }]);
        setInput("");
        persistMessages([...localMessages, {
          id: `msg_${Date.now()}_sys`, role: "assistant" as const,
          content: `✅ ${t("chat.switchedToModelShort", { model: modelName })}`, timestamp: new Date(),
        }]);
      } else {
        setLocalMessages(prev => [...prev, {
          id: `msg_${Date.now()}_sys`, role: "assistant" as const,
          content: `❌ ${t("chat.unknownModel", { model: modelName })}`,
          timestamp: new Date(),
        }]);
        setInput("");
      }
      return;
    }
    if (droppedFiles.length > 0) {
      const fileInfo = droppedFiles.map(f => `📎 ${f.name} (${(f.size / 1024).toFixed(1)}KB)`).join("\n");
      content = `${content}\n\n${fileInfo}`;
      for (const file of droppedFiles) {
        if (file.type.startsWith("text/") || /\.(md|json|ts|js|py|rs|go|c|cpp|h|java|rb|sh|yaml|yml|toml)$/.test(file.name)) {
          try {
            const text = await file.text();
            content += `\n\n--- ${file.name} ---\n\`\`\`\n${text.slice(0, 10000)}\n\`\`\``;
          } catch { /* skip */ }
        }
      }
      setDroppedFiles([]);
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_a`,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    // Update local state immediately
    const newMsgs = [...localMessages, userMsg, assistantMsg];
    console.log("[handleSend] setting", newMsgs.length, "messages, calling API...");
    setLocalMessages(newMsgs);
    setInput("");
    setIsLoading(true);

    const config = loadConfig();
    console.log("[handleSend] config:", JSON.stringify({ provider: config.provider, model: config.model, hasKey: !!config.apiKey }));

    setToolCalls([]);
    setIsThinking(true);

    // Build history from previous messages (not including current user msg)
    const chatHistory = localMessages
      .filter(m => m.role === "user" || m.role === "assistant")
      .filter(m => m.content && !m.isStreaming)
      .map(m => ({ role: m.role, content: m.content }));

    // Delegate to stream-manager — events flow through subscription above
    startStream(
      { sessionId: conversation.id, message: userMsg.content, config, history: chatHistory },
      sendMessage,
    );
  }, [input, isLoading, conversation, localMessages, droppedFiles, persistMessages]);

  // Render chat UI
  return (
    <Stack
      h="calc(100vh - 100px)"
      justify="space-between"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: "relative" }}
    >
      {dragOver && (
        <Box style={{
          position: "absolute", inset: 0, zIndex: 100,
          background: "rgba(59, 130, 246, 0.15)",
          border: "2px dashed #3b82f6", borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <Text size="xl" fw={700} c="blue">📎 {t("chat.dropFilesHere")}</Text>
        </Box>
      )}

      {exportNotice && (
        <Notification color="green" withCloseButton={false} style={{ position: "absolute", top: 8, right: 8, zIndex: 50 }}>
          {exportNotice}
        </Notification>
      )}

      <Group justify="space-between" gap="xs" px="sm" pt={4}>
        <Group gap="xs">
          <CostBadge conversationId={conversation?.id ?? null} compact />
          {planModeActive && (
            <Badge color="violet" variant="light" size="sm" leftSection="📐">
              {t("chat.planMode")}
            </Badge>
          )}
        </Group>
        <Group gap={4}>
          <Tooltip label={showHistory ? t("chat.hideFileHistory") : t("chat.fileChangeHistory")} position="bottom">
            <ActionIcon
              variant={showHistory ? "filled" : "subtle"}
              size="sm"
              onClick={() => setShowHistory(h => !h)}
            >
              <Text size="xs">📜</Text>
            </ActionIcon>
          </Tooltip>
          <Menu>
            <Menu.Target>
              <ActionIcon variant="subtle" size="sm"><Text size="xs">📤</Text></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t("chat.exportLabel")}</Menu.Label>
              <Menu.Item onClick={exportAsMarkdown}>📝 {t("chat.exportMarkdown")}</Menu.Item>
              <Menu.Item onClick={exportAsJSON}>📋 {t("chat.exportJSON")}</Menu.Item>
              <Menu.Item onClick={exportAsPDF}>📄 {t("chat.exportPDF")}</Menu.Item>
              <Menu.Item onClick={exportAsImage}>🖼️ {t("chat.exportImage")}</Menu.Item>
              <Menu.Item onClick={exportAsPptx}>📊 {t("chat.exportPPTX")}</Menu.Item>
              <Menu.Divider />
              <Menu.Label>{t("chat.importLabel")}</Menu.Label>
              <Menu.Item onClick={importClaudeJsonl}>📥 {t("chat.importClaudeJSONL")}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {showHistory && <FileHistoryPanel />}

      <ScrollArea flex={1} viewportRef={viewport}>
        <Stack gap="sm" p="sm">
          {localMessages.length === 0 && (
            <EmptyState onSuggestion={(text) => setInput(text)} />
          )}
          {localMessages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onRetry={(content) => { setInput(content); }}
              onRewind={msg.role === "user" && !isLoading ? () => handleRewind(idx) : undefined}
            />
          ))}

          {/* Live worker status indicator */}
          {isLoading && <WorkerStatusIndicator />}

          {/* Thinking indicator with pulse animation */}
          {isThinking && isLoading && (
            <Paper p="sm" radius="md" bg="transparent">
              <Group gap="xs">
                <Box style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                  animation: "thinking-pulse 1.5s ease-in-out infinite",
                }} />
                <Text size="sm" c="dimmed" fw={500}>{t("chat.thinkingEllipsis")}</Text>
                <Box style={{ display: "flex", gap: 3 }}>
                  {[0, 1, 2].map(i => (
                    <Box key={i} style={{
                      width: 4, height: 4, borderRadius: "50%",
                      background: "var(--mantine-color-blue-5)",
                      animation: `thinking-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
                    }} />
                  ))}
                </Box>
              </Group>
            </Paper>
          )}

          {/* Tool execution progress */}
          {toolCalls.length > 0 && (
            <Box px="xs">
              <ToolProgress calls={toolCalls} />
            </Box>
          )}
        </Stack>
      </ScrollArea>

      {droppedFiles.length > 0 && (
        <Group gap="xs" px="sm">
          {droppedFiles.map((file, i) => (
            <Badge key={i} variant="outline" color="blue"
              rightSection={<Text size="xs" style={{ cursor: "pointer" }} onClick={() => removeFile(i)}>✕</Text>}>
              📎 {file.name}
            </Badge>
          ))}
        </Group>
      )}

      {/* ask_user question card — rendered above input when agent asks a question */}
      {askPending && (
        <Paper p="md" withBorder radius="md" mx="sm" style={{ borderColor: "var(--mantine-color-violet-5)" }}>
          <Text size="sm" fw={600} mb="xs">❓ {askPending.question}</Text>
          {askPending.options.length > 0 ? (
            <Group gap="xs" wrap="wrap">
              {askPending.options.map((opt, i) => (
                <Button key={i} size="xs" variant="light" color="violet"
                  onClick={() => handleAskAnswer(opt)}>
                  {opt}
                </Button>
              ))}
            </Group>
          ) : (
            <Group gap="xs">
              <Textarea
                flex={1}
                size="xs"
                minRows={1}
                maxRows={3}
                autosize
                placeholder={t("chat.inputAnswer")}
                value={askInput}
                onChange={(e) => setAskInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAskAnswer(askInput);
                  }
                }}
              />
              <Button size="xs" color="violet" onClick={() => handleAskAnswer(askInput)}
                disabled={!askInput.trim()}>
                {t("chat.answer")}
              </Button>
            </Group>
          )}
        </Paper>
      )}

      <Group gap="sm">
        <Textarea
          flex={1}
          placeholder={t("chat.input_placeholder")}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isLoading || !!askPending}
          size="md"
          minRows={1}
          maxRows={6}
          autosize
        />
        {isLoading && !isPausedState ? (
          <Group gap={4}>
            <Button onClick={handlePause} color="yellow" variant="filled" size="md">
              ⏸ {t("chat.pauseBtn")}
            </Button>
            <Button onClick={handleStop} color="red" variant="filled" size="md">
              ⏹ {t("chat.stopBtn")}
            </Button>
          </Group>
        ) : isPausedState ? (
          <Group gap={4}>
            <Button onClick={handleResume} color="green" variant="filled" size="md">
              ▶ {t("chat.resumeBtn")}
            </Button>
            <Button onClick={handleStop} color="red" variant="filled" size="md">
              ⏹ {t("chat.stopBtn")}
            </Button>
          </Group>
        ) : (
          <Button onClick={handleSend} size="md">
            {t("chat.send")}
          </Button>
        )}
      </Group>
    </Stack>
  );
}

function MessageBubble({ message, onRetry, onRewind }: { message: ChatMessage; onRetry?: (content: string) => void; onRewind?: () => void }) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Separate thinking content (emoji-prefixed lines) from main model output
  const thinkingMatch = message.content.match(/^([\s\S]*?)((?:\n?(?:🔄|📦|✅|❌|💭|💰)[\s\S]*?)*)$/);
  const mainContent = thinkingMatch?.[1]?.trim() || message.content;
  const thinkingContent = thinkingMatch?.[2]?.trim() || "";
  const thinkingLines = thinkingContent ? thinkingContent.split("\n").filter(Boolean) : [];

  const handleCopy = () => {
    navigator.clipboard.writeText(mainContent || message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Count tool call statuses for summary
  const toolCalls = message.toolCalls || [];
  const runningCount = toolCalls.filter(tc => tc.status === "running").length;
  const successCount = toolCalls.filter(tc => tc.status === "success").length;
  const errorCount = toolCalls.filter(tc => tc.status === "error").length;

  return (
    <Paper
      p="sm" radius="md"
      bg={isUser
        ? (isDark ? "blue.9" : "blue.1")
        : (isDark ? "dark.6" : "gray.1")
      }
      ml={isUser ? "auto" : 0}
      mr={isUser ? 0 : "auto"}
      maw="85%"
      style={{ position: "relative", overflowWrap: "break-word", wordBreak: "break-word", overflow: "hidden" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Streaming indicator — animated pulse when waiting for first token */}
      {message.isStreaming && !mainContent && toolCalls.length === 0 && (
        <Group gap="xs" py="xs">
          <Box style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: "pulse 1.5s infinite" }} />
          <Text size="xs" c="dimmed">{t("chat.thinkingStatus")}</Text>
        </Group>
      )}

      {isUser ? (
        <Text size="sm" c={isDark ? "white" : "dark"} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</Text>
      ) : (
        <Stack gap="xs">
          {/* Thinking section — collapsible, separate from main text */}
          {thinkingLines.length > 0 && (
            <Paper
              p="xs" radius="sm" withBorder
              style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-3)" }}
              bg={isDark ? "dark.7" : "gray.0"}
            >
              <Group
                gap="xs" style={{ cursor: "pointer" }}
                onClick={() => setShowThinking(!showThinking)}
              >
                <Badge size="xs" variant="light" color="violet">Reasoning</Badge>
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                  {t("chat.steps", { count: thinkingLines.length })}
                </Text>
                <Text size="xs" c="dimmed">{showThinking ? "▼" : "▶"}</Text>
              </Group>
              <Collapse in={showThinking}>
                <Box mt={4} p="xs" style={{ borderRadius: 4, maxHeight: 300, overflow: "auto" }}
                  bg={isDark ? "dark.8" : "white"}>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", lineHeight: 1.6, opacity: 0.85 }}>
                    {thinkingContent}
                  </Text>
                </Box>
              </Collapse>
            </Paper>
          )}

          {/* Tool calls section — each tool as an independent collapsible card */}
          {toolCalls.length > 0 && (
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="xs" fw={600} c="dimmed">{t("chat.toolCalls")}</Text>
                {runningCount > 0 && <Badge size="xs" variant="dot" color="blue">{runningCount} {t("chat.running")}</Badge>}
                {successCount > 0 && <Badge size="xs" variant="dot" color="green">{successCount} {t("chat.completed")}</Badge>}
                {errorCount > 0 && <Badge size="xs" variant="dot" color="red">{errorCount} {t("chat.failed")}</Badge>}
              </Group>
              {toolCalls.map((tc, i) => (
                <ToolCallCard key={i} name={tc.name} input={tc.input || ""} output={tc.output} status={tc.status} />
              ))}
            </Stack>
          )}

          {/* Main content — Markdown rendered */}
          {mainContent && <MarkdownContent content={mainContent} />}
          {message.isStreaming && mainContent && <span className="cursor-blink">▊</span>}
        </Stack>
      )}

      {/* Action buttons on hover */}
      {hovered && !message.isStreaming && (
        <Group gap={4} style={{ position: "absolute", top: 4, right: 4 }}>
          <Tooltip label={copied ? t("chat.copied") : t("chat.copy")} position="top">
            <ActionIcon size="xs" variant="subtle" onClick={handleCopy}>
              <Text size="xs">{copied ? "✓" : "📋"}</Text>
            </ActionIcon>
          </Tooltip>
          {isUser && onRetry && (
            <Tooltip label={t("chat.resend")} position="top">
              <ActionIcon size="xs" variant="subtle" onClick={() => onRetry(message.content)}>
                <Text size="xs">🔄</Text>
              </ActionIcon>
            </Tooltip>
          )}
          {isUser && onRewind && (
            <Tooltip label={t("chat.rewindToHere")} position="top">
              <ActionIcon size="xs" variant="subtle" onClick={onRewind}>
                <Text size="xs">⏪</Text>
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      )}
    </Paper>
  );
}

/** File History Panel — shows all file backups recorded this session */
function FileHistoryPanel() {
  const { t } = useTranslation();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const backups = getAllBackups();

  const byPath = new Map<string, FileBackup[]>();
  for (const b of backups) {
    if (!byPath.has(b.path)) byPath.set(b.path, []);
    byPath.get(b.path)!.push(b);
  }

  return (
    <Paper p="sm" radius="md" withBorder mx="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">📜 {t("chat.fileHistoryTitle", { count: backups.length })}</Text>
        {backups.length === 0 && (
          <Text size="xs" c="dimmed">{t("chat.noFileChanges")}</Text>
        )}
      </Group>
      {[...byPath.entries()].map(([path, bkps]) => {
        const last = bkps[bkps.length - 1];
        const diffText = formatDiff(computeDiff(last.originalContent, last.newContent));
        const isOpen = selectedPath === path;
        return (
          <Box key={path} mb={4}>
            <Group
              gap="xs"
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedPath(isOpen ? null : path)}
            >
              <Badge size="xs" variant="light" color="blue">{bkps.length}×</Badge>
              <Text size="xs" ff="monospace" style={{ flex: 1 }} truncate>{path}</Text>
              <Text size="xs" c="dimmed">{new Date(last.timestamp).toLocaleTimeString()}</Text>
              <Text size="xs" c="dimmed">{isOpen ? "▼" : "▶"}</Text>
            </Group>
            {isOpen && (
              <Box
                mt={4} p="xs" style={{ borderRadius: 4, maxHeight: 200, overflow: "auto" }}
                bg={isDark ? "dark.8" : "gray.0"}
              >
                {diffText ? diffText.split("\n").map((line, i) => (
                  <Text
                    key={i} size="xs" ff="monospace"
                    c={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : "dimmed"}
                  >
                    {line || " "}
                  </Text>
                )) : (
                  <Text size="xs" c="dimmed">({t("chat.contentUnchanged")})</Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Paper>
  );
}

/** Status config for tool call cards — inspired by CodePilot tool.tsx status mapping */
const TOOL_STATUS_CONFIG: Record<string, { color: string; label: string; borderColor: string }> = {
  running: { color: "blue", label: "Running", borderColor: "blue" },
  success: { color: "green", label: "Completed", borderColor: "green" },
  error: { color: "red", label: "Error", borderColor: "red" },
};

/** Tool icon lookup — maps tool names to category icons */
function getToolIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("execute") || n.includes("shell")) return ">";
  if (n.includes("write") || n.includes("edit") || n.includes("file_write")) return "W";
  if (n.includes("read") || n.includes("file_read")) return "R";
  if (n.includes("search") || n.includes("glob") || n.includes("grep") || n.includes("find")) return "?";
  return "T";
}

/** Inline tool call card within message bubbles — CodePilot-inspired Collapsible with status Badge */
function ToolCallCard({ name, input, output, status }: {
  name: string;
  input: string;
  output?: string;
  status?: "running" | "success" | "error";
}) {
  const [expanded, setExpanded] = useState(false);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const st = status || "success";
  const cfg = TOOL_STATUS_CONFIG[st] || TOOL_STATUS_CONFIG.success;
  const toolIcon = getToolIcon(name);

  let paramPreview = "";
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null) {
      paramPreview = Object.entries(parsed)
        .slice(0, 2)
        .map(([k, v]) => {
          const val = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}=${val.length > 30 ? val.slice(0, 27) + "..." : val}`;
        })
        .join(", ");
    }
  } catch {
    paramPreview = input.length > 50 ? input.slice(0, 47) + "..." : input;
  }

  return (
    <Paper
      p="xs" radius="sm" withBorder
      style={{
        borderColor: `var(--mantine-color-${cfg.borderColor}-${isDark ? "8" : "3"})`,
        borderLeftWidth: 3,
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      bg={isDark ? "dark.7" : "gray.0"}
      onClick={() => setExpanded(e => !e)}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Badge size="xs" variant="filled" color={isDark ? "dark.5" : "gray.3"} c={isDark ? "gray.3" : "dark.6"}
            style={{ fontFamily: "monospace", minWidth: 20, textAlign: "center" }}>
            {toolIcon}
          </Badge>
          <Text size="xs" fw={600} truncate>{name}</Text>
          {paramPreview && (
            <Text size="xs" c="dimmed" truncate style={{ maxWidth: 200 }}>{paramPreview}</Text>
          )}
        </Group>
        <Group gap={6} wrap="nowrap">
          <Badge
            size="xs"
            variant={st === "running" ? "dot" : "light"}
            color={cfg.color}
          >
            {cfg.label}
          </Badge>
          <Text size="xs" c="dimmed">{expanded ? "▼" : "▶"}</Text>
        </Group>
      </Group>

      {/* Running progress indicator */}
      {st === "running" && (
        <Box mt={4} style={{ height: 2, borderRadius: 1, overflow: "hidden", background: isDark ? "var(--mantine-color-dark-5)" : "var(--mantine-color-gray-3)" }}>
          <Box style={{
            height: "100%", width: "40%", borderRadius: 1,
            background: "var(--mantine-color-blue-5)",
            animation: "tool-progress 1.5s ease-in-out infinite",
          }} />
        </Box>
      )}

      <Collapse in={expanded}>
        <Box mt="xs" p="xs" style={{ borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", overflowX: "auto", maxHeight: 300, overflow: "auto" }}
          bg={isDark ? "dark.8" : "gray.1"}>
          {input && (
            <>
              <Text size="xs" fw={600} mb={2} c="dimmed">Parameters</Text>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {(() => { try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; } })()}
              </Text>
            </>
          )}
          {output && (
            <>
              <Text size="xs" fw={600} mt="xs" mb={2} c={st === "error" ? "red" : "dimmed"}>
                {st === "error" ? "Error" : "Result"}
              </Text>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                c={st === "error" ? "red.4" : undefined}>
                {output.length > 800 ? output.slice(0, 800) + "\n... (truncated)" : output}
              </Text>
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

export default ChatPage;
