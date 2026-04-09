/**
 * MessageBus — 内存邮箱系统，Agent 团队成员间的通信管道
 *
 * 对齐 ref-s15 Agent Teams 的 JSONL inbox 设计，
 * 但使用内存 Map 而非文件系统（桌面应用无需持久化邮箱）。
 *
 * 用法：
 *   bus.send("lead", "alice", "请帮我审查代码", "message")
 *   bus.readInbox("alice")  // → [{ from, to, content, type, timestamp }]
 *   bus.broadcast("lead", "全体注意", true)
 */

export type MessageType =
  | "message"
  | "broadcast"
  | "task_assign"
  | "task_result"
  | "status_update";

export interface BusMessage {
  from: string;
  to: string;
  content: string;
  type: MessageType;
  timestamp: number;
}

export class MessageBus {
  private inboxes = new Map<string, BusMessage[]>();

  /** 发送消息到指定成员的邮箱 */
  send(from: string, to: string, content: string, type: MessageType = "message"): void {
    const msg: BusMessage = {
      from,
      to,
      content,
      type,
      timestamp: Date.now(),
    };
    const inbox = this.inboxes.get(to) || [];
    inbox.push(msg);
    this.inboxes.set(to, inbox);
  }

  /** 读取并清空指定成员的邮箱 */
  readInbox(name: string): BusMessage[] {
    const inbox = this.inboxes.get(name) || [];
    this.inboxes.set(name, []);
    return inbox;
  }

  /** 查看邮箱但不清空 */
  peekInbox(name: string): BusMessage[] {
    return [...(this.inboxes.get(name) || [])];
  }

  /** 广播消息给所有成员（可排除发送者自身） */
  broadcast(from: string, content: string, excludeSelf = true): void {
    for (const [name] of this.inboxes) {
      if (excludeSelf && name === from) continue;
      this.send(from, name, content, "broadcast");
    }
  }

  /** 注册一个邮箱（确保该成员可被发送消息） */
  register(name: string): void {
    if (!this.inboxes.has(name)) {
      this.inboxes.set(name, []);
    }
  }

  /** 获取所有已注册的邮箱名 */
  getRegisteredNames(): string[] {
    return Array.from(this.inboxes.keys());
  }

  /** 清空所有邮箱 */
  clear(): void {
    this.inboxes.clear();
  }
}

/** 全局单例 */
export const messageBus = new MessageBus();
