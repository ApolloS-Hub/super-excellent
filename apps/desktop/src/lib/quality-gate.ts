/**
 * Quality Gate — Worker Output Self-Critique
 *
 * Before a worker's output is returned to the user or consumed downstream,
 * it passes through a role-specific quality checklist. Failures trigger
 * a retry with feedback.
 *
 * Inspired by product-playbook's "品质自检 Hard Gate" pattern.
 */
import { emitAgentEvent } from "./event-bus";

// ── Types ──

export interface QualityCheck {
  id: string;
  description: string;
  check: (output: string, context: QualityContext) => QualityResult;
}

export interface QualityContext {
  workerId: string;
  taskDescription: string;
  userMessage: string;
}

export interface QualityResult {
  passed: boolean;
  reason?: string;
}

export interface GateResult {
  passed: boolean;
  failedChecks: Array<{ checkId: string; reason: string }>;
  score: number; // 0-1, fraction of checks passed
}

// ── Universal checks (apply to all workers) ──

const UNIVERSAL_CHECKS: QualityCheck[] = [
  {
    id: "not_empty",
    description: "Output must not be empty or trivially short",
    check: (output) => ({
      passed: output.trim().length > 20,
      reason: "Output is too short or empty",
    }),
  },
  {
    id: "no_hallucinated_urls",
    description: "Output must not contain fabricated URLs",
    check: (output) => {
      const urlPattern = /https?:\/\/[^\s)]+/g;
      const urls = output.match(urlPattern) || [];
      const suspicious = urls.filter(u =>
        u.includes("example.com") ||
        u.includes("placeholder") ||
        /https?:\/\/(?:www\.)?[a-z]+\.com\/[a-z]{20,}/.test(u)
      );
      return { passed: suspicious.length === 0, reason: `Suspicious URLs found: ${suspicious.join(", ")}` };
    },
  },
  {
    id: "answers_the_question",
    description: "Output must address the user's actual request",
    check: (output, ctx) => {
      if (!ctx.userMessage || ctx.userMessage.length < 10) return { passed: true };
      const keyTerms = ctx.userMessage
        .replace(/[^\w一-鿿]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 5);
      if (keyTerms.length === 0) return { passed: true };
      const outputLower = output.toLowerCase();
      const matched = keyTerms.filter(t => outputLower.includes(t.toLowerCase()));
      const ratio = matched.length / keyTerms.length;
      return {
        passed: ratio >= 0.3,
        reason: `Output may not address the request (matched ${matched.length}/${keyTerms.length} key terms)`,
      };
    },
  },
  {
    id: "no_refusal_leak",
    description: "Output must not contain raw LLM refusal language",
    check: (output) => {
      const refusals = [
        "I cannot", "I'm unable to", "As an AI", "as a language model",
        "I don't have access", "I apologize, but I cannot",
      ];
      const found = refusals.find(r => output.includes(r));
      return { passed: !found, reason: `Contains refusal language: "${found}"` };
    },
  },
];

// ── Role-specific checks ──

const ROLE_CHECKS: Record<string, QualityCheck[]> = {
  developer: [
    {
      id: "code_block_present",
      description: "Developer output should include code when the task implies code changes",
      check: (output, ctx) => {
        const codeIndicators = ["implement", "write", "code", "function", "fix", "编写", "实现", "修复", "代码"];
        const needsCode = codeIndicators.some(k => ctx.taskDescription.toLowerCase().includes(k));
        if (!needsCode) return { passed: true };
        return {
          passed: output.includes("```") || output.includes("    ") || /\bfunction\b|\bconst\b|\bclass\b/.test(output),
          reason: "Task implies code but output contains no code blocks",
        };
      },
    },
  ],
  writer: [
    {
      id: "structured_output",
      description: "Writer output should use headers or bullet points for long content",
      check: (output) => {
        if (output.length < 200) return { passed: true };
        const hasStructure = output.includes("#") || output.includes("- ") || output.includes("1.") || output.includes("•");
        return { passed: hasStructure, reason: "Long output lacks structural formatting (headers, lists)" };
      },
    },
  ],
  researcher: [
    {
      id: "sources_or_evidence",
      description: "Research output should cite sources or provide evidence",
      check: (output, ctx) => {
        const researchIndicators = ["research", "调研", "investigate", "查找", "分析"];
        const needsSources = researchIndicators.some(k => ctx.taskDescription.toLowerCase().includes(k));
        if (!needsSources) return { passed: true };
        const hasEvidence = output.includes("according to") || output.includes("source") || output.includes("data shows") ||
          output.includes("根据") || output.includes("数据") || output.includes("http");
        return { passed: hasEvidence, reason: "Research output lacks sources or evidence" };
      },
    },
  ],
  code_reviewer: [
    {
      id: "specific_feedback",
      description: "Code review should reference specific files or code patterns",
      check: (output) => {
        const specificity = output.includes("`") || output.includes("line ") || output.includes("file ") ||
          output.includes("函数") || output.includes("function") || /\.\w{2,4}:/.test(output);
        return { passed: specificity, reason: "Code review is too vague — no specific file/line/function references" };
      },
    },
  ],
  project_manager: [
    {
      id: "actionable_items",
      description: "PM output should include clear action items or next steps",
      check: (output) => {
        const actionIndicators = ["action", "next step", "TODO", "下一步", "行动", "任务", "- [ ]", "1.", "2."];
        const hasActions = actionIndicators.some(k => output.includes(k));
        return { passed: hasActions, reason: "PM output lacks actionable items or clear next steps" };
      },
    },
  ],
};

// ── Gate execution ──

export function runQualityGate(output: string, context: QualityContext): GateResult {
  const checks = [...UNIVERSAL_CHECKS, ...(ROLE_CHECKS[context.workerId] || [])];
  const failedChecks: Array<{ checkId: string; reason: string }> = [];

  for (const check of checks) {
    const result = check.check(output, context);
    if (!result.passed) {
      failedChecks.push({ checkId: check.id, reason: result.reason || check.description });
    }
  }

  const score = checks.length > 0 ? (checks.length - failedChecks.length) / checks.length : 1;
  const passed = failedChecks.length === 0;

  if (!passed) {
    emitAgentEvent({
      type: "error",
      text: `Quality gate: ${context.workerId} failed ${failedChecks.length} check(s) — ${failedChecks.map(f => f.checkId).join(", ")}`,
      worker: context.workerId,
    });
  }

  return { passed, failedChecks, score };
}

/**
 * Build a retry prompt that includes the quality gate feedback.
 * The worker should address each failure before re-submitting.
 */
export function buildRetryPrompt(originalTask: string, output: string, gateResult: GateResult): string {
  const feedback = gateResult.failedChecks
    .map(f => `- [${f.checkId}] ${f.reason}`)
    .join("\n");

  return [
    "Your previous output did not pass quality review. Please revise.",
    "",
    "## Issues Found",
    feedback,
    "",
    "## Original Task",
    originalTask,
    "",
    "## Your Previous Output (needs revision)",
    output.slice(0, 500) + (output.length > 500 ? "…" : ""),
    "",
    "Please produce an improved version that addresses all the issues above.",
  ].join("\n");
}

/**
 * Run a worker's output through the quality gate with optional retry.
 * Returns the final output (either original if passed, or retry output).
 */
export async function gatedExecute(
  execute: (task: string) => Promise<string>,
  task: string,
  context: QualityContext,
  maxRetries = 1,
): Promise<{ output: string; gateResult: GateResult; retried: boolean }> {
  let output = await execute(task);
  let gateResult = runQualityGate(output, context);

  if (gateResult.passed) {
    return { output, gateResult, retried: false };
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const retryPrompt = buildRetryPrompt(task, output, gateResult);
    output = await execute(retryPrompt);
    gateResult = runQualityGate(output, context);
    if (gateResult.passed) break;
  }

  return { output, gateResult, retried: true };
}

// ── Introspection ──

export function getAvailableChecks(workerId: string): string[] {
  const checks = [...UNIVERSAL_CHECKS, ...(ROLE_CHECKS[workerId] || [])];
  return checks.map(c => `${c.id}: ${c.description}`);
}

export function getAllRoleChecks(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [role, checks] of Object.entries(ROLE_CHECKS)) {
    result[role] = checks.map(c => c.id);
  }
  return result;
}
