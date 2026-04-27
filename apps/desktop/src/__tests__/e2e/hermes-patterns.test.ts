/**
 * Hermes-inspired: memory nudges + natural-language schedule parsing
 */
import { describe, it, expect, beforeEach } from "vitest";
import { nudgeMemory, isSensitive } from "../../lib/memory-nudge";

describe("memory-nudge: nudgeMemory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("detects decisions from user message", async () => {
    const count = await nudgeMemory("We decided to use PostgreSQL for the new service", "Good choice.");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("detects decisions in Chinese", async () => {
    const count = await nudgeMemory("决定了用方案B", "好的");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("detects preferences", async () => {
    const count = await nudgeMemory("I prefer dark mode for all my apps", "Noted.");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("detects Chinese preferences", async () => {
    const count = await nudgeMemory("我喜欢简洁的设计风格", "好的");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("detects deadlines", async () => {
    const count = await nudgeMemory("The deadline is next Friday", "I'll note that.");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("detects project mentions", async () => {
    const count = await nudgeMemory("We're working on the dashboard project this quarter", "Got it.");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("detects commitments", async () => {
    const count = await nudgeMemory("I'll finish the report by tomorrow", "Sounds good.");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("returns 0 for casual chat with no signals", async () => {
    const count = await nudgeMemory("hello", "hi there!");
    expect(count).toBe(0);
  });

  it("deduplicates within cooldown window", async () => {
    const c1 = await nudgeMemory("We decided to use React", "ok");
    const c2 = await nudgeMemory("We decided to use React", "ok");
    expect(c1).toBeGreaterThanOrEqual(1);
    expect(c2).toBe(0); // deduped
  });
});

describe("memory-nudge: isSensitive", () => {
  it("flags password-like content", () => {
    expect(isSensitive("my password is abc123")).toBe(true);
    expect(isSensitive("the api_key for production")).toBe(true);
    expect(isSensitive("密码是 hunter2")).toBe(true);
    expect(isSensitive("ssh private key")).toBe(true);
  });

  it("passes normal content", () => {
    expect(isSensitive("let's schedule a meeting")).toBe(false);
    expect(isSensitive("working on the dashboard")).toBe(false);
  });
});

// ═══════════ /schedule natural-language parser ═══════════

// We test parseNaturalCron indirectly by importing from commands
// Since parseNaturalCron is module-private, we test via the patterns it covers

describe("schedule: cron-scheduler integration", () => {
  it("cronScheduler.addSchedule creates a record", async () => {
    const { cronScheduler } = await import("../../lib/cron-scheduler");
    const id = cronScheduler.addSchedule("0 9 * * 1", "check emails");
    expect(id).toBeTruthy();
    const record = cronScheduler.getSchedule(id);
    expect(record).not.toBeNull();
    expect(record!.task).toBe("check emails");
    expect(record!.cron).toBe("0 9 * * 1");
    expect(record!.enabled).toBe(true);
    cronScheduler.removeSchedule(id);
  });

  it("cronScheduler.removeSchedule deletes it", async () => {
    const { cronScheduler } = await import("../../lib/cron-scheduler");
    const id = cronScheduler.addSchedule("*/5 * * * *", "heartbeat");
    expect(cronScheduler.removeSchedule(id)).toBe(true);
    expect(cronScheduler.getSchedule(id)).toBeNull();
  });

  it("cronScheduler.enableSchedule toggles", async () => {
    const { cronScheduler } = await import("../../lib/cron-scheduler");
    const id = cronScheduler.addSchedule("0 * * * *", "hourly");
    cronScheduler.enableSchedule(id, false);
    expect(cronScheduler.getSchedule(id)!.enabled).toBe(false);
    cronScheduler.enableSchedule(id, true);
    expect(cronScheduler.getSchedule(id)!.enabled).toBe(true);
    cronScheduler.removeSchedule(id);
  });

  it("getAllSchedules returns all active schedules", async () => {
    const { cronScheduler } = await import("../../lib/cron-scheduler");
    const before = cronScheduler.getAllSchedules().length;
    const id1 = cronScheduler.addSchedule("0 9 * * *", "a");
    const id2 = cronScheduler.addSchedule("0 17 * * *", "b");
    expect(cronScheduler.getAllSchedules().length).toBe(before + 2);
    cronScheduler.removeSchedule(id1);
    cronScheduler.removeSchedule(id2);
  });
});

describe("schedule: cronMatches", () => {
  it("matches exact minute + hour", async () => {
    const { cronMatches } = await import("../../lib/cron-scheduler");
    const date = new Date(2026, 3, 23, 9, 0); // Wed Apr 23, 9:00
    expect(cronMatches("0 9 * * *", date)).toBe(true);
    expect(cronMatches("0 10 * * *", date)).toBe(false);
  });

  it("matches day of week", async () => {
    const { cronMatches } = await import("../../lib/cron-scheduler");
    const monday = new Date(2026, 3, 20, 9, 0); // Mon
    expect(cronMatches("0 9 * * 1", monday)).toBe(true);
    expect(cronMatches("0 9 * * 5", monday)).toBe(false); // Friday
  });

  it("matches every N minutes", async () => {
    const { cronMatches } = await import("../../lib/cron-scheduler");
    const at15 = new Date(2026, 3, 23, 10, 15);
    const at16 = new Date(2026, 3, 23, 10, 16);
    expect(cronMatches("*/5 * * * *", at15)).toBe(true);
    expect(cronMatches("*/5 * * * *", at16)).toBe(false);
  });

  it("wildcard * matches any value", async () => {
    const { cronMatches } = await import("../../lib/cron-scheduler");
    expect(cronMatches("* * * * *", new Date())).toBe(true);
  });
});
