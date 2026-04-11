/**
 * Chat Flow E2E Tests
 *
 * Tests the core conversation management logic:
 * - Creating, listing, deleting, and renaming conversations
 * - Message sending flow (via mock agent bridge)
 * - Title auto-generation from first user message
 * - Conversation update ordering
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createConversation,
  deleteConversation,
  renameConversation,
  updateConversation,
  generateTitle,
  generateId,
  relativeTime,
} from "../../lib/conversations";
import type { Conversation } from "../../lib/conversations";
import type { ChatMessage } from "../../lib/agent-bridge";

// Mock the session-store module (IndexedDB persistence)
vi.mock("../../lib/session-store", () => ({
  loadAllConversations: vi.fn(() => Promise.resolve([])),
  saveConversation: vi.fn(() => Promise.resolve(undefined)),
  deleteConversationDB: vi.fn(() => Promise.resolve(undefined)),
  migrateFromLocalStorage: vi.fn(() => Promise.resolve(undefined)),
}));

// ═══════════ Helpers ═══════════

function makeChatMessage(role: "user" | "assistant", content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    timestamp: new Date(),
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: overrides.id ?? generateId(),
    title: overrides.title ?? "New Conversation",
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    messages: overrides.messages ?? [],
  };
}

// ═══════════ Tests ═══════════

describe("Chat Flow — Conversation Management", () => {
  let conversations: Conversation[];

  beforeEach(() => {
    conversations = [];
  });

  describe("createConversation", () => {
    it("creates a conversation with valid structure", () => {
      const conv = createConversation();

      expect(conv).toBeDefined();
      expect(conv.id).toMatch(/^conv_\d+_[a-z0-9]+$/);
      expect(conv.title).toBe("\u65b0\u5bf9\u8bdd"); // "新对话"
      expect(conv.messages).toEqual([]);
      expect(conv.createdAt).toBeGreaterThan(0);
      expect(conv.updatedAt).toBeGreaterThan(0);
    });

    it("generates unique IDs for each conversation", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(createConversation().id);
      }
      expect(ids.size).toBe(50);
    });

    it("can be added to a conversation list", () => {
      const conv = createConversation();
      conversations.push(conv);

      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).toBe(conv.id);
    });
  });

  describe("conversation list rendering", () => {
    it("maintains conversations in an array", () => {
      const conv1 = makeConversation({ title: "First" });
      const conv2 = makeConversation({ title: "Second" });
      const conv3 = makeConversation({ title: "Third" });

      conversations = [conv1, conv2, conv3];

      expect(conversations).toHaveLength(3);
      expect(conversations.map(c => c.title)).toEqual(["First", "Second", "Third"]);
    });

    it("filters conversations by search query", () => {
      conversations = [
        makeConversation({ title: "React hooks guide" }),
        makeConversation({ title: "TypeScript generics" }),
        makeConversation({ title: "React state management" }),
      ];

      const query = "react";
      const filtered = conversations.filter(c =>
        c.title.toLowerCase().includes(query.toLowerCase()),
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.title.toLowerCase().includes("react"))).toBe(true);
    });
  });

  describe("deleteConversation", () => {
    it("removes the specified conversation from the list", () => {
      const conv1 = makeConversation({ title: "Keep" });
      const conv2 = makeConversation({ title: "Delete" });
      conversations = [conv1, conv2];

      const result = deleteConversation(conversations, conv2.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(conv1.id);
    });

    it("returns unchanged list when ID does not exist", () => {
      conversations = [makeConversation({ title: "Only" })];

      const result = deleteConversation(conversations, "nonexistent_id");

      expect(result).toHaveLength(1);
    });

    it("handles deletion from empty list", () => {
      const result = deleteConversation([], "any_id");
      expect(result).toEqual([]);
    });
  });

  describe("renameConversation", () => {
    it("updates the title of the target conversation", () => {
      const conv = makeConversation({ title: "Old Title" });
      conversations = [conv];

      const result = renameConversation(conversations, conv.id, "New Title");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("New Title");
    });

    it("leaves other conversations unchanged", () => {
      const conv1 = makeConversation({ title: "Alpha" });
      const conv2 = makeConversation({ title: "Beta" });
      conversations = [conv1, conv2];

      const result = renameConversation(conversations, conv1.id, "Alpha Renamed");

      expect(result[0].title).toBe("Alpha Renamed");
      expect(result[1].title).toBe("Beta");
    });

    it("returns unchanged list when ID does not match", () => {
      conversations = [makeConversation({ title: "Original" })];

      const result = renameConversation(conversations, "wrong_id", "Changed");

      expect(result[0].title).toBe("Original");
    });
  });

  describe("updateConversation — message sending flow", () => {
    it("adds messages to a conversation", () => {
      const conv = createConversation();
      conversations = [conv];

      const userMsg = makeChatMessage("user", "Hello, world!");
      const result = updateConversation(conversations, conv.id, [userMsg]);

      expect(result[0].messages).toHaveLength(1);
      expect(result[0].messages[0].content).toBe("Hello, world!");
    });

    it("appends assistant response after user message", () => {
      const conv = createConversation();
      conversations = [conv];

      const userMsg = makeChatMessage("user", "What is TypeScript?");
      const assistantMsg = makeChatMessage("assistant", "TypeScript is a typed superset of JavaScript.");

      const result = updateConversation(conversations, conv.id, [userMsg, assistantMsg]);

      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0].role).toBe("user");
      expect(result[0].messages[1].role).toBe("assistant");
    });

    it("auto-generates title from first user message", () => {
      const conv = createConversation();
      expect(conv.title).toBe("\u65b0\u5bf9\u8bdd"); // "新对话"
      conversations = [conv];

      const userMsg = makeChatMessage("user", "How to deploy React apps?");
      const result = updateConversation(conversations, conv.id, [userMsg]);

      expect(result[0].title).toBe("How to deploy React apps?");
    });

    it("truncates long first messages in title to 30 chars", () => {
      const conv = createConversation();
      conversations = [conv];

      const longMessage = "This is an extremely long message that should be truncated in the title generation";
      const userMsg = makeChatMessage("user", longMessage);
      const result = updateConversation(conversations, conv.id, [userMsg]);

      expect(result[0].title.length).toBeLessThanOrEqual(33); // 30 + "..."
      expect(result[0].title).toContain("...");
    });

    it("does not overwrite existing title when more messages are added", () => {
      const conv = makeConversation({ title: "Custom Title", messages: [makeChatMessage("user", "first")] as any });
      conversations = [conv];

      const newMsg = makeChatMessage("user", "second message");
      const result = updateConversation(conversations, conv.id, [
        ...(conv.messages as ChatMessage[]),
        newMsg,
      ]);

      expect(result[0].title).toBe("Custom Title");
    });

    it("sorts conversations by updatedAt (most recent first)", () => {
      const oldConv = makeConversation({ title: "Old", updatedAt: Date.now() - 10000 });
      const newConv = makeConversation({ title: "New", updatedAt: Date.now() - 5000 });
      conversations = [oldConv, newConv];

      const msg = makeChatMessage("user", "Update old conv");
      const result = updateConversation(conversations, oldConv.id, [msg]);

      // Old conv should now be first since it was just updated
      expect(result[0].id).toBe(oldConv.id);
    });
  });

  describe("generateTitle", () => {
    it("returns default title when no user message exists", () => {
      const title = generateTitle([]);
      expect(title).toBe("\u65b0\u5bf9\u8bdd"); // "新对话"
    });

    it("returns default title for assistant-only messages", () => {
      const messages: ChatMessage[] = [
        makeChatMessage("assistant", "Welcome!"),
      ];
      const title = generateTitle(messages);
      expect(title).toBe("\u65b0\u5bf9\u8bdd");
    });

    it("extracts title from first user message", () => {
      const messages: ChatMessage[] = [
        makeChatMessage("user", "Build a TODO app"),
        makeChatMessage("assistant", "Sure, I can help with that."),
      ];
      const title = generateTitle(messages);
      expect(title).toBe("Build a TODO app");
    });

    it("truncates messages longer than 30 characters", () => {
      const messages: ChatMessage[] = [
        makeChatMessage("user", "Please explain the difference between TypeScript interfaces and types in detail"),
      ];
      const title = generateTitle(messages);
      expect(title).toHaveLength(33); // 30 + "..."
      expect(title.endsWith("...")).toBe(true);
    });
  });

  describe("generateId", () => {
    it("generates IDs with correct prefix", () => {
      const id = generateId();
      expect(id).toMatch(/^conv_/);
    });

    it("includes timestamp component", () => {
      const before = Date.now();
      const id = generateId();
      const after = Date.now();

      const parts = id.split("_");
      const ts = parseInt(parts[1], 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("relativeTime", () => {
    it("returns '刚刚' for timestamps less than 1 minute ago", () => {
      expect(relativeTime(Date.now())).toBe("\u521a\u521a");
      expect(relativeTime(Date.now() - 30000)).toBe("\u521a\u521a");
    });

    it("returns minutes for timestamps less than 1 hour ago", () => {
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      expect(relativeTime(fiveMinAgo)).toBe("5\u5206\u949f\u524d"); // "5分钟前"
    });

    it("returns hours for timestamps less than 1 day ago", () => {
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
      expect(relativeTime(threeHoursAgo)).toBe("3\u5c0f\u65f6\u524d"); // "3小时前"
    });

    it("returns days for timestamps less than 1 week ago", () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      expect(relativeTime(twoDaysAgo)).toBe("2\u5929\u524d"); // "2天前"
    });

    it("returns locale date string for timestamps older than 1 week", () => {
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const result = relativeTime(twoWeeksAgo);
      // Should be a date string (format varies by locale)
      expect(result).not.toContain("\u5206\u949f");
      expect(result).not.toContain("\u5c0f\u65f6");
      expect(result).not.toContain("\u5929\u524d");
    });
  });
});
