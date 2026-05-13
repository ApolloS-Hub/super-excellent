/**
 * Remote Bridge — Pluggable IM Adapter Architecture
 *
 * Aligned with cc-haha's 4-layer IM model:
 *   1. Configuration Layer — adapters.json manages platform credentials
 *   2. Storage Layer — session mapping persists across restarts
 *   3. Adapter Layer — platform-specific polling/webhook + message formatting
 *   4. Session Layer — bridges IM messages to AI secretary conversations
 *
 * Currently ships with LarkAdapter. Adding new platforms (Telegram,
 * DingTalk, WeChat) means implementing the IMAdapter interface and
 * registering in ADAPTER_REGISTRY.
 */
import { sendMessage, loadConfig } from "./agent-bridge";
import { emitAgentEvent } from "./event-bus";

// ═══════════ Pluggable Adapter Interface ═══════════

export interface InboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  platform: string;
}

export interface IMAdapter {
  readonly platform: string;
  isConfigured(): boolean;
  start(onMessage: (msg: InboundMessage) => void): void;
  stop(): void;
  isRunning(): boolean;
  sendResponse(chatId: string, text: string): Promise<void>;
}

// ═══════════ Bridge Config ═══════════

export interface RemoteBridgeConfig {
  enabled: boolean;
  platform: string;           // "lark" | "telegram" | "dingtalk" | "wechat"
  allowedChatIds: string[];
  pollIntervalMs: number;
  maxMessageLength: number;
}

const DEFAULT_BRIDGE_CONFIG: RemoteBridgeConfig = {
  enabled: false,
  platform: "lark",
  allowedChatIds: [],
  pollIntervalMs: 3000,
  maxMessageLength: 4000,
};

let _bridgeConfig: RemoteBridgeConfig = { ...DEFAULT_BRIDGE_CONFIG };

export function getBridgeConfig(): RemoteBridgeConfig {
  return { ..._bridgeConfig };
}

export function setBridgeConfig(partial: Partial<RemoteBridgeConfig>): void {
  _bridgeConfig = { ..._bridgeConfig, ...partial };
  try {
    localStorage.setItem("remote-bridge-config", JSON.stringify(_bridgeConfig));
  } catch (e) {
    console.warn("remote-bridge: failed to persist config", e);
  }
}

export function loadBridgeConfig(): RemoteBridgeConfig {
  try {
    const raw = localStorage.getItem("remote-bridge-config");
    if (raw) _bridgeConfig = { ...DEFAULT_BRIDGE_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    console.warn("remote-bridge: failed to parse stored config", e);
  }
  return { ..._bridgeConfig };
}

// ═══════════ Lark Adapter ═══════════

class LarkAdapter implements IMAdapter {
  readonly platform = "lark";
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageId = "";

  isConfigured(): boolean {
    try {
      const { isLarkConfigured } = require("./lark-integration") as typeof import("./lark-integration");
      return isLarkConfigured();
    } catch { return false; }
  }

  isRunning(): boolean { return this.running; }

  start(onMessage: (msg: InboundMessage) => void): void {
    if (this.running) return;
    this.running = true;
    emitAgentEvent({ type: "worker_activate", worker: "remote_bridge", text: `Lark Remote Bridge started` });

    this.pollTimer = setInterval(async () => {
      try {
        const lark = require("./lark-client") as typeof import("./lark-client");
        const data = await lark.imListMessages(
          _bridgeConfig.allowedChatIds[0] || "", 10,
        ) as { items?: Array<Record<string, unknown>> };

        for (const item of data?.items || []) {
          const msgId = String(item.message_id || "");
          if (!msgId || msgId === this.lastMessageId) continue;
          const chatId = String(item.chat_id || "");
          if (_bridgeConfig.allowedChatIds.length > 0 && !_bridgeConfig.allowedChatIds.includes(chatId)) continue;
          this.lastMessageId = msgId;
          onMessage({
            messageId: msgId, chatId,
            senderId: String((item.sender as Record<string, unknown>)?.sender_id || ""),
            senderName: String((item.sender as Record<string, unknown>)?.sender_id || "Unknown"),
            text: this.extractText(item),
            timestamp: item.create_time ? Number(item.create_time) : Date.now(),
            platform: "lark",
          });
        }
      } catch { /* polling error — retry next interval */ }
    }, _bridgeConfig.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    emitAgentEvent({ type: "worker_complete", worker: "remote_bridge", text: "Lark Remote Bridge stopped" });
  }

  async sendResponse(chatId: string, text: string): Promise<void> {
    const lark = require("./lark-client") as typeof import("./lark-client");
    const chunks = this.chunkText(text, _bridgeConfig.maxMessageLength);
    for (const chunk of chunks) await lark.imSendMessage(chatId, chunk);
  }

  private extractText(item: Record<string, unknown>): string {
    const body = item.body as Record<string, unknown> | undefined;
    if (body?.content) {
      try { return JSON.parse(String(body.content)).text || String(body.content); }
      catch { return String(body.content); }
    }
    return item.text as string || "";
  }

  private chunkText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) { chunks.push(remaining); break; }
      let breakIdx = remaining.lastIndexOf("\n", maxLen);
      if (breakIdx < maxLen * 0.5) breakIdx = maxLen;
      chunks.push(remaining.slice(0, breakIdx));
      remaining = remaining.slice(breakIdx).trimStart();
    }
    return chunks;
  }
}

// ═══════════ Adapter Registry ═══════════

const ADAPTER_REGISTRY: Record<string, () => IMAdapter> = {
  lark: () => new LarkAdapter(),
  // Future: telegram, dingtalk, wechat adapters register here
};

export function getAvailablePlatforms(): string[] {
  return Object.keys(ADAPTER_REGISTRY);
}

export function createAdapter(platform: string): IMAdapter | null {
  const factory = ADAPTER_REGISTRY[platform];
  return factory ? factory() : null;
}

// ═══════════ Message Router ═══════════

export interface BridgeSession {
  chatId: string;
  platform: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  lastActivity: number;
}

class MessageRouter {
  private sessions = new Map<string, BridgeSession>();

  getOrCreateSession(chatId: string, platform: string): BridgeSession {
    const key = `${platform}:${chatId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = { chatId, platform, history: [], lastActivity: Date.now() };
      this.sessions.set(key, session);
    }
    session.lastActivity = Date.now();
    return session;
  }

  addMessage(chatId: string, platform: string, role: "user" | "assistant", content: string): void {
    const session = this.getOrCreateSession(chatId, platform);
    session.history.push({ role, content });
    if (session.history.length > 20) session.history = session.history.slice(-20);
  }

  getHistory(chatId: string, platform: string): Array<{ role: "user" | "assistant"; content: string }> {
    return this.sessions.get(`${platform}:${chatId}`)?.history || [];
  }

  getAllSessions(): BridgeSession[] {
    return Array.from(this.sessions.values());
  }

  cleanup(): void {
    const cutoff = Date.now() - 3600_000;
    for (const [key, session] of this.sessions) {
      if (session.lastActivity < cutoff) this.sessions.delete(key);
    }
  }
}

// ═══════════ Bridge Manager ═══════════

class BridgeManager {
  private adapter: IMAdapter | null = null;
  private router: MessageRouter;
  private processing = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.router = new MessageRouter();
  }

  isRunning(): boolean {
    return this.adapter?.isRunning() ?? false;
  }

  currentPlatform(): string | null {
    return this.adapter?.platform ?? null;
  }

  start(platform?: string): void {
    const p = platform || _bridgeConfig.platform;
    const adapter = createAdapter(p);
    if (!adapter) {
      emitAgentEvent({ type: "error", text: `Remote Bridge: unknown platform "${p}". Available: ${getAvailablePlatforms().join(", ")}` });
      return;
    }
    if (!adapter.isConfigured()) {
      emitAgentEvent({ type: "error", text: `Remote Bridge: ${p} not configured` });
      return;
    }
    if (this.adapter?.isRunning()) this.adapter.stop();
    this.adapter = adapter;
    adapter.start((msg) => this.handleInbound(msg));
    this.cleanupTimer = setInterval(() => this.router.cleanup(), 300_000);
  }

  stop(): void {
    this.adapter?.stop();
    this.adapter = null;
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
  }

  getSessions(): BridgeSession[] {
    return this.router.getAllSessions();
  }

  private async handleInbound(msg: InboundMessage): Promise<void> {
    const { chatId, text, senderName, platform } = msg;
    if (!text.trim()) return;
    if (this.processing.has(msg.messageId)) return;
    this.processing.add(msg.messageId);

    emitAgentEvent({
      type: "user_message",
      text: `[${platform} ${senderName}] ${text.slice(0, 60)}`,
      worker: "remote_bridge",
    });

    this.router.addMessage(chatId, platform, "user", text);

    try {
      const config = loadConfig();
      const history = this.router.getHistory(chatId, platform).slice(0, -1);
      let responseText = "";
      await sendMessage(text, config, (event) => {
        if (event.type === "text") responseText += event.text || "";
        else if (event.type === "result") responseText = event.text || responseText;
      }, history);

      if (responseText && this.adapter) {
        this.router.addMessage(chatId, platform, "assistant", responseText);
        await this.adapter.sendResponse(chatId, responseText);
        emitAgentEvent({ type: "result", text: `[${platform} reply] ${responseText.slice(0, 60)}`, worker: "remote_bridge" });
      }
    } catch (err) {
      const errMsg = `Failed to process message: ${err instanceof Error ? err.message : String(err)}`;
      emitAgentEvent({ type: "error", text: errMsg, worker: "remote_bridge" });
      if (this.adapter) {
        await this.adapter.sendResponse(chatId, errMsg).catch(e => {
          emitAgentEvent({ type: "error", text: `${platform} sendResponse failed: ${e instanceof Error ? e.message : String(e)}`, worker: "remote_bridge" });
        });
      }
    } finally {
      this.processing.delete(msg.messageId);
    }
  }
}

// ═══════════ Singleton ═══════════

let _bridgeManager: BridgeManager | null = null;

export function getBridgeManager(): BridgeManager {
  if (!_bridgeManager) _bridgeManager = new BridgeManager();
  return _bridgeManager;
}

export function startRemoteBridge(): void {
  loadBridgeConfig();
  if (_bridgeConfig.enabled) getBridgeManager().start();
}

export function stopRemoteBridge(): void {
  getBridgeManager().stop();
}

export function isRemoteBridgeRunning(): boolean {
  return _bridgeManager?.isRunning() ?? false;
}
