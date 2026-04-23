/**
 * Remote Bridge — Lark remote control
 * Allows controlling the AI assistant via Lark messages.
 *
 * Architecture:
 *   BridgeManager → LarkAdapter → MessageRouter → Agent → Response
 */
import * as lark from "./lark-client";
import { isLarkConfigured } from "./lark-integration";
import { sendMessage, loadConfig } from "./agent-bridge";
import { emitAgentEvent } from "./event-bus";

// ═══════════ Types ═══════════

export interface RemoteBridgeConfig {
  enabled: boolean;
  allowedChatIds: string[];
  pollIntervalMs: number;
  maxMessageLength: number;
}

export interface InboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface BridgeSession {
  chatId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  lastActivity: number;
}

// ═══════════ Config ═══════════

const DEFAULT_BRIDGE_CONFIG: RemoteBridgeConfig = {
  enabled: false,
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

class LarkAdapter {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageId = "";

  isRunning(): boolean {
    return this.running;
  }

  start(onMessage: (msg: InboundMessage) => void): void {
    if (this.running) return;
    this.running = true;

    emitAgentEvent({ type: "worker_activate", worker: "remote_bridge", text: "Lark Remote Bridge started" });

    this.pollTimer = setInterval(async () => {
      try {
        const data = await lark.imListMessages(
          _bridgeConfig.allowedChatIds[0] || "",
          10,
        ) as { items?: Array<Record<string, unknown>> };

        const items = data?.items || [];
        for (const item of items) {
          const msgId = String(item.message_id || "");
          if (!msgId || msgId === this.lastMessageId) continue;

          const chatId = String(item.chat_id || "");
          if (_bridgeConfig.allowedChatIds.length > 0 &&
              !_bridgeConfig.allowedChatIds.includes(chatId)) continue;

          this.lastMessageId = msgId;
          onMessage({
            messageId: msgId,
            chatId,
            senderId: String((item.sender as Record<string, unknown>)?.sender_id || ""),
            senderName: String((item.sender as Record<string, unknown>)?.sender_id || "Unknown"),
            text: this.extractText(item),
            timestamp: item.create_time ? Number(item.create_time) : Date.now(),
          });
        }
      } catch {
        // Polling error — silently retry next interval
      }
    }, _bridgeConfig.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    emitAgentEvent({ type: "worker_complete", worker: "remote_bridge", text: "Lark Remote Bridge stopped" });
  }

  async sendResponse(chatId: string, text: string): Promise<void> {
    const chunks = this.chunkText(text, _bridgeConfig.maxMessageLength);
    for (const chunk of chunks) {
      await lark.imSendMessage(chatId, chunk);
    }
  }

  private extractText(item: Record<string, unknown>): string {
    const body = item.body as Record<string, unknown> | undefined;
    if (body?.content) {
      try {
        const content = JSON.parse(String(body.content));
        return content.text || String(body.content);
      } catch {
        return String(body.content);
      }
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

// ═══════════ Message Router ═══════════

class MessageRouter {
  private sessions = new Map<string, BridgeSession>();

  getOrCreateSession(chatId: string): BridgeSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = { chatId, history: [], lastActivity: Date.now() };
      this.sessions.set(chatId, session);
    }
    session.lastActivity = Date.now();
    return session;
  }

  addMessage(chatId: string, role: "user" | "assistant", content: string): void {
    const session = this.getOrCreateSession(chatId);
    session.history.push({ role, content });
    if (session.history.length > 20) session.history = session.history.slice(-20);
  }

  getHistory(chatId: string): Array<{ role: "user" | "assistant"; content: string }> {
    return this.sessions.get(chatId)?.history || [];
  }

  clearSession(chatId: string): void {
    this.sessions.delete(chatId);
  }

  getAllSessions(): BridgeSession[] {
    return Array.from(this.sessions.values());
  }

  cleanup(): void {
    const cutoff = Date.now() - 3600_000;
    for (const [chatId, session] of this.sessions) {
      if (session.lastActivity < cutoff) this.sessions.delete(chatId);
    }
  }
}

// ═══════════ Bridge Manager ═══════════

class BridgeManager {
  private adapter: LarkAdapter;
  private router: MessageRouter;
  private processing = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.adapter = new LarkAdapter();
    this.router = new MessageRouter();
  }

  isRunning(): boolean {
    return this.adapter.isRunning();
  }

  start(): void {
    if (!isLarkConfigured()) {
      emitAgentEvent({ type: "error", text: "Remote Bridge: Lark not configured" });
      return;
    }
    if (this.adapter.isRunning()) return;

    this.adapter.start((msg) => this.handleInbound(msg));
    this.cleanupTimer = setInterval(() => this.router.cleanup(), 300_000);
  }

  stop(): void {
    this.adapter.stop();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  getSessions(): BridgeSession[] {
    return this.router.getAllSessions();
  }

  private async handleInbound(msg: InboundMessage): Promise<void> {
    const { chatId, text, senderName } = msg;
    if (!text.trim()) return;
    if (this.processing.has(msg.messageId)) return;
    this.processing.add(msg.messageId);

    emitAgentEvent({
      type: "user_message",
      text: `[Lark ${senderName}] ${text.slice(0, 60)}`,
      worker: "remote_bridge",
    });

    this.router.addMessage(chatId, "user", text);

    try {
      const config = loadConfig();
      const history = this.router.getHistory(chatId).slice(0, -1);

      let responseText = "";
      await sendMessage(text, config, (event) => {
        if (event.type === "text") responseText += event.text || "";
        else if (event.type === "result") responseText = event.text || responseText;
      }, history);

      if (responseText) {
        this.router.addMessage(chatId, "assistant", responseText);
        await this.adapter.sendResponse(chatId, responseText);
        emitAgentEvent({
          type: "result",
          text: `[Lark reply] ${responseText.slice(0, 60)}`,
          worker: "remote_bridge",
        });
      }
    } catch (err) {
      const errMsg = `Failed to process message: ${err instanceof Error ? err.message : String(err)}`;
      emitAgentEvent({ type: "error", text: errMsg, worker: "remote_bridge" });
      await this.adapter.sendResponse(chatId, errMsg).catch(e => {
        emitAgentEvent({ type: "error", text: `Lark sendResponse failed: ${e instanceof Error ? e.message : String(e)}`, worker: "remote_bridge" });
      });
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
