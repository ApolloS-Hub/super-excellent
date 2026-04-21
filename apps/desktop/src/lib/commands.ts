/**
 * commands.ts — Slash command control plane
 *
 * Separates slash command definitions from ChatPage rendering.
 * Each command is a pure function that receives a CommandContext
 * and returns a Markdown result string (or null to defer).
 *
 * Inspired by Claude Code's commands.ts pattern: control plane
 * (meta commands for the user) is distinct from execution plane
 * (tool/LLM calls to get work done).
 */

import i18n from "../i18n";
import type { ChatMessage, AgentConfig } from "./agent-bridge";
import type { Conversation } from "./conversations";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

/**
 * Context passed to every command handler. Keeps commands pure:
 * they get all they need via this object, never touch React state directly.
 */
export interface CommandContext {
  conversation: Conversation | null;
  localMessages: ChatMessage[];
  setLocalMessages: (msgs: ChatMessage[]) => void;
  config: AgentConfig;
  args: string[];
  /** Command-name only (without leading /) */
  command: string;
  /** Raw original input including slash */
  raw: string;
}

export type CommandHandler = (ctx: CommandContext) => Promise<string | null> | string | null;

export interface CommandSpec {
  name: string;
  aliases?: string[];
  /** Short description shown in /help */
  description: string;
  handler: CommandHandler;
}

const registry = new Map<string, CommandSpec>();

export function registerCommand(spec: CommandSpec): void {
  registry.set(spec.name, spec);
  for (const alias of spec.aliases ?? []) {
    registry.set(alias, spec);
  }
}

export function getCommand(name: string): CommandSpec | undefined {
  return registry.get(name);
}

export function listCommands(): CommandSpec[] {
  const unique = new Set<CommandSpec>();
  for (const spec of registry.values()) unique.add(spec);
  return Array.from(unique).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse a slash command input into { command, args }.
 * Returns null if the input is not a slash command.
 */
export function parseSlashCommand(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  if (!command) return null;
  return { command, args: parts.slice(1) };
}

/**
 * Main dispatch: parse + lookup + execute.
 * Returns the command result, or null if no command matched.
 */
export async function dispatchCommand(
  input: string,
  contextBase: Omit<CommandContext, "args" | "command" | "raw">,
): Promise<string | null> {
  const parsed = parseSlashCommand(input);
  if (!parsed) return null;

  const spec = registry.get(parsed.command);
  if (!spec) {
    return `❓ ${t("chat.unknownCommand", { command: parsed.command })}`;
  }

  const ctx: CommandContext = {
    ...contextBase,
    args: parsed.args,
    command: parsed.command,
    raw: input,
  };

  try {
    const result = await spec.handler(ctx);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ ${spec.name}: ${msg}`;
  }
}

// ═══════════ Built-in commands ═══════════
// These are the simple, pure commands that don't need React state.
// Complex commands (with exports, file ops, diagnostics) stay in ChatPage
// for now — they can be migrated incrementally.

registerCommand({
  name: "clear",
  aliases: ["cls"],
  description: t("chat.helpClear"),
  handler: (ctx) => {
    ctx.setLocalMessages([]);
    return `🗑️ ${t("chat.conversationCleared")}`;
  },
});

registerCommand({
  name: "compact",
  description: t("chat.helpCompact"),
  handler: (ctx) => {
    const msgs = ctx.localMessages;
    const userMsgs = msgs.filter(m => m.role === "user").length;
    const assistantMsgs = msgs.filter(m => m.role === "assistant").length;
    if (msgs.length <= 4) return t("chat.tooShortToCompact");
    const keep = msgs.slice(-4);
    ctx.setLocalMessages(keep);
    return `📦 ${t("chat.compacted", { count: userMsgs + assistantMsgs - 4 })}`;
  },
});

registerCommand({
  name: "cost",
  description: t("chat.helpCost"),
  handler: () => `💰 ${t("chat.costHint")}`,
});

registerCommand({
  name: "todo",
  description: t("chat.helpTodo"),
  handler: () => `📋 ${t("chat.todoHint")}`,
});

registerCommand({
  name: "config",
  description: t("chat.helpConfig"),
  handler: (ctx) => {
    const cfg = ctx.config;
    return `## ⚙️ ${t("chat.configTitle")}

| ${t("chat.configItem")} | ${t("chat.configValue")} |
|------|------|
| Provider | ${cfg.provider} |
| Model | ${cfg.model} |
| Base URL | ${cfg.baseURL || `(${t("chat.configDefault")})`} |
| ${t("chat.configWorkDir")} | ${cfg.workDir || `(${t("chat.configNotSet")})`} |
| API Key | ${cfg.apiKey ? `✅ ${t("chat.configApiKeySet")}` : `❌ ${t("chat.configApiKeyNotSet")}`} |`;
  },
});

registerCommand({
  name: "help",
  aliases: ["?"],
  description: t("chat.helpShowHelp"),
  handler: () => {
    const cmds = listCommands();
    const lines = [`# ${t("chat.helpTitle")}`, ""];
    lines.push(`| ${t("chat.helpCommand")} | ${t("chat.helpDescription")} |`);
    lines.push("|------|------|");
    for (const c of cmds) {
      const aliases = c.aliases?.length ? ` (${c.aliases.join(", ")})` : "";
      lines.push(`| /${c.name}${aliases} | ${c.description} |`);
    }
    return lines.join("\n");
  },
});

// ═══════════ Instruction memory commands ═══════════

registerCommand({
  name: "rule-add",
  aliases: ["remember-rule", "rule"],
  description: "Add a permanent instruction rule (e.g. /rule-add always respond in Chinese)",
  handler: async (ctx) => {
    const rule = ctx.args.join(" ").trim();
    if (!rule) return "❌ Usage: /rule-add <your rule>\nExample: /rule-add always use TypeScript";
    const { addRule } = await import("./instruction-memory");
    const created = addRule(rule);
    return `✅ Rule added (id: ${created.id}):\n> ${created.rule}`;
  },
});

registerCommand({
  name: "rules",
  aliases: ["rule-list", "my-rules"],
  description: "List all user-curated instruction rules",
  handler: async () => {
    const { listRules } = await import("./instruction-memory");
    const rules = listRules();
    if (rules.length === 0) return "📭 No rules yet. Use `/rule-add <rule>` to add one.";
    const lines = ["## 📌 Your Instruction Rules", ""];
    for (const r of rules) {
      const status = r.enabled === false ? " *(disabled)*" : "";
      lines.push(`- **${r.id}**${status}: ${r.rule}`);
    }
    lines.push("", "Use `/rule-remove <id>` to delete, `/rule-toggle <id>` to enable/disable.");
    return lines.join("\n");
  },
});

registerCommand({
  name: "rule-remove",
  aliases: ["rule-del"],
  description: "Remove an instruction rule by id",
  handler: async (ctx) => {
    const id = ctx.args[0];
    if (!id) return "❌ Usage: /rule-remove <id> — see /rules for ids";
    const { removeRule } = await import("./instruction-memory");
    return removeRule(id) ? `✅ Removed rule ${id}` : `❌ No rule with id ${id}`;
  },
});

registerCommand({
  name: "rule-toggle",
  description: "Enable/disable an instruction rule without deleting it",
  handler: async (ctx) => {
    const id = ctx.args[0];
    if (!id) return "❌ Usage: /rule-toggle <id>";
    const { toggleRule } = await import("./instruction-memory");
    return toggleRule(id) ? `✅ Toggled rule ${id}` : `❌ No rule with id ${id}`;
  },
});

// ═══════════ Security policy commands ═══════════

registerCommand({
  name: "security",
  aliases: ["sandbox", "policy"],
  description: "View or set security policy (approval + sandbox modes)",
  handler: async (ctx) => {
    const { getPolicy, POLICY_PRESETS, applyPreset, setPolicy } = await import("./sandbox-policy");
    const sub = ctx.args[0]?.toLowerCase();

    if (!sub || sub === "status") {
      const p = getPolicy();
      const zh = i18n.language.startsWith("zh");
      return `## 🔒 ${zh ? "安全策略" : "Security Policy"}

| ${zh ? "项目" : "Setting"} | ${zh ? "值" : "Value"} |
|------|------|
| ${zh ? "审批模式" : "Approval Mode"} | \`${p.approvalMode}\` |
| ${zh ? "沙箱模式" : "Sandbox Mode"} | \`${p.sandboxMode}\` |
| ${zh ? "网络访问" : "Network"} | ${p.networkEnabled ? "✅ ON" : "❌ OFF"} |
| ${zh ? "受保护路径" : "Protected Paths"} | ${p.protectedPaths.length} |

${zh ? "预设" : "Presets"}: ${POLICY_PRESETS.map(p => `\`${p.name}\``).join(", ")}
${zh ? "用法" : "Usage"}: \`/security <preset>\` ${zh ? "或" : "or"} \`/security network on|off\``;
    }

    if (sub === "network") {
      const val = ctx.args[1]?.toLowerCase();
      if (val === "on" || val === "true") {
        setPolicy({ networkEnabled: true });
        return "✅ Network access enabled";
      } else if (val === "off" || val === "false") {
        setPolicy({ networkEnabled: false });
        return "✅ Network access disabled";
      }
      return "❌ Usage: /security network on|off";
    }

    const preset = POLICY_PRESETS.find(p => p.name === sub);
    if (preset) {
      applyPreset(preset.name);
      const zh = i18n.language.startsWith("zh");
      return `✅ ${zh ? "已切换到" : "Switched to"}: **${zh ? preset.labelZh : preset.label}**\n${zh ? preset.descriptionZh : preset.description}`;
    }

    return `❌ Unknown option: ${sub}\nPresets: ${POLICY_PRESETS.map(p => p.name).join(", ")}`;
  },
});

// ═══════════ /review command ═══════════

registerCommand({
  name: "review",
  aliases: ["code-review", "cr"],
  description: "Review code changes (uncommitted, staged, branch diff)",
  handler: async (ctx) => {
    const sub = ctx.args[0]?.toLowerCase() || "uncommitted";
    const zh = i18n.language.startsWith("zh");

    let diffCmd = "";
    let label = "";

    switch (sub) {
      case "staged":
        diffCmd = "git diff --cached";
        label = zh ? "已暂存的改动" : "Staged changes";
        break;
      case "branch": {
        const base = ctx.args[1] || "main";
        diffCmd = `git diff ${base}...HEAD`;
        label = zh ? `相对 ${base} 的改动` : `Changes vs ${base}`;
        break;
      }
      case "commit": {
        const ref = ctx.args[1] || "HEAD";
        diffCmd = `git show ${ref} --stat`;
        label = zh ? `提交 ${ref}` : `Commit ${ref}`;
        break;
      }
      case "uncommitted":
      default:
        diffCmd = "git diff";
        label = zh ? "未提交的改动" : "Uncommitted changes";
        break;
    }

    let diff = "";
    try {
      const { isTauriAvailable } = await import("./tauri-bridge");
      if (isTauriAvailable()) {
        const { invoke } = await import("@tauri-apps/api/core");
        diff = await invoke("execute_command", { command: diffCmd }) as string;
      }
    } catch { /* not in Tauri */ }

    if (!diff || diff.trim().length === 0) {
      return zh
        ? `📝 **${label}**: 没有改动`
        : `📝 **${label}**: No changes found`;
    }

    const lines = diff.split("\n");
    const stats = {
      filesChanged: lines.filter(l => l.startsWith("diff --git")).length || "?",
      additions: lines.filter(l => l.startsWith("+") && !l.startsWith("+++")).length,
      deletions: lines.filter(l => l.startsWith("-") && !l.startsWith("---")).length,
    };

    const truncated = lines.length > 200 ? lines.slice(0, 200).join("\n") + "\n... (truncated)" : diff;

    return `## 📝 ${label}

| ${zh ? "统计" : "Stat"} | ${zh ? "值" : "Value"} |
|------|------|
| ${zh ? "文件" : "Files"} | ${stats.filesChanged} |
| ${zh ? "新增行" : "Additions"} | +${stats.additions} |
| ${zh ? "删除行" : "Deletions"} | -${stats.deletions} |

\`\`\`diff
${truncated}
\`\`\`

${zh ? "提示：发送 \"帮我审查上面的代码\" 让 AI 分析" : "Tip: Send \"review the code above\" to get AI analysis"}`;
  },
});

// ═══════════ /model command (switch model mid-session) ═══════════

registerCommand({
  name: "model",
  aliases: ["switch-model"],
  description: "Switch AI model mid-session (e.g. /model claude-opus-4-7)",
  handler: (ctx) => {
    const modelArg = ctx.args[0];
    if (!modelArg) {
      const zh = i18n.language.startsWith("zh");
      return `## ${zh ? "当前模型" : "Current Model"}

**${ctx.config.provider}** / \`${ctx.config.model}\`

${zh ? "用法" : "Usage"}: \`/model <model-id>\`
${zh ? "例如" : "Examples"}: \`/model claude-opus-4-7\`, \`/model claude-sonnet-4-6\`, \`/model gpt-4o\`, \`/model deepseek-chat\``;
    }

    try {
      const raw = localStorage.getItem("agent-config");
      if (raw) {
        const config = JSON.parse(raw);
        const oldModel = config.model;
        config.model = modelArg;
        localStorage.setItem("agent-config", JSON.stringify(config));
        return `✅ ${i18n.language.startsWith("zh") ? "模型已切换" : "Model switched"}: \`${oldModel}\` → \`${modelArg}\`\n\n⚠️ ${i18n.language.startsWith("zh") ? "刷新页面后完全生效" : "Refresh page for full effect"}`;
      }
    } catch { /* storage error */ }

    return "❌ Failed to update model config";
  },
});

// ═══════════ /resume command (resume last conversation) ═══════════

registerCommand({
  name: "resume",
  aliases: ["resume-last", "last"],
  description: "Resume the most recent conversation",
  handler: async (ctx) => {
    const { loadConversationsAsync } = await import("./conversations");
    const convs = await loadConversationsAsync();
    const zh = i18n.language.startsWith("zh");

    if (convs.length === 0) {
      return zh ? "📭 没有历史对话可以恢复" : "📭 No previous conversations to resume";
    }

    const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);

    if (ctx.conversation?.id === sorted[0].id) {
      return zh ? "ℹ️ 当前已经是最新的对话" : "ℹ️ Already on the most recent conversation";
    }

    const lines = [
      zh ? `## 📂 最近的对话` : `## 📂 Recent Conversations`,
      "",
      `| # | ${zh ? "标题" : "Title"} | ${zh ? "消息数" : "Messages"} | ${zh ? "更新时间" : "Updated"} |`,
      "|---|------|------|------|",
    ];

    for (let i = 0; i < Math.min(sorted.length, 5); i++) {
      const c = sorted[i];
      const date = new Date(c.updatedAt).toLocaleDateString();
      lines.push(`| ${i + 1} | ${c.title} | ${c.messages.length} | ${date} |`);
    }

    lines.push("", zh
      ? "在侧边栏点击对话名称即可切换"
      : "Click a conversation in the sidebar to switch");

    return lines.join("\n");
  },
});

// ═══════════ Audit log command ═══════════

registerCommand({
  name: "audit",
  aliases: ["log", "trail"],
  description: "View recent audit trail (append-only operation log)",
  handler: async (ctx) => {
    const { tail, sessionStats, getEntryCount } = await import("./audit-logger");
    const n = ctx.args[0] ? parseInt(ctx.args[0]) : 20;
    const entries = tail(n);
    const stats = sessionStats();

    if (entries.length === 0) return "📭 No audit entries yet.";

    const lines = [
      `## 📜 Audit Trail (last ${entries.length} of ${getEntryCount()})`,
      "",
      `**Session**: ${stats.toolCalls} tools, ${stats.errors} errors, ${stats.filesModified} files modified`,
      "",
      "| Time | Type | Actor | Target | Detail |",
      "|------|------|-------|--------|--------|",
    ];
    for (const e of entries) {
      const time = e.ts.slice(11, 19);
      const ok = e.ok === false ? "❌" : e.ok === true ? "✅" : "";
      const dur = e.durationMs ? ` (${e.durationMs}ms)` : "";
      lines.push(`| ${time} | ${e.type} | ${e.actor} | ${e.target} | ${ok}${(e.detail || "").slice(0, 60)}${dur} |`);
    }
    lines.push("", "Use `/audit 50` to see more. `/audit export` to download JSONL.");

    if (ctx.args[0] === "export") {
      const { exportJsonl } = await import("./audit-logger");
      const jsonl = exportJsonl();
      const blob = new Blob([jsonl], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
      return "✅ Audit log exported as JSONL";
    }

    return lines.join("\n");
  },
});

// ═══════════ OMX patterns ═══════════

const INTERVIEW_KEY = "omx-interview-active";

registerCommand({
  name: "interview",
  aliases: ["deep-interview", "clarify"],
  description: "Socratic clarification interview (quick|standard|deep)",
  handler: async (ctx) => {
    const iv = await import("./deep-interview");
    const zh = i18n.language.startsWith("zh");
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === "answer") {
      const raw = localStorage.getItem(INTERVIEW_KEY);
      if (!raw) return zh ? "❌ 当前没有进行中的面谈，请先 /interview <话题>" : "❌ No active interview. Start with /interview <topic>";
      const state = JSON.parse(raw) as import("./deep-interview").InterviewState;
      const answer = ctx.args.slice(1).join(" ").trim();
      if (!answer) return zh ? "❌ 用法：/interview answer <你的回答>" : "❌ Usage: /interview answer <your answer>";
      const lastRound = state.rounds[state.rounds.length - 1];
      const lastQ = lastRound?.question ?? "";
      const lastMode = lastRound?.mode;
      // Drop the pending round before recording, then record fresh
      const rollback = { ...state, rounds: state.rounds.slice(0, -1) };
      const updated = iv.recordAnswer(rollback, lastQ, answer, lastMode);
      localStorage.setItem(INTERVIEW_KEY, JSON.stringify(updated));
      if (updated.converged) {
        localStorage.removeItem(INTERVIEW_KEY);
        let saved: string | null = null;
        if (ctx.config.workDir) saved = await iv.saveSpec(updated, ctx.config.workDir);
        return `## ${zh ? "面谈结束" : "Interview complete"}\n\n${zh ? "最终歧义度" : "Final ambiguity"}: **${updated.score.overall.toFixed(2)}**\n${saved ? `${zh ? "规格文档已保存" : "Spec saved"}: \`${saved}\`` : ""}\n\n---\n\n${iv.renderSpec(updated)}`;
      }
      const next = iv.nextQuestion(updated);
      const pending = { ...updated, rounds: [...updated.rounds, { round: updated.rounds.length + 1, question: next.question, mode: next.mode }] };
      localStorage.setItem(INTERVIEW_KEY, JSON.stringify(pending));
      return `**${zh ? "第" : "Round"} ${pending.rounds.length}${zh ? "轮" : ""}** (${zh ? "歧义度" : "ambiguity"}: ${updated.score.overall.toFixed(2)})\n\n${next.mode ? `_${next.mode}_\n\n` : ""}**Q:** ${next.question}\n\n${zh ? "用 `/interview answer <回答>` 继续" : "Reply with `/interview answer <your answer>`"}`;
    }

    if (sub === "done" || sub === "cancel") {
      const raw = localStorage.getItem(INTERVIEW_KEY);
      if (!raw) return zh ? "没有进行中的面谈" : "No active interview";
      const state = JSON.parse(raw) as import("./deep-interview").InterviewState;
      localStorage.removeItem(INTERVIEW_KEY);
      if (sub === "cancel") return zh ? "❎ 已取消" : "❎ Cancelled";
      let saved: string | null = null;
      if (ctx.config.workDir) saved = await iv.saveSpec(state, ctx.config.workDir);
      return `## ${zh ? "面谈结束" : "Interview complete"}\n\n${saved ? `${zh ? "规格文档已保存" : "Spec saved"}: \`${saved}\`\n\n` : ""}${iv.renderSpec(state)}`;
    }

    const profileArg = (ctx.args[0] === "quick" || ctx.args[0] === "standard" || ctx.args[0] === "deep") ? ctx.args[0] : null;
    const profile = (profileArg ?? "standard") as import("./deep-interview").InterviewProfile;
    const topic = (profileArg ? ctx.args.slice(1) : ctx.args).join(" ").trim();
    if (!topic) {
      return zh
        ? "用法：`/interview [quick|standard|deep] <话题>`，然后用 `/interview answer <回答>` 逐轮回答"
        : "Usage: `/interview [quick|standard|deep] <topic>`, then `/interview answer <your answer>`";
    }
    const state = iv.startInterview(topic, profile);
    const next = iv.nextQuestion(state);
    const pending = { ...state, rounds: [{ round: 1, question: next.question, mode: next.mode }] };
    localStorage.setItem(INTERVIEW_KEY, JSON.stringify(pending));
    return `## ${zh ? "深度面谈" : "Deep Interview"} — ${topic}\n\n- ${zh ? "档位" : "Profile"}: \`${profile}\`\n- ${zh ? "初始歧义度" : "Initial ambiguity"}: **${state.score.overall.toFixed(2)}**\n\n**Q:** ${next.question}\n\n${zh ? "用 `/interview answer <回答>` 继续" : "Reply with `/interview answer <your answer>`"}`;
  },
});

registerCommand({
  name: "plan",
  aliases: ["ralplan"],
  description: "Start a three-role deliberation (planner → architect → critic)",
  handler: async (ctx) => {
    const rp = await import("./ralplan");
    const zh = i18n.language.startsWith("zh");
    const title = ctx.args.join(" ").trim();
    if (!title) {
      return zh
        ? "用法：`/plan <标题>` — 会基于最近一次面谈的 spec 或对话上下文生成 ADR"
        : "Usage: `/plan <title>` — generates an ADR from the latest interview spec or conversation";
    }
    const lastUser = [...ctx.localMessages].reverse().find(m => m.role === "user")?.content?.slice(0, 2000) ?? "";
    const session = rp.startSession(title, lastUser || title);
    localStorage.setItem("omx-ralplan-session", JSON.stringify(session));
    return `## ${zh ? "Ralplan 启动" : "Ralplan started"} — ${title}\n\n${zh ? "会话 ID" : "Session"}: \`${session.id}\`\n\n${zh ? "提示：让 AI 扮演 planner/architect/critic 三个角色迭代讨论。可用 prompt：" : "Next: have the AI play planner/architect/critic iteratively. Prompt hint:"}\n\n\`\`\`\n${rp.buildPrompt(session, "planner")}\n\`\`\``;
  },
});

registerCommand({
  name: "ralph",
  description: "Kick off a persistent completion loop",
  handler: async (ctx) => {
    const rl = await import("./ralph-loop");
    const zh = i18n.language.startsWith("zh");
    const goal = ctx.args.join(" ").trim();
    if (!goal) {
      return zh
        ? "用法：`/ralph <目标>` — 分 6 阶段（pre-context/execute/verify/review/deslop/regression）逐轮推进"
        : "Usage: `/ralph <goal>` — splits goal into 6 stages (pre-context/execute/verify/review/deslop/regression)";
    }
    const session = rl.startRalph(goal, 5);
    localStorage.setItem("ralph-session", JSON.stringify(session));
    return `## ${zh ? "Ralph 循环启动" : "Ralph loop started"} — ${goal}\n\n- ${zh ? "最多" : "Max"} ${session.maxIterations} ${zh ? "轮" : "iterations"}\n- ${zh ? "阶段" : "Stages"}: ${rl.STAGES.join(" → ")}\n\n${zh ? "首阶段" : "First stage"}: **${rl.STAGES[0]}**\n\n${zh ? "在 HUD 面板中监控进度（/hud），完整报告会保存在" : "Monitor progress in the HUD (/hud); full report will be at"} \`.omx/sessions/${session.id}.md\``;
  },
});

registerCommand({
  name: "deslop",
  aliases: ["slop-clean", "clean-slop"],
  description: "Scrub AI-slop patterns from the last assistant message or supplied code",
  handler: async (ctx) => {
    const { cleanSlop, summarizeFindings } = await import("./ai-slop-cleaner");
    const zh = i18n.language.startsWith("zh");
    let source = ctx.args.join(" ");
    if (!source) {
      const last = [...ctx.localMessages].reverse().find(m => m.role === "assistant");
      if (!last) return zh ? "❌ 没有可清理的内容" : "❌ Nothing to clean";
      source = last.content;
    }
    const result = cleanSlop(source);
    if (result.findings.length === 0) {
      return summarizeFindings(result);
    }
    return `${summarizeFindings(result)}\n\n### ${zh ? "清理后" : "Cleaned"}\n\n\`\`\`\n${result.cleaned}\n\`\`\``;
  },
});

registerCommand({
  name: "wiki",
  description: "Project wiki: list | get <slug> | save <title> <body> | search <query>",
  handler: async (ctx) => {
    const wiki = await import("./project-wiki");
    const zh = i18n.language.startsWith("zh");
    if (!ctx.config.workDir) {
      return zh ? "❌ 未设置工作目录，无法使用 wiki" : "❌ workDir not set — wiki unavailable";
    }
    const sub = ctx.args[0]?.toLowerCase() || "list";

    if (sub === "list") {
      const entries = await wiki.listEntries(ctx.config.workDir);
      if (entries.length === 0) return zh ? "📭 wiki 为空，用 `/wiki save <标题> <内容>` 新建" : "📭 Wiki is empty. Use `/wiki save <title> <body>`";
      const lines = [`## 📚 ${zh ? "项目 wiki" : "Project Wiki"} (${entries.length})`, "", `| Slug | ${zh ? "标题" : "Title"} | ${zh ? "标签" : "Tags"} |`, "|---|---|---|"];
      for (const e of entries.slice(0, 25)) lines.push(`| \`${e.slug}\` | ${e.title} | ${e.tags.join(", ") || "—"} |`);
      return lines.join("\n");
    }
    if (sub === "get") {
      const slug = ctx.args[1];
      if (!slug) return "Usage: /wiki get <slug>";
      const got = await wiki.getEntry(ctx.config.workDir, slug);
      if (!got) return `❌ Not found: ${slug}`;
      return `## ${got.entry.title}\n\n${got.content}`;
    }
    if (sub === "save") {
      const title = ctx.args[1];
      const body = ctx.args.slice(2).join(" ");
      if (!title || !body) return "Usage: /wiki save <title> <body>";
      const saved = await wiki.saveEntry(ctx.config.workDir, title, body);
      return saved ? `✅ ${zh ? "已保存" : "Saved"}: \`${saved.slug}\` → \`${saved.path}\`` : "❌ Save failed";
    }
    if (sub === "search") {
      const q = ctx.args.slice(1).join(" ");
      if (!q) return "Usage: /wiki search <query>";
      const hits = await wiki.search(ctx.config.workDir, q);
      if (hits.length === 0) return zh ? "🔍 没有结果" : "🔍 No hits";
      const lines = [`## 🔎 ${zh ? "搜索" : "Search"}: \`${q}\``, ""];
      for (const h of hits) lines.push(`- \`${h.entry.slug}\` — ${h.entry.title} _(score ${h.score}, ${h.matches.join(", ")})_`);
      return lines.join("\n");
    }
    return `Usage: /wiki [list | get <slug> | save <title> <body> | search <query>]`;
  },
});

registerCommand({
  name: "hud",
  description: "Toggle the HUD (live iteration/context/worker dashboard)",
  handler: (ctx) => {
    const zh = i18n.language.startsWith("zh");
    const current = localStorage.getItem("hud-visible") === "true";
    const sub = ctx.args[0]?.toLowerCase();
    const next = sub === "on" ? true : sub === "off" ? false : !current;
    localStorage.setItem("hud-visible", String(next));
    window.dispatchEvent(new CustomEvent("hud-toggle", { detail: { visible: next } }));
    return next
      ? (zh ? "🖥️ HUD 已开启。在侧边/顶栏查看实时指标。" : "🖥️ HUD on. Check the sidebar/header for live metrics.")
      : (zh ? "HUD 已关闭。" : "HUD off.");
  },
});

registerCommand({
  name: "doctor",
  aliases: ["diagnose", "health"],
  description: "Full doctor diagnostic (install + runtime + quality gate + env)",
  handler: async (ctx) => {
    const { runDoctorReport, renderDoctorReport } = await import("./health-monitor");
    const zh = i18n.language.startsWith("zh");
    const skip = ctx.args[0] === "quick" || ctx.args[0] === "no-smoke";

    const report = await runDoctorReport({ skipSmokeTest: skip });
    const parts: string[] = [renderDoctorReport(report, { zh })];

    try {
      const { collectDiagnosticsBundle, formatDiagnosticsText } = await import("./runtime/diagnostics");
      const bundle = collectDiagnosticsBundle({ appName: "super-excellent" });
      parts.push("", `### ${zh ? "运行环境" : "Runtime Environment"}`, "", "```", formatDiagnosticsText(bundle).trimEnd(), "```");
    } catch { /* diagnostics module unavailable */ }

    try {
      const { installDefaultCheckers, runQualityGate, formatGateResult } = await import("./runtime/quality-gate");
      installDefaultCheckers();
      const gate = await runQualityGate();
      parts.push("", `### ${zh ? "质量门禁" : "Quality Gate"}`, "", "```", formatGateResult(gate), "```");
    } catch { /* quality-gate module unavailable */ }

    return parts.join("\n");
  },
});
