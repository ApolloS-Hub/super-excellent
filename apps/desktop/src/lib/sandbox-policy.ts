/**
 * Sandbox Policy — Codex-inspired two-axis security model
 *
 * Two orthogonal axes:
 *   1. ApprovalMode — when the agent must ask the user before acting
 *   2. SandboxMode — what the agent is physically allowed to do
 *
 * Plus convenience presets that combine both (e.g. "full-auto").
 */

import { audit } from "./audit-logger";

// ═══════════ Types ═══════════

export type ApprovalMode =
  | "on-request"   // default: ask for dangerous ops only
  | "untrusted"    // ask before anything that mutates state
  | "never";       // no prompts (sandbox still enforces limits)

export type SandboxMode =
  | "read-only"         // can only read files, no writes/commands/network
  | "workspace-write"   // write only within workDir, network off by default
  | "full-access";      // no sandbox restrictions (dangerous)

export interface SecurityPolicy {
  approvalMode: ApprovalMode;
  sandboxMode: SandboxMode;
  networkEnabled: boolean;
  protectedPaths: string[];
  allowedWritePaths: string[];
}

export interface PolicyPreset {
  name: string;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  approvalMode: ApprovalMode;
  sandboxMode: SandboxMode;
  networkEnabled: boolean;
}

// ═══════════ Presets ═══════════

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    name: "safe",
    label: "Safe Mode",
    labelZh: "安全模式",
    description: "Read-only, asks before everything. Best for exploring.",
    descriptionZh: "只读模式，所有操作都需确认。适合浏览和探索。",
    approvalMode: "untrusted",
    sandboxMode: "read-only",
    networkEnabled: false,
  },
  {
    name: "standard",
    label: "Standard",
    labelZh: "标准模式",
    description: "Write within workspace, asks for dangerous ops. Default.",
    descriptionZh: "工作区内可写，危险操作需确认。默认模式。",
    approvalMode: "on-request",
    sandboxMode: "workspace-write",
    networkEnabled: false,
  },
  {
    name: "full-auto",
    label: "Full Auto",
    labelZh: "全自动模式",
    description: "Write within workspace, no approval prompts. Network still off.",
    descriptionZh: "工作区内可写，无需确认。网络默认关闭。",
    approvalMode: "never",
    sandboxMode: "workspace-write",
    networkEnabled: false,
  },
  {
    name: "unrestricted",
    label: "Unrestricted (Danger)",
    labelZh: "无限制模式（危险）",
    description: "Full access, no prompts, network on. Use at your own risk.",
    descriptionZh: "完全访问，无确认，网络开启。风险自担。",
    approvalMode: "never",
    sandboxMode: "full-access",
    networkEnabled: true,
  },
];

// ═══════════ Protected paths (always read-only) ═══════════

const ALWAYS_PROTECTED: string[] = [
  ".git",
  ".git/",
  ".agents",
  ".agents/",
  ".claude",
  ".claude/",
  ".env",
  ".env.local",
  ".env.production",
  "node_modules/.package-lock.json",
];

const PROTECTED_EXTENSIONS = [
  ".pem", ".key", ".p12", ".pfx", ".jks",
];

// ═══════════ Storage ═══════════

const STORAGE_KEY = "security-policy";

function loadPolicy(): SecurityPolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        approvalMode: parsed.approvalMode || "on-request",
        sandboxMode: parsed.sandboxMode || "workspace-write",
        networkEnabled: parsed.networkEnabled ?? false,
        protectedPaths: [...ALWAYS_PROTECTED, ...(parsed.protectedPaths || [])],
        allowedWritePaths: parsed.allowedWritePaths || [],
      };
    }
  } catch { /* corrupt */ }
  return getDefaultPolicy();
}

function getDefaultPolicy(): SecurityPolicy {
  return {
    approvalMode: "on-request",
    sandboxMode: "workspace-write",
    networkEnabled: false,
    protectedPaths: [...ALWAYS_PROTECTED],
    allowedWritePaths: [],
  };
}

function savePolicy(policy: SecurityPolicy): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
  } catch { /* quota */ }
}

// ═══════════ Public API ═══════════

let _cached: SecurityPolicy | null = null;

export function getPolicy(): SecurityPolicy {
  if (!_cached) _cached = loadPolicy();
  return _cached;
}

export function setPolicy(partial: Partial<SecurityPolicy>): SecurityPolicy {
  const current = getPolicy();
  const updated: SecurityPolicy = {
    ...current,
    ...partial,
    protectedPaths: [...new Set([...ALWAYS_PROTECTED, ...(partial.protectedPaths || current.protectedPaths)])],
  };
  _cached = updated;
  savePolicy(updated);
  audit("config_change", "user", "security-policy", JSON.stringify(partial));
  return updated;
}

export function applyPreset(presetName: string): SecurityPolicy {
  const preset = POLICY_PRESETS.find(p => p.name === presetName);
  if (!preset) throw new Error(`Unknown preset: ${presetName}`);
  return setPolicy({
    approvalMode: preset.approvalMode,
    sandboxMode: preset.sandboxMode,
    networkEnabled: preset.networkEnabled,
  });
}

// ═══════════ Enforcement checks ═══════════

export type ActionVerdict = "allow" | "deny" | "ask";

export interface VerdictResult {
  verdict: ActionVerdict;
  reason?: string;
}

export function checkToolAllowed(toolName: string, args: Record<string, unknown>): VerdictResult {
  const policy = getPolicy();

  // Network tools gating
  if (isNetworkTool(toolName) && !policy.networkEnabled) {
    if (policy.approvalMode === "never") {
      return { verdict: "deny", reason: "Network disabled in current policy" };
    }
    return { verdict: "ask", reason: "Network access is off. Allow this tool?" };
  }

  // Read-only sandbox blocks all writes
  if (policy.sandboxMode === "read-only") {
    if (isWriteTool(toolName)) {
      return { verdict: "deny", reason: "Read-only mode: writes are blocked" };
    }
    if (isProcessTool(toolName)) {
      return { verdict: "deny", reason: "Read-only mode: command execution is blocked" };
    }
  }

  // Protected path check for file operations
  if (isFileTool(toolName) && typeof args.path === "string") {
    if (isProtectedPath(args.path, policy.protectedPaths)) {
      if (isWriteTool(toolName)) {
        return { verdict: "deny", reason: `Protected path: ${args.path}` };
      }
    }
  }

  // Workspace-write: writes outside workDir need approval
  if (policy.sandboxMode === "workspace-write" && isWriteTool(toolName)) {
    if (typeof args.path === "string") {
      const workDir = getWorkDir();
      if (workDir && !isWithinDir(args.path, workDir)) {
        if (policy.approvalMode === "never") {
          return { verdict: "deny", reason: `Outside workspace: ${args.path}` };
        }
        return { verdict: "ask", reason: `Write outside workspace: ${args.path}` };
      }
    }
  }

  // Untrusted mode: ask for any mutation
  if (policy.approvalMode === "untrusted") {
    if (isWriteTool(toolName) || isProcessTool(toolName)) {
      return { verdict: "ask", reason: `Untrusted mode: confirm ${toolName}?` };
    }
  }

  return { verdict: "allow" };
}

export function checkPathProtected(filePath: string): boolean {
  const policy = getPolicy();
  return isProtectedPath(filePath, policy.protectedPaths);
}

// ═══════════ Classification helpers ═══════════

const NETWORK_TOOLS = new Set(["web_search", "web_fetch", "browser_open"]);
const WRITE_TOOLS = new Set(["file_write", "file_edit", "notebook_edit"]);
const PROCESS_TOOLS = new Set(["bash"]);
const FILE_TOOLS = new Set(["file_read", "file_write", "file_edit", "glob", "grep", "list_dir"]);

function isNetworkTool(name: string): boolean { return NETWORK_TOOLS.has(name); }
function isWriteTool(name: string): boolean { return WRITE_TOOLS.has(name); }
function isProcessTool(name: string): boolean { return PROCESS_TOOLS.has(name); }
function isFileTool(name: string): boolean { return FILE_TOOLS.has(name); }

function isProtectedPath(filePath: string, protectedPaths: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pp of protectedPaths) {
    if (normalized === pp || normalized.startsWith(pp) || normalized.endsWith(`/${pp}`)) return true;
    if (normalized.includes(`/${pp}/`)) return true;
  }
  for (const ext of PROTECTED_EXTENSIONS) {
    if (normalized.endsWith(ext)) return true;
  }
  return false;
}

function isWithinDir(filePath: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(filePath).startsWith(norm(dir));
}

function getWorkDir(): string | null {
  try {
    const raw = localStorage.getItem("agent-config");
    if (!raw) return null;
    return JSON.parse(raw).workDir || null;
  } catch { return null; }
}
