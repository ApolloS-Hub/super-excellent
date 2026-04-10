import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Stack, Textarea, Button, Group, Paper, Text,
  ScrollArea, Box, Badge, ActionIcon, Menu, Tooltip,
  Notification, useMantineColorScheme,
} from "@mantine/core";
import { sendMessage, loadConfig } from "../lib/agent-bridge";
import type { ChatMessage } from "../lib/agent-bridge";
import {
  startStream, getSnapshot, subscribe, abortStream,
} from "../lib/stream-manager";
import type { StreamEvent } from "../lib/stream-manager";
import {
  setAskUserHandler, onPlanModeChange, isPlanMode, setProgressEmitter,
} from "../lib/tool-registry";
import type { Conversation } from "../lib/conversations";
import { MarkdownContent } from "../components/MarkdownContent";
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
  // Sync local messages with conversation on switch; recover from stream-manager snapshot
  useEffect(() => {
    const convId = conversation?.id;

    // Recover state from stream-manager if there's an active/completed stream
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
        setLocalMessages(conversation?.messages ?? []);
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
  const persistMessages = useCallback((msgs: ChatMessage[]) => {
    const convId = conversation?.id;
    if (!convId) return;
    const updated = conversations.map(c => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 && msgs.length > 0
        ? (msgs.find(m => m.role === "user")?.content.slice(0, 30) || c.title)
        : c.title;
      // Only update timestamp when there are new messages (not on auto-persist)
      const hasNewMessages = msgs.length > c.messages.length;
      return { ...c, title, messages: msgs, updatedAt: hasNewMessages ? Date.now() : c.updatedAt };
    });
    onConversationsUpdate(updated);
  }, [conversation?.id, conversations, onConversationsUpdate]);

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
    setExportNotice("✅ 已导出为 Markdown");
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
    setExportNotice("✅ 已导出为 JSON");
  }, [conversation, localMessages]);

  // ═══════════ Stop ═══════════
  const handleStop = useCallback(() => {
    if (conversation?.id) {
      abortStream(conversation.id);
    }
    setIsLoading(false);
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

    switch (command) {
      case "help":
        return `## 可用命令

| 命令 | 说明 |
|------|------|
| /help | 显示此帮助 |
| /clear | 清空当前对话 |
| /compact | 压缩对话历史 |
| /cost | 查看费用统计 |
| /todo | 查看任务清单 |
| /memory | 查看/编辑记忆 |
| /diff [path] | 查看文件修改 |
| /undo [path] | 撤销文件修改 |
| /project [path] | 分析项目 |
| /config | 显示当前配置 |
| /commit [msg] | Git 提交当前变更 |
| /doctor | 运行诊断检查 |
| /context | 显示当前上下文 |
| /brief | 项目摘要 |
| /agents | 显示 Worker 状态 |
| /history | 对话历史统计 |
| /export [format] | 导出对话 (md/json) |
| /model [id] | 查看或切换模型 |
| /permission [level] | 设置权限级别 |
| /tasks | 显示任务列表 |
| /files | 显示文件变更 |
| /usage | 详细使用量统计 |`;

      case "clear":
        setLocalMessages([]);
        return "🗑️ 对话已清空";

      case "compact": {
        const msgs = localMessages;
        const userMsgs = msgs.filter(m => m.role === "user").length;
        const assistantMsgs = msgs.filter(m => m.role === "assistant").length;
        if (msgs.length <= 4) return "对话太短，无需压缩";
        const keep = msgs.slice(-4);
        setLocalMessages(keep);
        return `📦 已压缩: 保留最近 4 条消息（删除了 ${userMsgs + assistantMsgs - 4} 条）`;
      }

      case "cost":
        return "💰 费用统计请查看 Monitor 页面（侧边栏 🤖 按钮）";

      case "todo":
        return "📋 使用 AI 的 todo_write 工具管理任务清单。\n\n试试说：\"帮我创建一个 TODO 清单\"";

      case "memory": {
        const mem = loadMemory();
        setAppState({ memorySnapshot: mem });
        return mem ? `📝 当前记忆:\n\n${mem}` : "📭 暂无记忆。AI 会自动学习你的偏好。";
      }

      case "config": {
        const cfg = loadConfig();
        return `## ⚙️ 当前配置

| 项目 | 值 |
|------|------|
| Provider | ${cfg.provider} |
| Model | ${cfg.model} |
| Base URL | ${cfg.baseURL || "(默认)"} |
| 工作目录 | ${cfg.workDir || "(未设置)"} |
| API Key | ${cfg.apiKey ? "✅ 已配置" : "❌ 未配置"} |`;
      }

      case "commit": {
        const msg = args.join(" ") || "auto commit";
        return `📌 请通过 AI 执行 Git 提交。\n\n试试说：\"帮我 git commit，消息为: ${msg}\"`;
      }

      case "doctor": {
        const { installDefaultCheckers, runQualityGate, formatGateResult } = await import("../lib/runtime/quality-gate");
        installDefaultCheckers();
        const [bundle, gate] = await Promise.all([
          Promise.resolve(collectDiagnosticsBundle({ appName: "super-excellent" })),
          runQualityGate(),
        ]);
        return [
          "## 🩺 诊断报告",
          "",
          "```",
          formatDiagnosticsText(bundle).trimEnd(),
          "```",
          "",
          "## ✅ 质量门禁",
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
          "## 📋 当前上下文",
          "",
          "### 项目",
          `- **工作目录**: ${cfg.workDir || "(未设置)"}`,
          `- **Provider**: ${cfg.provider}`,
          `- **Model**: ${cfg.model}`,
        ];
        if (project) {
          lines.push(`- **项目名称**: ${project.name}`);
          lines.push(`- **项目类型**: ${project.type}`);
          lines.push(`- **项目路径**: ${project.rootPath}`);
          if (project.description) lines.push(`- **描述**: ${project.description}`);
          if (project.dependencies?.length) {
            lines.push(`- **依赖数量**: ${project.dependencies.length}`);
          }
        } else {
          lines.push("- **项目**: 未检测到项目");
        }

        lines.push("", "### 记忆");
        lines.push(`- **长期记忆**: ${memLineCount} 条记录`);
        if (memLineCount === 0) lines.push("  *(使用 `/remember <内容>` 保存偏好)*");

        lines.push("", "### 权限");
        lines.push(`- **模式**: ${permMeta.symbol} ${permMeta.label} (\`${permLevel}\`)`);
        lines.push(`- **说明**: ${permMeta.description}`);

        lines.push("", "### 活跃任务");
        if (activeTodo) {
          const statusIcon: Record<string, string> = {
            pending: "⬜", running: "🔄", done: "✅", failed: "❌", blocked: "🚫",
          };
          lines.push(`- **任务**: ${activeTodo.title}`);
          lines.push(`- **状态**: ${statusIcon[activeTodo.status] || "❓"} ${activeTodo.status}`);
        } else {
          lines.push("- *(无活跃任务)*");
        }
        lines.push(`- **运行时任务总数**: ${tasks.length}`);

        lines.push("", "### 工具");
        lines.push(`- **已注册工具**: ${toolCount} 个`);
        lines.push("- **LLM 提供商**: OpenAI / Anthropic / Kimi / Google / 本地");
        lines.push("- **MCP**: 扩展协议就绪");

        return lines.join("\n");
      }

      case "brief": {
        const project = getCachedProject();
        if (!project) return "📭 未检测到项目。请先设置工作目录或打开项目。";
        const lines = [
          `## 📊 项目摘要: ${project.name}`,
          "",
          `- **类型**: ${project.type}`,
          `- **路径**: ${project.rootPath}`,
        ];
        if (project.description) lines.push(`- **描述**: ${project.description}`);
        if (project.dependencies?.length) {
          lines.push(`- **依赖数量**: ${project.dependencies.length}`);
          lines.push(`- **主要依赖**: ${project.dependencies.slice(0, 8).join(", ")}`);
        }
        if (project.scripts) {
          const scriptList = Object.keys(project.scripts).slice(0, 8);
          lines.push(`- **脚本**: ${scriptList.join(", ")}`);
        }
        return lines.join("\n");
      }

      case "agents": {
        const roster = loadAgentRoster();
        const lines = [
          `## 🤖 Agent 状态 (${roster.status})`,
          "",
          `${roster.detail}`,
          "",
          "| Agent ID | 名称 |",
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
        return `## 📊 对话统计

| 指标 | 值 |
|------|------|
| 总消息数 | ${localMessages.length} |
| 用户消息 | ${userMsgs.length} |
| 助手消息 | ${assistantMsgs.length} |
| 总字符数 | ${totalChars.toLocaleString()} |
| 估计 Token | ~${estimatedTokens.toLocaleString()} |`;
      }

      case "export": {
        const format = (args[0] || "md").toLowerCase();
        if (format === "json") {
          exportAsJSON();
          return null;
        }
        exportAsMarkdown();
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
            "## 🔐 权限状态",
            "",
            `**引擎级别**: ${permMeta.symbol} ${permMeta.label} (\`${permLevel}\`)`,
            `**说明**: ${permMeta.description}`,
            "",
            "**门禁状态**:",
            `- 只读模式: ${gate.readonlyMode ? "✅" : "❌"}`,
            `- 操作已启用: ${gate.actionsEnabled ? "✅" : "❌"}`,
            `- 试运行模式: ${gate.dryRun ? "✅" : "❌"}`,
          ];
          if (rules.length > 0) {
            lines.push("", `**自定义规则 (${rules.length})**:`);
            for (const r of rules) {
              lines.push(`- \`${r.action}\` ${r.tool}${r.path ? ` @ ${r.path}` : ""}`);
            }
          }
          if (stats.length > 0) {
            lines.push("", `**拒绝统计 (top ${Math.min(5, stats.length)})**:`);
            for (const s of stats.slice(0, 5)) {
              lines.push(`- \`${s.tool}\`: ${s.count}× — ${s.topReasons.join(", ")}`);
            }
          }
          lines.push("", "可用级别: `default` `acceptEdits` `dontAsk` `bypassPermissions` `plan`");
          lines.push("门禁快捷: `/permission full` · `/permission readonly` · `/permission dryrun`");
          return lines.join("\n");
        }
        switch (levelArg.toLowerCase()) {
          case "full":
            setApprovalGate({ readonlyMode: false, actionsEnabled: true, dryRun: false });
            permissionEngine.setLevel("dontAsk");
            setAppState({ permissionMode: "dontAsk" });
            return "🔓 已设置为完全权限模式 (dontAsk)";
          case "readonly":
            setApprovalGate({ readonlyMode: true, actionsEnabled: false, dryRun: false });
            permissionEngine.setLevel("plan");
            setAppState({ permissionMode: "plan" });
            return "🔒 已设置为只读模式 (plan)";
          case "dryrun":
            setApprovalGate({ readonlyMode: false, actionsEnabled: true, dryRun: true });
            permissionEngine.setLevel("default");
            setAppState({ permissionMode: "default" });
            return "🧪 已设置为试运行模式 (default)";
          default:
            return `❌ 未知权限级别: ${levelArg}\n可用: full, readonly, dryrun`;
        }
      }

      case "model": {
        const cfg = loadConfig();
        const modelArg = args[0];
        if (!modelArg) {
          return `## 🧠 当前模型

| 项目 | 值 |
|------|------|
| Provider | ${cfg.provider} |
| Model | ${cfg.model} |

使用 \`/model <id>\` 切换模型，例如: \`/model claude-sonnet-4-6\``;
        }
        const { saveConfig: sc } = await import("../lib/agent-bridge");
        sc({ ...cfg, model: modelArg });
        return `✅ 模型已切换为 \`${modelArg}\`（Provider: ${cfg.provider}）`;
      }

      case "tasks": {
        const tasks = listTasks();
        if (tasks.length === 0) return "📭 暂无任务。使用 AI 创建任务。";
        const statusIcon: Record<string, string> = { todo: "⬜", in_progress: "🔄", blocked: "🚫", done: "✅" };
        const lines = [
          `## 📋 任务列表 (${tasks.length})`,
          "",
          "| 状态 | 任务 | 负责人 |",
          "|------|------|--------|",
          ...tasks.map(t => `| ${statusIcon[t.status] || "❓"} | ${t.title} | ${t.owner} |`),
        ];
        return lines.join("\n");
      }

      case "files": {
        const changes = getFileChanges();
        if (changes.length === 0) return "📭 本次会话无文件变更";
        return `## 📁 文件变更 (${changes.length})\n\n${getChangeSummary()}\n\n${formatFileChanges()}`;
      }

      case "usage": {
        const snapshot = buildUsageCostSnapshot();
        const lines = [
          "## 📈 使用量统计",
          "",
          "### 时段摘要",
          "| 时段 | 请求数 | Token | 费用 |",
          "|------|--------|-------|------|",
          ...snapshot.periods.map(p =>
            `| ${p.label} | ${p.requestCount} | ${p.tokens.toLocaleString()} | $${p.estimatedCost.toFixed(4)} |`
          ),
          "",
          "### 按模型",
          "| 模型 | Token | 费用 |",
          "|------|-------|------|",
          ...snapshot.breakdown.byModel.map(r =>
            `| ${r.label} | ${r.tokens.toLocaleString()} | $${r.estimatedCost.toFixed(4)} |`
          ),
          "",
          `**预算**: ${snapshot.budget.message}`,
        ];
        return lines.join("\n");
      }

      case "diff": {
        const path = args[0];
        if (!path) {
          const all = getAllBackups();
          if (all.length === 0) return "📭 本次会话无文件修改记录";
          const files = [...new Set(all.map(b => b.path))];
          return `## 📜 文件修改历史 (${all.length} 次)\n\n${files.map(f => {
            const bkps = all.filter(b => b.path === f);
            return `- \`${f}\` — ${bkps.length} 次修改`;
          }).join("\n")}\n\n使用 \`/diff <path>\` 查看具体 diff`;
        }
        const backups = getAllBackups().filter(b => b.path === path);
        if (backups.length === 0) return `📭 无 \`${path}\` 的修改记录`;
        const last = backups[backups.length - 1];
        const diffLines = formatDiff(computeDiff(last.originalContent, last.newContent));
        return `## 📄 Diff: \`${path}\`\n\n最近修改: ${new Date(last.timestamp).toLocaleString()}\n\n\`\`\`diff\n${diffLines || "(无变化)"}\n\`\`\``;
      }

      case "undo": {
        const path = args[0];
        if (!path) return "用法: `/undo <path>` — 查看可撤销内容";
        if (!canRewind(path)) return `📭 无 \`${path}\` 的备份记录，无法撤销`;
        const original = getRewindContent(path);
        return `## ↩️ 可撤销内容: \`${path}\`\n\n原始内容（撤销后恢复）:\n\n\`\`\`\n${(original || "").slice(0, 1000)}${(original || "").length > 1000 ? "\n...(内容截断)" : ""}\n\`\`\`\n\n请让 AI 执行 \`undo\` 工具以实际恢复文件。`;
      }

      default:
        return `❓ 未知命令: /${command}\n输入 /help 查看可用命令`;
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
          content: `✅ 已记住: "${memo}"`, timestamp: new Date(),
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
        content: mem ? `📝 **用户偏好**\n${mem}` : "暂无保存的偏好。使用 `/remember 内容` 来保存。",
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
      };
      const target = modelMap[modelName.toLowerCase()];
      if (target) {
        const { saveConfig } = await import("../lib/agent-bridge");
        saveConfig({ ...config, ...target } as import("../lib/agent-bridge").AgentConfig);
        setLocalMessages(prev => [...prev, {
          id: `msg_${Date.now()}_sys`,
          role: "assistant" as const,
          content: `✅ 已切换到 **${modelName}**（${target.model}）`,
          timestamp: new Date(),
        }]);
        setInput("");
        persistMessages([...localMessages, {
          id: `msg_${Date.now()}_sys`, role: "assistant" as const,
          content: `✅ 已切换到 ${modelName}`, timestamp: new Date(),
        }]);
      } else {
        setLocalMessages(prev => [...prev, {
          id: `msg_${Date.now()}_sys`, role: "assistant" as const,
          content: `❌ 未知模型: ${modelName}\n可用: kimi, claude, gpt, gemini`,
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
          <Text size="xl" fw={700} c="blue">📎 拖放文件到这里</Text>
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
              计划模式
            </Badge>
          )}
        </Group>
        <Group gap={4}>
          <Tooltip label={showHistory ? "隐藏文件历史" : "文件修改历史"} position="bottom">
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
              <Menu.Item onClick={exportAsMarkdown}>📝 导出 Markdown</Menu.Item>
              <Menu.Item onClick={exportAsJSON}>📋 导出 JSON</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {showHistory && <FileHistoryPanel />}

      <ScrollArea flex={1} viewportRef={viewport}>
        <Stack gap="sm" p="sm">
          {localMessages.length === 0 && (
            <Box ta="center" py="xl">
              <Text size="xl" fw={700}>🌟 {t("app.title")}</Text>
              <Text c="dimmed" mt="sm">{t("chat.welcome")}</Text>
              <Group mt="lg" justify="center" gap="xs">
                <Badge variant="light" color="blue">Claude</Badge>
                <Badge variant="light" color="green">OpenAI</Badge>
                <Badge variant="light" color="cyan">Gemini</Badge>
                <Badge variant="light" color="grape">Kimi</Badge>
                <Badge variant="light" color="violet">自定义</Badge>
              </Group>
              <Stack mt="xl" gap="xs" align="center">
                <Text size="sm" c="dimmed">试试这些：</Text>
                {["帮我在 /tmp 创建一个 TODO 应用", "搜索最新的 AI 新闻", "分析 package.json 的依赖"].map((hint, i) => (
                  <Badge key={i} variant="outline" size="lg" style={{ cursor: "pointer" }}
                    onClick={() => setInput(hint)}>
                    {hint}
                  </Badge>
                ))}
              </Stack>
            </Box>
          )}
          {localMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onRetry={(content) => { setInput(content); }} />
          ))}

          {/* Thinking indicator with pulse animation */}
          {isThinking && isLoading && (
            <Paper p="sm" radius="md" bg="transparent">
              <Group gap="xs">
                <Box style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                  animation: "thinking-pulse 1.5s ease-in-out infinite",
                }} />
                <Text size="sm" c="dimmed" fw={500}>正在思考...</Text>
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
                placeholder="输入回答..."
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
                回答
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
        {isLoading ? (
          <Button onClick={handleStop} color="red" variant="filled" size="md">
            ⏹ 停止
          </Button>
        ) : (
          <Button onClick={handleSend} size="md">
            {t("chat.send")}
          </Button>
        )}
      </Group>
    </Stack>
  );
}

function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry?: (content: string) => void }) {
  const isUser = message.role === "user";
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const thinkingMatch = message.content.match(/^([\s\S]*?)((?:\n?(?:🔄|📦|✅|❌|💭|💰)[\s\S]*?)*)$/);
  const mainContent = thinkingMatch?.[1]?.trim() || message.content;
  const thinkingContent = thinkingMatch?.[2]?.trim() || "";

  const handleCopy = () => {
    navigator.clipboard.writeText(mainContent || message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
      {/* Streaming indicator */}
      {message.isStreaming && !mainContent && (
        <Group gap="xs" py="xs">
          <Box style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: "pulse 1.5s infinite" }} />
          <Text size="xs" c="dimmed">思考中...</Text>
        </Group>
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <Stack gap={4} mb="xs">
          {message.toolCalls.map((tc, i) => (
            <ToolCallCard key={i} name={tc.name} input={tc.input || ""} output={tc.output} status={tc.status} />
          ))}
        </Stack>
      )}
      {isUser ? (
        <Text size="sm" c={isDark ? "white" : "dark"} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</Text>
      ) : (
        <>
          {mainContent && <MarkdownContent content={mainContent} />}
          {thinkingContent && (
            <Box mt="xs">
              <Text
                size="xs" c="dimmed" style={{ cursor: "pointer" }}
                onClick={() => setShowThinking(!showThinking)}
              >
                {showThinking ? "▼" : "▶"} 执行过程 ({thinkingContent.split("\n").filter(Boolean).length} 步)
              </Text>
              {showThinking && (
                <Box mt={4} p="xs" style={{ borderRadius: 4, fontSize: 12, opacity: 0.7 }}
                  bg={isDark ? "dark.7" : "gray.0"}>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                    {thinkingContent}
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </>
      )}
      {message.isStreaming && mainContent && <span className="cursor-blink">▊</span>}

      {/* Action buttons on hover */}
      {hovered && !message.isStreaming && (
        <Group gap={4} style={{ position: "absolute", top: 4, right: 4 }}>
          <Tooltip label={copied ? "已复制" : "复制"} position="top">
            <ActionIcon size="xs" variant="subtle" onClick={handleCopy}>
              <Text size="xs">{copied ? "✓" : "📋"}</Text>
            </ActionIcon>
          </Tooltip>
          {isUser && onRetry && (
            <Tooltip label="重新发送" position="top">
              <ActionIcon size="xs" variant="subtle" onClick={() => onRetry(message.content)}>
                <Text size="xs">🔄</Text>
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
        <Text fw={600} size="sm">📜 文件修改历史 ({backups.length} 条记录)</Text>
        {backups.length === 0 && (
          <Text size="xs" c="dimmed">本次会话暂无文件修改记录</Text>
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
                  <Text size="xs" c="dimmed">(内容未变化)</Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Paper>
  );
}

/** Inline tool call card within message bubbles */
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
  const color = st === "running" ? "blue" : st === "success" ? "green" : "red";
  const icon = st === "running" ? "🔄" : st === "success" ? "✅" : "❌";

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
        borderColor: `var(--mantine-color-${color}-${isDark ? "8" : "3"})`,
        cursor: "pointer",
      }}
      bg={isDark ? "dark.7" : "gray.0"}
      onClick={() => setExpanded(e => !e)}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Badge size="xs" variant="light" color={color} leftSection={icon}>
            {name}
          </Badge>
          {paramPreview && (
            <Text size="xs" c="dimmed" truncate style={{ maxWidth: 200 }}>{paramPreview}</Text>
          )}
        </Group>
        <Text size="xs" c="dimmed">{expanded ? "▼" : "▶"}</Text>
      </Group>
      {expanded && (
        <Box mt="xs" p="xs" style={{ borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}
          bg={isDark ? "dark.8" : "gray.1"}>
          {input && (
            <>
              <Text size="xs" fw={600} mb={2}>参数:</Text>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {(() => { try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; } })()}
              </Text>
            </>
          )}
          {output && (
            <>
              <Text size="xs" fw={600} mt="xs" mb={2}>结果:</Text>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {output.length > 500 ? output.slice(0, 500) + "..." : output}
              </Text>
            </>
          )}
        </Box>
      )}
    </Paper>
  );
}

export default ChatPage;
