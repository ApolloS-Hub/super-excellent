/**
 * ralplan.ts — Three-role deliberation planner (oh-my-codex pattern)
 *
 * Planner → Architect → Critic, up to 5 iterations. Converges when the
 * Critic produces zero blocking issues. Output is an Architecture
 * Decision Record (ADR) saved under .omx/adrs/.
 */

import { isTauriAvailable, writeFileTauri } from "./tauri-bridge";

export type RalplanRole = "planner" | "architect" | "critic";

export interface RalplanTurn {
  iteration: number;
  role: RalplanRole;
  content: string;
  issues?: CriticIssue[];
}

export interface CriticIssue {
  severity: "blocker" | "major" | "minor";
  message: string;
}

export interface RalplanSession {
  id: string;
  title: string;
  spec: string;
  turns: RalplanTurn[];
  iteration: number;
  converged: boolean;
  startedAt: number;
  finishedAt?: number;
}

export const MAX_ITERATIONS = 5;

export const ROLE_PROMPTS: Record<RalplanRole, string> = {
  planner: `You are the Planner. Given the spec, produce a numbered plan of concrete work items. For each step list: goal, files touched, and verification. Be skeptical of scope creep — fewer, sharper steps win.`,
  architect: `You are the Architect. Review the plan and stamp it with: module boundaries, data flow, dependency choices, and migration/rollback strategy. Call out any plan step that breaks an invariant.`,
  critic: `You are the Critic. List concrete issues with the plan+architecture as a JSON array of {severity, message} where severity ∈ {blocker, major, minor}. If none, return []. Blockers prevent convergence.`,
};

export function startSession(title: string, spec: string): RalplanSession {
  return {
    id: `rp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    spec,
    turns: [],
    iteration: 0,
    converged: false,
    startedAt: Date.now(),
  };
}

export function addTurn(session: RalplanSession, role: RalplanRole, content: string, issues?: CriticIssue[]): RalplanSession {
  const iteration = role === "planner" ? session.iteration + 1 : session.iteration;
  const turn: RalplanTurn = { iteration, role, content, issues };
  const converged =
    role === "critic" &&
    (!issues || issues.every(i => i.severity !== "blocker"));
  return {
    ...session,
    iteration,
    turns: [...session.turns, turn],
    converged,
    finishedAt: converged || iteration >= MAX_ITERATIONS ? Date.now() : undefined,
  };
}

/**
 * Parse a critic's response into structured issues. Accepts JSON, falls
 * back to line-by-line heuristic parsing (prefixed with blocker:/major:/minor:).
 */
export function parseCriticIssues(raw: string): CriticIssue[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(x => x && typeof x.message === "string" && typeof x.severity === "string");
      }
    } catch { /* fall through */ }
  }
  const issues: CriticIssue[] = [];
  for (const line of trimmed.split("\n")) {
    const m = line.match(/^\s*[-*]?\s*(blocker|major|minor)\s*[:\-]\s*(.+)$/i);
    if (m) issues.push({ severity: m[1].toLowerCase() as CriticIssue["severity"], message: m[2].trim() });
  }
  return issues;
}

export function buildPrompt(session: RalplanSession, role: RalplanRole): string {
  const priorTurns = session.turns
    .map(t => `### ${t.role.toUpperCase()} (iteration ${t.iteration})\n${t.content}`)
    .join("\n\n");

  return `${ROLE_PROMPTS[role]}

## Spec
${session.spec}

## Prior deliberation
${priorTurns || "(none)"}

Now respond as the ${role}.`;
}

/**
 * Render the final ADR document.
 */
export function renderADR(session: RalplanSession): string {
  const status = session.converged ? "Accepted" : "Draft";
  const lines = [
    `# ADR — ${session.title}`,
    "",
    `- **ID**: ${session.id}`,
    `- **Status**: ${status}`,
    `- **Iterations**: ${session.iteration}/${MAX_ITERATIONS}`,
    `- **Converged**: ${session.converged ? "✅" : "❌ (max iterations)"}`,
    "",
    "## Context",
    "",
    session.spec,
    "",
    "## Deliberation",
  ];
  for (const t of session.turns) {
    lines.push("", `### ${t.role} — iteration ${t.iteration}`, "", t.content);
    if (t.issues?.length) {
      lines.push("", "**Issues:**");
      for (const i of t.issues) lines.push(`- [${i.severity}] ${i.message}`);
    }
  }
  let last: RalplanTurn | undefined;
  for (let i = session.turns.length - 1; i >= 0; i--) {
    if (session.turns[i].role === "architect") { last = session.turns[i]; break; }
  }
  if (last) {
    lines.push("", "## Decision", "", last.content);
  }
  return lines.join("\n");
}

export async function saveADR(session: RalplanSession, workDir: string): Promise<string | null> {
  if (!isTauriAvailable() || !workDir) return null;
  const path = `${workDir}/.omx/adrs/${session.id}.md`;
  try {
    await writeFileTauri(path, renderADR(session));
    return path;
  } catch {
    return null;
  }
}
