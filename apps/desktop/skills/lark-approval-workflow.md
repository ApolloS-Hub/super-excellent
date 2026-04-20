---
name: lark-approval-workflow
description: Use when the user needs to check pending approvals, approve/reject requests, or submit an approval form in Lark/Feishu. Drives lark_approval with audit-trail discipline.
phase: business
category: business
tags: [lark, feishu, approval, request, 飞书, 审批]
triggers: [审批, 批准, 驳回, 申请, 请假, 报销, approve, reject, approval]
workers: [legal_compliance, financial_analyst, project_manager]
command: /lark-approve
---

# Lark Approval Workflow

## Overview
Approvals are audit-logged financial/policy events. Never bulk-approve. Always state the reason for each action.

## When to Use
- User asks "什么要我批?" / "any pending approvals?"
- User says "approve X" / "reject Y"
- User wants to check status of a past approval

## Process

### 1. Identify action
- `query` — list pending / historical
- `approve` — approve ONE instance with comment
- `reject` — reject ONE instance with comment

### 2. For QUERY
- Default filter: status=pending
- Show: requester name, type (leave/expense/purchase), amount if applicable, submitted date
- Group by type if list >10

### 3. For APPROVE / REJECT — one at a time
**Never** process more than one approval per user confirmation.
1. Show the full approval details (form fields, amounts, attachments)
2. Ask: "Approve / Reject / Skip?"
3. If user picks approve/reject, ask for a comment
4. Execute with instance_id + comment

### 4. Comment guidelines
- Approve: short positive comment OR specific acknowledgment ("OK per budget Q2")
- Reject: SPECIFIC reason + path-forward ("Amount exceeds limit; resubmit with manager approval")
- Never leave empty — the audit trail needs it

### 5. After action
- Confirm back: "Approved request #12345 by Alice for 2-day leave on 2025-Q4"
- If multiple pending, ask if user wants to continue with next

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "User said approve all 5" | Each has different merit. One-at-a-time |
| "Comment field is optional" | Not in audit logs. Every action gets a reason |
| "It looks fine, approve" | Check amounts, dates, requester permissions |

## Red Flags
- Bulk approving without reviewing each
- Rejecting without a reason comment
- Approving without noting the budget/policy that allows it
- Ignoring unusual patterns (same requester 10 times this week)

## Verification
- [ ] For query: listed with requester + type + amount + date
- [ ] For approve/reject: processed ONE at a time
- [ ] Comment provided for every action
- [ ] User confirmation captured in logs
- [ ] Instance IDs echoed back to user after action
