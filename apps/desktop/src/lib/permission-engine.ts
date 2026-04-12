/**
 * Permission Engine — 5-level permission system
 *
 * Levels:
 *   default          — ask for every write operation
 *   acceptEdits      — auto-allow file edits, bash still needs confirmation
 *   dontAsk          — auto-allow safe ops, block only dangerous ones
 *   bypassPermissions — allow everything (developer mode)
 *   plan             — plan only, never execute
 *
 * Inspired by Claude Code's permission pipeline and the Rust PermissionPolicy.
 */

export type PermissionLevel =
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions"
  | "plan";

export const PERMISSION_LEVELS: readonly PermissionLevel[] = [
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
  "plan",
] as const;

export interface PermissionLevelMeta {
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  color: string;
  symbol: string;
}

export const PERMISSION_LEVEL_META: Record<PermissionLevel, PermissionLevelMeta> = {
  default: {
    label: "默认",
    labelEn: "Default",
    description: "每次写操作都需要确认",
    descriptionEn: "Ask for every write operation",
    color: "blue",
    symbol: "🛡️",
  },
  acceptEdits: {
    label: "接受编辑",
    labelEn: "Accept Edits",
    description: "自动允许文件编辑，命令行仍需确认",
    descriptionEn: "Auto-allow file edits, bash still needs confirmation",
    color: "teal",
    symbol: "✏️",
  },
  dontAsk: {
    label: "自动模式",
    labelEn: "Auto Mode",
    description: "自动允许安全操作，仅拦截高危操作",
    descriptionEn: "Auto-allow safe ops, block only dangerous ones",
    color: "orange",
    symbol: "⚡",
  },
  bypassPermissions: {
    label: "开发者模式",
    labelEn: "Bypass All",
    description: "全部自动允许，不弹窗（危险）",
    descriptionEn: "Allow everything without prompts (dangerous)",
    color: "red",
    symbol: "🔓",
  },
  plan: {
    label: "计划模式",
    labelEn: "Plan Mode",
    description: "只规划不执行任何工具调用",
    descriptionEn: "Plan only, never execute tools",
    color: "grape",
    symbol: "📋",
  },
};

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionRule {
  tool: string;
  path?: string;
  action: PermissionAction;
}

export interface DenialRecord {
  tool: string;
  path?: string;
  reason: string;
  timestamp: number;
}

export interface DenialStat {
  tool: string;
  count: number;
  lastAt: number;
  topReasons: string[];
}

const SAFE_READ_TOOLS = new Set([
  "file_read", "glob", "grep", "list_dir", "memory_read",
  "diff_view", "project_detect",
]);

const FILE_EDIT_TOOLS = new Set(["file_write", "file_edit", "notebook_edit"]);

const DANGEROUS_BASH_PATTERNS = [
  /rm\s+(-rf?\s+)?[/~]/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\//,
  /chmod\s+-R\s+777\s+\//,
  /shutdown/,
  /reboot/,
  /curl\s*\|.*sh/,
  /wget\s*\|.*sh/,
  /sudo\s+/,
  /git\s+push.*(-f|--force)/,
  /DROP\s+(DATABASE|TABLE)/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
];

function isDangerousBash(command: string): boolean {
  return DANGEROUS_BASH_PATTERNS.some(p => p.test(command));
}

function matchPath(pattern: string, target: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return target.startsWith(prefix);
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return target.startsWith(prefix);
  }
  return target === pattern;
}

class PermissionEngine {
  private level: PermissionLevel = "default";
  private rules: PermissionRule[] = [];
  private denials: DenialRecord[] = [];
  private storageKey = "se_permission_level";
  private rulesKey = "se_permission_rules";
  private denialsKey = "se_permission_denials";

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved && PERMISSION_LEVELS.includes(saved as PermissionLevel)) {
        this.level = saved as PermissionLevel;
      }
      const savedRules = localStorage.getItem(this.rulesKey);
      if (savedRules) {
        this.rules = JSON.parse(savedRules) as PermissionRule[];
      }
      const savedDenials = localStorage.getItem(this.denialsKey);
      if (savedDenials) {
        this.denials = JSON.parse(savedDenials) as DenialRecord[];
      }
    } catch {
      // localStorage unavailable or corrupt — use defaults
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey, this.level);
      localStorage.setItem(this.rulesKey, JSON.stringify(this.rules));
      localStorage.setItem(this.denialsKey, JSON.stringify(this.denials));
    } catch {
      // ignore
    }
  }

  getLevel(): PermissionLevel {
    return this.level;
  }

  setLevel(level: PermissionLevel): void {
    this.level = level;
    this.persist();
  }

  checkPermission(
    tool: string,
    args: Record<string, unknown>,
    level?: PermissionLevel,
  ): PermissionAction {
    const activeLevel = level ?? this.level;

    // Plan mode: always deny (caller should format as plan output)
    if (activeLevel === "plan") {
      return "deny";
    }

    // Bypass: always allow
    if (activeLevel === "bypassPermissions") {
      return "allow";
    }

    // Read-only tools: always allow regardless of level
    if (SAFE_READ_TOOLS.has(tool)) {
      return "allow";
    }

    // Check explicit rules first (user-defined rules take priority)
    const ruleResult = this.checkRules(tool, args);
    if (ruleResult !== null) {
      return ruleResult;
    }

    const path = typeof args.path === "string" ? args.path : undefined;
    const command = typeof args.command === "string" ? args.command : undefined;

    switch (activeLevel) {
      case "default":
        // Ask for all write operations
        return SAFE_READ_TOOLS.has(tool) ? "allow" : "ask";

      case "acceptEdits":
        // Auto-allow file edits, ask for bash and other write tools
        if (FILE_EDIT_TOOLS.has(tool)) {
          return this.isPathSensitive(path) ? "ask" : "allow";
        }
        return "ask";

      case "dontAsk":
        // Auto-allow safe ops, only block dangerous
        if (FILE_EDIT_TOOLS.has(tool)) {
          return this.isPathSensitive(path) ? "ask" : "allow";
        }
        if (tool === "bash" && command) {
          return isDangerousBash(command) ? "ask" : "allow";
        }
        if (tool === "web_search" || tool === "web_fetch") {
          return "allow";
        }
        if (tool === "browser_open") {
          return "allow";
        }
        if (tool === "agent_spawn") {
          return "allow";
        }
        if (tool === "memory_write") {
          return "allow";
        }
        if (tool === "undo") {
          return "allow";
        }
        return "ask";

      default:
        return "ask";
    }
  }

  private checkRules(tool: string, args: Record<string, unknown>): PermissionAction | null {
    const path = typeof args.path === "string" ? args.path : undefined;

    for (const rule of this.rules) {
      if (rule.tool !== tool && rule.tool !== "*") continue;
      if (rule.path && path) {
        if (matchPath(rule.path, path)) return rule.action;
      } else if (!rule.path) {
        return rule.action;
      }
    }
    return null;
  }

  private isPathSensitive(path: string | undefined): boolean {
    if (!path) return false;
    const sensitive = [
      "/etc/", "/usr/", "/System/", "/bin/", "/sbin/",
      "/.ssh/", "/.config/", "/.env", "/.git/",
      "/.claude/", "/.vscode/",
    ];
    return sensitive.some(s => path.includes(s));
  }

  rememberRule(rule: PermissionRule): void {
    const existing = this.rules.findIndex(
      r => r.tool === rule.tool && r.path === rule.path,
    );
    if (existing >= 0) {
      this.rules[existing] = rule;
    } else {
      this.rules.push(rule);
    }
    this.persist();
  }

  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  clearRules(): void {
    this.rules = [];
    this.persist();
  }

  removeRule(index: number): void {
    this.rules.splice(index, 1);
    this.persist();
  }

  trackDenial(tool: string, reason: string, path?: string): void {
    this.denials.push({ tool, path, reason, timestamp: Date.now() });
    // Keep last 200 denials
    if (this.denials.length > 200) {
      this.denials = this.denials.slice(-200);
    }
    this.persist();
  }

  getDenialHistory(): DenialRecord[] {
    return [...this.denials];
  }

  getRecentDenialCount(windowMs: number = 60_000): number {
    const cutoff = Date.now() - windowMs;
    return this.denials.filter(d => d.timestamp > cutoff).length;
  }

  /** Aggregate denial records by tool for analytics display. */
  getDenialStats(): DenialStat[] {
    const map = new Map<string, { count: number; lastAt: number; reasons: string[] }>();
    for (const d of this.denials) {
      const entry = map.get(d.tool) ?? { count: 0, lastAt: 0, reasons: [] };
      entry.count += 1;
      if (d.timestamp > entry.lastAt) entry.lastAt = d.timestamp;
      if (!entry.reasons.includes(d.reason)) entry.reasons.push(d.reason);
      map.set(d.tool, entry);
    }
    return Array.from(map.entries())
      .map(([tool, v]) => ({
        tool,
        count: v.count,
        lastAt: v.lastAt,
        topReasons: v.reasons.slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count);
  }

  clearDenials(): void {
    this.denials = [];
    this.persist();
  }

  /** Export a structured audit report for review or persistence. */
  getAuditReport(): {
    level: PermissionLevel;
    rulesCount: number;
    denialCount: number;
    recentDenials: number;
    topDeniedTools: DenialStat[];
    rules: PermissionRule[];
  } {
    return {
      level: this.level,
      rulesCount: this.rules.length,
      denialCount: this.denials.length,
      recentDenials: this.getRecentDenialCount(3600_000),
      topDeniedTools: this.getDenialStats().slice(0, 5),
      rules: this.getRules(),
    };
  }
}

export const permissionEngine = new PermissionEngine();
