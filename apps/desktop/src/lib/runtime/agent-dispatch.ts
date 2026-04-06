/**
 * Agent Dispatch — 决定哪个 Agent/Worker 处理消息
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/agent-dispatch.ts
 */

export type ParticipantRole = "human" | "planner" | "coder" | "reviewer" | "manager";

export interface DispatchMessage {
  roomId: string;
  kind: "chat" | "proposal" | "decision" | "handoff" | "status" | "result";
  authorRole: ParticipantRole;
  authorLabel: string;
  content: string;
  payload?: Record<string, unknown>;
}

interface DispatchContext {
  roomId: string;
  taskTitle: string;
  definitionOfDone: string[];
  dueAt?: string;
  recentMessages: Array<{ role: string; content: string; authorRole?: ParticipantRole }>;
}

export function buildDispatchMessage(
  role: ParticipantRole,
  ctx: DispatchContext,
): DispatchMessage {
  if (role === "planner") return buildPlannerMessage(ctx);
  if (role === "coder") return buildCoderMessage(ctx);
  if (role === "reviewer") return buildReviewerMessage(ctx);
  return buildManagerMessage(ctx);
}

export function buildExecutionStartedMessage(
  roomId: string,
  executor: ParticipantRole,
  taskTitle: string,
): DispatchMessage {
  return {
    roomId,
    kind: "status",
    authorRole: executor,
    authorLabel: roleLabel(executor),
    content: `${roleLabel(executor)} accepted "${taskTitle}" and started execution.`,
    payload: { status: "execution_started", executor, taskStatus: "in_progress" },
  };
}

export function buildReviewOutcomeMessage(input: {
  roomId: string;
  outcome: "approved" | "rejected";
  note?: string;
  taskStatus: "done" | "blocked" | "in_progress";
}): DispatchMessage {
  const base =
    input.outcome === "approved"
      ? "Reviewer approved the execution result."
      : "Reviewer rejected the execution result and requested another pass.";
  return {
    roomId: input.roomId,
    kind: "result",
    authorRole: "reviewer",
    authorLabel: "Reviewer",
    content: input.note ? `${base} ${input.note}` : base,
    payload: {
      reviewOutcome: input.outcome,
      taskStatus: input.taskStatus,
      status: input.outcome === "approved" ? "review_passed" : "review_rejected",
    },
  };
}

function buildPlannerMessage(ctx: DispatchContext): DispatchMessage {
  const latestHuman = findLatestHumanRequest(ctx.recentMessages);
  const proposal = [
    `Scope the request for "${ctx.taskTitle}".`,
    latestHuman ? `Anchor the work on: ${latestHuman}.` : "Use the latest operator request as the main requirement.",
    "Implement the smallest safe slice first, then verify with concrete evidence.",
  ].join(" ");

  return {
    roomId: ctx.roomId,
    kind: "proposal",
    authorRole: "planner",
    authorLabel: "Planner",
    content: proposal,
    payload: { proposal },
  };
}

function buildCoderMessage(ctx: DispatchContext): DispatchMessage {
  const plan = [
    `Implementation path for "${ctx.taskTitle}":`,
    "wire the room/task state first,",
    "keep mutations traceable,",
    "and finish with tests that prove the happy path and review flow.",
  ].join(" ");

  return {
    roomId: ctx.roomId,
    kind: "proposal",
    authorRole: "coder",
    authorLabel: "Coder",
    content: plan,
    payload: { proposal: plan },
  };
}

function buildReviewerMessage(ctx: DispatchContext): DispatchMessage {
  const checklist = [
    `Review focus for "${ctx.taskTitle}":`,
    "one room per task,",
    "ordered discussion turns,",
    "task-state sync,",
    "summary persistence,",
    "and regression coverage for the main API flow.",
  ].join(" ");

  return {
    roomId: ctx.roomId,
    kind: "proposal",
    authorRole: "reviewer",
    authorLabel: "Reviewer",
    content: checklist,
    payload: { proposal: checklist },
  };
}

function buildManagerMessage(ctx: DispatchContext): DispatchMessage {
  const executor: ParticipantRole = "coder";
  const doneWhen = resolveDoneWhen(ctx);
  const decision = `Use the room-first implementation plan for "${ctx.taskTitle}" and move execution to ${roleLabel(executor)}.`;
  const proposal = `Planner, coder, and reviewer aligned on a safe incremental build for "${ctx.taskTitle}".`;

  return {
    roomId: ctx.roomId,
    kind: "decision",
    authorRole: "manager",
    authorLabel: "Manager",
    content: `${decision} Done when: ${doneWhen}.`,
    payload: { proposal, decision, executor, doneWhen },
  };
}

function findLatestHumanRequest(
  messages: Array<{ role: string; content: string; authorRole?: ParticipantRole }>,
): string | undefined {
  const human = [...messages].reverse().find(m => m.authorRole === "human" || m.role === "user");
  if (!human) return undefined;
  const trimmed = human.content.trim().replace(/\s+/g, " ");
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`;
}

function resolveDoneWhen(ctx: DispatchContext): string {
  if (ctx.definitionOfDone.length > 0) return ctx.definitionOfDone.join("; ");
  if (ctx.dueAt) return `the requested changes are implemented and reviewed before ${ctx.dueAt}`;
  return "the main flow works, the result is reviewed, and the task state is updated";
}

function roleLabel(role: ParticipantRole): string {
  const labels: Record<ParticipantRole, string> = {
    human: "Operator",
    planner: "Planner",
    coder: "Coder",
    reviewer: "Reviewer",
    manager: "Manager",
  };
  return labels[role] ?? "Manager";
}
