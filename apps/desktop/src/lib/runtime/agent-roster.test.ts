import { beforeEach, describe, expect, it } from "vitest";
import {
  getAgent,
  loadAgentRoster,
  registerAgent,
  resetRoster,
  unregisterAgent,
} from "./agent-roster";

describe("agent-roster", () => {
  beforeEach(() => {
    resetRoster();
  });

  it("includes the newly added operations roles by default", () => {
    const snapshot = loadAgentRoster();
    expect(snapshot.status).toBe("connected");
    expect(snapshot.entries.map((entry) => entry.agentId)).toEqual(
      expect.arrayContaining([
        "ops_director",
        "growth_hacker",
        "content_ops",
        "legal_compliance",
        "financial_analyst",
        "project_manager",
        "customer_support",
        "risk_analyst",
      ]),
    );
  });

  it("registers and updates custom agents", () => {
    registerAgent({ agentId: "researcher", displayName: "研究员" });
    expect(getAgent("researcher")?.displayName).toBe("研究员");

    registerAgent({ agentId: "researcher", displayName: "Research Lead" });
    expect(getAgent("researcher")?.displayName).toBe("Research Lead");
  });

  it("unregisters agents and can reset back to defaults", () => {
    expect(unregisterAgent("customer_support")).toBe(true);
    expect(getAgent("customer_support")).toBeUndefined();

    resetRoster();
    expect(getAgent("customer_support")?.displayName).toBe("客户支持");
  });
});
