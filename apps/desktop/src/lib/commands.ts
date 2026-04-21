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
