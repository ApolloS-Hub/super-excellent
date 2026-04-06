/**
 * Approval Service — Human-in-the-Loop Approval Gate
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/approval-action-service.ts
 *
 * Dangerous or high-impact operations must pass through this gate.
 * Supports dry-run, readonly, and live modes with full audit logging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalAction = "approve" | "reject";
export type ApprovalMode = "blocked" | "dry_run" | "live";

export interface ApprovalGate {
  readonlyMode: boolean;
  actionsEnabled: boolean;
  dryRun: boolean;
}

export interface ApprovalInput {
  action: ApprovalAction;
  approvalId: string;
  reason?: string;
}

export interface ApprovalResult {
  ok: boolean;
  executed: boolean;
  mode: ApprovalMode;
  action: ApprovalAction;
  approvalId: string;
  reason?: string;
  message: string;
  gate: ApprovalGate;
  timestamp: string;
}

export interface PendingApproval {
  approvalId: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  risk: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

export interface ApprovalAuditEntry {
  approvalId: string;
  action: ApprovalAction;
  mode: ApprovalMode;
  ok: boolean;
  reason?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const pendingApprovals = new Map<string, PendingApproval>();
const auditLog: ApprovalAuditEntry[] = [];
let currentGate: ApprovalGate = {
  readonlyMode: false,
  actionsEnabled: true,
  dryRun: false,
};

// ---------------------------------------------------------------------------
// Gate configuration
// ---------------------------------------------------------------------------

export function setApprovalGate(gate: Partial<ApprovalGate>): ApprovalGate {
  currentGate = { ...currentGate, ...gate };
  return currentGate;
}

export function getApprovalGate(): ApprovalGate {
  return { ...currentGate };
}

// ---------------------------------------------------------------------------
// Request approval
// ---------------------------------------------------------------------------

export function requestApproval(input: {
  approvalId: string;
  description: string;
  requestedBy: string;
  risk?: PendingApproval["risk"];
  metadata?: Record<string, unknown>;
}): PendingApproval {
  const approval: PendingApproval = {
    approvalId: input.approvalId,
    description: input.description,
    requestedBy: input.requestedBy,
    requestedAt: new Date().toISOString(),
    risk: input.risk ?? "medium",
    metadata: input.metadata,
  };
  pendingApprovals.set(approval.approvalId, approval);
  return approval;
}

export function getPendingApproval(approvalId: string): PendingApproval | undefined {
  return pendingApprovals.get(approvalId);
}

export function listPendingApprovals(): PendingApproval[] {
  return [...pendingApprovals.values()].sort(
    (a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt),
  );
}

// ---------------------------------------------------------------------------
// Execute approval action
// ---------------------------------------------------------------------------

export function executeApproval(input: ApprovalInput): ApprovalResult {
  const approvalId = input.approvalId.trim();
  const reason = input.reason?.trim();
  const timestamp = new Date().toISOString();

  if (!approvalId) {
    return audit({
      ok: false, executed: false, mode: "blocked",
      action: input.action, approvalId: input.approvalId,
      reason, message: "approvalId is required.",
      gate: currentGate, timestamp,
    });
  }

  if (input.action === "reject" && !reason) {
    return audit({
      ok: false, executed: false, mode: "blocked",
      action: input.action, approvalId,
      message: "reason is required for reject action.",
      gate: currentGate, timestamp,
    });
  }

  if (!currentGate.actionsEnabled) {
    return audit({
      ok: false, executed: false, mode: "blocked",
      action: input.action, approvalId, reason,
      message: "Approval actions are disabled by runtime gate.",
      gate: currentGate, timestamp,
    });
  }

  if (currentGate.dryRun) {
    return audit({
      ok: true, executed: false, mode: "dry_run",
      action: input.action, approvalId, reason,
      message: "Dry-run mode active. No action executed.",
      gate: currentGate, timestamp,
    });
  }

  if (currentGate.readonlyMode) {
    return audit({
      ok: false, executed: false, mode: "blocked",
      action: input.action, approvalId, reason,
      message: "Readonly mode blocks approval actions.",
      gate: currentGate, timestamp,
    });
  }

  pendingApprovals.delete(approvalId);

  return audit({
    ok: true, executed: true, mode: "live",
    action: input.action, approvalId, reason,
    message: `Approval ${input.action} executed.`,
    gate: currentGate, timestamp,
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function audit(result: ApprovalResult): ApprovalResult {
  auditLog.push({
    approvalId: result.approvalId,
    action: result.action,
    mode: result.mode,
    ok: result.ok,
    reason: result.reason,
    timestamp: result.timestamp,
  });
  return result;
}

export function getAuditLog(limit?: number): ApprovalAuditEntry[] {
  if (limit) return auditLog.slice(-limit);
  return [...auditLog];
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function resetApprovalStore(): void {
  pendingApprovals.clear();
  auditLog.length = 0;
  currentGate = { readonlyMode: false, actionsEnabled: true, dryRun: false };
}
