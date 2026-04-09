/**
 * Hook System — Extension points for agent lifecycle events
 * Aligned with ref-s08: event-based hooks with priority execution.
 */

// ═══════════ Types ═══════════

export type HookEvent =
  | "before_tool"
  | "after_tool"
  | "before_send"
  | "after_send"
  | "on_error";

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  message?: string;
  error?: string;
  timestamp: number;
}

export interface HookResult {
  blocked: boolean;
  reason?: string;
  modifiedInput?: Record<string, unknown>;
}

export type HookCallback = (ctx: HookContext) => HookResult | Promise<HookResult>;

interface HookRegistration {
  id: string;
  event: HookEvent;
  callback: HookCallback;
  priority: number;  // lower = runs first
  description: string;
}

// ═══════════ Registry ═══════════

const hooks: HookRegistration[] = [];
let hookIdCounter = 0;

export function registerHook(
  event: HookEvent,
  callback: HookCallback,
  options?: { priority?: number; description?: string },
): string {
  const id = `hook_${++hookIdCounter}`;
  hooks.push({
    id,
    event,
    callback,
    priority: options?.priority ?? 100,
    description: options?.description ?? "",
  });
  // Sort by priority after registration
  hooks.sort((a, b) => a.priority - b.priority);
  return id;
}

export function unregisterHook(id: string): boolean {
  const idx = hooks.findIndex(h => h.id === id);
  if (idx >= 0) {
    hooks.splice(idx, 1);
    return true;
  }
  return false;
}

export function listHooks(): Array<{ id: string; event: HookEvent; priority: number; description: string }> {
  return hooks.map(h => ({
    id: h.id,
    event: h.event,
    priority: h.priority,
    description: h.description,
  }));
}

// ═══════════ Execution ═══════════

/**
 * Execute all hooks for a given event, in priority order.
 * If any hook blocks, execution stops and returns blocked=true.
 */
export async function executeHooks(event: HookEvent, data: Partial<HookContext>): Promise<HookResult> {
  const ctx: HookContext = {
    event,
    timestamp: Date.now(),
    ...data,
  };

  const eventHooks = hooks.filter(h => h.event === event);

  for (const hook of eventHooks) {
    try {
      const result = await hook.callback(ctx);
      if (result.blocked) {
        return result;
      }
      // Allow hooks to modify input
      if (result.modifiedInput && ctx.toolInput) {
        ctx.toolInput = result.modifiedInput;
      }
    } catch (err) {
      console.warn(`Hook ${hook.id} (${hook.description}) failed:`, err);
      // Hooks should not crash the system
    }
  }

  return { blocked: false };
}

// ═══════════ Built-in Hooks ═══════════

/** Logging hook — records all tool calls to console */
registerHook("before_tool", (ctx) => {
  console.log(`[hook:log] Tool call: ${ctx.toolName}`, ctx.toolInput);
  return { blocked: false };
}, { priority: 1, description: "日志记录" });

registerHook("after_tool", (ctx) => {
  const preview = ctx.toolOutput?.slice(0, 100) || "";
  console.log(`[hook:log] Tool result: ${ctx.toolName} → ${preview}`);
  return { blocked: false };
}, { priority: 1, description: "日志记录" });

/** Sensitive command interception — blocks dangerous bash commands */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,          // rm -rf /
  /mkfs/,                    // format filesystem
  /dd\s+if=.*of=\/dev/,     // dd to device
  />\s*\/dev\/sd[a-z]/,     // write to disk device
  /chmod\s+-R\s+777\s+\//,  // dangerous permissions on root
];

registerHook("before_tool", (ctx) => {
  if (ctx.toolName === "bash" && typeof ctx.toolInput?.command === "string") {
    const cmd = ctx.toolInput.command;
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          blocked: true,
          reason: `敏感命令被拦截: ${cmd.slice(0, 60)}`,
        };
      }
    }
  }
  return { blocked: false };
}, { priority: 10, description: "敏感命令拦截" });

/** Error logging hook */
registerHook("on_error", (ctx) => {
  console.error(`[hook:error] ${ctx.error}`);
  return { blocked: false };
}, { priority: 1, description: "错误记录" });
