/**
 * Agent Roster — 管理所有可用 Agent 的花名册
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/agent-roster.ts
 */

export type AgentRosterStatus = "connected" | "partial" | "not_connected";

export interface AgentRosterEntry {
  agentId: string;
  displayName: string;
}

export interface AgentRosterSnapshot {
  status: AgentRosterStatus;
  detail: string;
  entries: AgentRosterEntry[];
}

const DEFAULT_AGENTS: AgentRosterEntry[] = [
  { agentId: "secretary", displayName: "Secretary" },
  { agentId: "developer", displayName: "Developer" },
  { agentId: "tester", displayName: "Tester" },
  { agentId: "reviewer", displayName: "Reviewer" },
  { agentId: "ops_director", displayName: "运营总监" },
  { agentId: "growth_hacker", displayName: "增长黑客" },
  { agentId: "content_ops", displayName: "内容运营" },
  { agentId: "legal_compliance", displayName: "法务合规" },
  { agentId: "financial_analyst", displayName: "财务分析" },
  { agentId: "project_manager", displayName: "项目经理" },
  { agentId: "customer_support", displayName: "客户支持" },
  { agentId: "risk_analyst", displayName: "风控分析" },
];

let rosterEntries: AgentRosterEntry[] = [...DEFAULT_AGENTS];

export function loadAgentRoster(): AgentRosterSnapshot {
  if (rosterEntries.length === 0) {
    return {
      status: "not_connected",
      detail: "No agents registered.",
      entries: [],
    };
  }

  return {
    status: "connected",
    detail: `${rosterEntries.length} agent(s) available.`,
    entries: [...rosterEntries],
  };
}

export function registerAgent(entry: AgentRosterEntry): void {
  const idx = rosterEntries.findIndex(e => e.agentId === entry.agentId);
  if (idx >= 0) {
    rosterEntries[idx] = { ...entry };
  } else {
    rosterEntries.push({ ...entry });
  }
}

export function unregisterAgent(agentId: string): boolean {
  const before = rosterEntries.length;
  rosterEntries = rosterEntries.filter(e => e.agentId !== agentId);
  return rosterEntries.length < before;
}

export function getAgent(agentId: string): AgentRosterEntry | undefined {
  return rosterEntries.find(e => e.agentId === agentId);
}

export function resetRoster(): void {
  rosterEntries = [...DEFAULT_AGENTS];
}
