import { beforeEach, describe, expect, it } from "vitest";
import {
  executeApproval,
  getApprovalGate,
  getAuditLog,
  getPendingApproval,
  listPendingApprovals,
  requestApproval,
  resetApprovalStore,
  setApprovalGate,
} from "./approvals";

describe("approval runtime", () => {
  beforeEach(() => {
    resetApprovalStore();
  });

  it("creates and lists pending approvals in request order", () => {
    requestApproval({ approvalId: "a1", description: "Delete file", requestedBy: "developer" });
    requestApproval({ approvalId: "a2", description: "Push main", requestedBy: "devops" });

    const pending = listPendingApprovals();
    expect(pending.map((item) => item.approvalId)).toEqual(["a1", "a2"]);
    expect(getPendingApproval("a2")?.requestedBy).toBe("devops");
  });

  it("blocks reject without reason", () => {
    const result = executeApproval({ approvalId: "a1", action: "reject" });
    expect(result.ok).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.mode).toBe("blocked");
  });

  it("honors dry-run mode without consuming approval", () => {
    requestApproval({ approvalId: "a1", description: "Release", requestedBy: "devops" });
    setApprovalGate({ dryRun: true });

    const result = executeApproval({ approvalId: "a1", action: "approve" });
    expect(result.ok).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.mode).toBe("dry_run");
    expect(getPendingApproval("a1")).toBeDefined();
  });

  it("honors readonly mode and blocks live actions", () => {
    requestApproval({ approvalId: "a1", description: "Delete file", requestedBy: "developer" });
    setApprovalGate({ readonlyMode: true, dryRun: false });

    const result = executeApproval({ approvalId: "a1", action: "approve" });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("blocked");
    expect(result.message).toContain("Readonly mode");
  });

  it("executes live approvals and writes audit log", () => {
    requestApproval({ approvalId: "a1", description: "Deploy", requestedBy: "devops" });
    setApprovalGate({ readonlyMode: false, actionsEnabled: true, dryRun: false });

    const result = executeApproval({ approvalId: "a1", action: "approve" });
    expect(result.ok).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.mode).toBe("live");
    expect(getPendingApproval("a1")).toBeUndefined();

    const audit = getAuditLog(1);
    expect(audit).toHaveLength(1);
    expect(audit[0].approvalId).toBe("a1");
    expect(getApprovalGate().actionsEnabled).toBe(true);
  });
});
