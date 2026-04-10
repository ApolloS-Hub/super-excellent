/**
 * Remote Bridge — 飞书远程控制
 * Inspired by CodePilot's bridge architecture
 * Allows controlling the AI assistant via Feishu/Lark messages
 *
 * Architecture:
 *   BridgeManager → ChannelAdapter (Feishu) → MessageRouter → Agent → Response
 */
import { LarkCLI, isLarkConfigured } from "./lark-integration";
import { sendMessage, loadConfig } from "./agent-bridge";
import { emitAgentEvent } from "./event-bus";

// ═══════════ Types ═══════════

export interface RemoteBridgeConfig {
  enabled: boolean;
  allowedChatIds: string[];   // restrict to specific chats (empty = all)
  pollIntervalMs: number;     // polling interval (default 3000ms)
  maxMessageLength: number;   // max response length per chunk
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
  try { localStorage.setItem("remote-bridge-config", JSON.stringify(_bridgeConfig)); } catch {}
}

export function loadBridgeConfig(): RemoteBridgeConfig {
  try {
    const raw = localStorage.getItem("remote-bridge-config");
    if (raw) _bridgeConfig = { ...DEFAULT_BRIDGE_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ..._bridgeConfig };
}

// ═══════════ Channel Adapter ═══════════

/**
 * FeishuAdapter — polls for new messages via lark-cli event subscribe
 * Uses long-polling pattern: periodically checks for new messages
 */
class FeishuAdapter {
  private cli: LarkCLI;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageId = "";

  constructor() {
    this.cli = new LarkCLI();
  }

  isRunning(): boolean {
    return this.running;
  }

  start(onMessage: (msg: InboundMessage) => void): void {
    if (this.running) return;
    this.running = true;

    emitAgentEvent({ type: "worker_activate", worker: "remote_bridge", text: "飞书远程控制已启动" });

    this.pollTimer = setInterval(async () => {
      try {
        const result = await this.cli.execute([
          "im", "+messages-receive",
          "--after", this.lastMessageId || "0",
          "--limit", "10",
        ]);

        // Parse messages from CLI output
        const messages = this.parseMessages(result);
        for (const msg of messages) {
          // Skip if already processed
          if (msg.messageId === this.lastMessageId) continue;

          // Check allowed chats
          if (_bridgeConfig.allowedChatIds.length > 0 &&
              !_bridgeConfig.allowedChatIds.includes(msg.chatId)) continue;

          this.lastMessageId = msg.messageId;
          onMessage(msg);
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
    emitAgentEvent({ type: "worker_complete", worker: "remote_bridge", text: "飞书远程控制已停止" });
  }

  async sendResponse(chatId: string, text: string): Promise<void> {
    // Chunk long messages to respect platform limits
    const chunks = this.chunkText(text, _bridgeConfig.maxMessageLength);
    for (const chunk of chunks) {
      await this.cli.execute([
        "im", "+messages-send",
        "--chat-id", chatId,
        "--msg-type", "text",
        "--text", chunk,
      ]);
    }
  }

  private parseMessages(output: string): InboundMessage[] {
    const messages: InboundMessage[] = [];
    try {
      // Try JSON parse first
      const data = JSON.parse(output);
      const items = Array.isArray(data) ? data : data.items || data.data?.items || [];
      for (const item of items) {
        messages.push({
          messageId: item.message_id || item.messageId || String(Date.now()),
          chatId: item.chat_id || item.chatId || "",
          senderId: item.sender?.sender_id?.open_id || item.senderId || "",
          senderName: item.sender?.sender_id?.name || item.senderName || "Unknown",
          text: this.extractText(item),
          timestamp: item.create_time ? Number(item.create_time) : Date.now(),
        });
      }
    } catch {
      // Non-JSON output — skip
    }
    return messages;
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
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to break at newline
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
    // Keep last 20 messages for context
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }
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

  /** Clean up stale sessions older than 1 hour */
  cleanup(): void {
    const cutoff = Date.now() - 3600_000;
    for (const [chatId, session] of this.sessions) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(chatId);
      }
    }
  }
}

// ═══════════ Bridge Manager ═══════════

class BridgeManager {
  private adapter: FeishuAdapter;
  private router: MessageRouter;
  private processing = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.adapter = new FeishuAdapter();
    this.router = new MessageRouter();
  }

  isRunning(): boolean {
    return this.adapter.isRunning();
  }

  start(): void {
    if (!isLarkConfigured()) {
      emitAgentEvent({ type: "error", text: "Remote Bridge: 飞书未配置" });
      return;
    }
    if (this.adapter.isRunning()) return;

    this.adapter.start((msg) => this.handleInbound(msg));

    // Periodic session cleanup
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

    // Skip empty messages
    if (!text.trim()) return;

    // Avoid processing duplicate messages concurrently
    if (this.processing.has(msg.messageId)) return;
    this.processing.add(msg.messageId);

    emitAgentEvent({
      type: "user_message",
      text: `[飞书 ${senderName}] ${text.slice(0, 60)}`,
      worker: "remote_bridge",
    });

    // Record user message
    this.router.addMessage(chatId, "user", text);

    try {
      // Process through Agent
      const config = loadConfig();
      const history = this.router.getHistory(chatId).slice(0, -1); // exclude current

      let responseText = "";
      await sendMessage(text, config, (event) => {
        if (event.type === "text") {
          responseText += event.text || "";
        } else if (event.type === "result") {
          responseText = event.text || responseText;
        }
      }, history);

      if (responseText) {
        // Record assistant response
        this.router.addMessage(chatId, "assistant", responseText);

        // Send back to Feishu
        await this.adapter.sendResponse(chatId, responseText);

        emitAgentEvent({
          type: "result",
          text: `[飞书回复] ${responseText.slice(0, 60)}`,
          worker: "remote_bridge",
        });
      }
    } catch (err) {
      const errMsg = `处理消息失败: ${err instanceof Error ? err.message : String(err)}`;
      emitAgentEvent({ type: "error", text: errMsg, worker: "remote_bridge" });

      // Send error message back
      await this.adapter.sendResponse(chatId, `❌ ${errMsg}`).catch(() => {});
    } finally {
      this.processing.delete(msg.messageId);
    }
  }
}

// ═══════════ Singleton ═══════════

let _bridgeManager: BridgeManager | null = null;

export function getBridgeManager(): BridgeManager {
  if (!_bridgeManager) {
    _bridgeManager = new BridgeManager();
  }
  return _bridgeManager;
}

export function startRemoteBridge(): void {
  loadBridgeConfig();
  if (_bridgeConfig.enabled) {
    getBridgeManager().start();
  }
}

export function stopRemoteBridge(): void {
  getBridgeManager().stop();
}

export function isRemoteBridgeRunning(): boolean {
  return _bridgeManager?.isRunning() ?? false;
}
