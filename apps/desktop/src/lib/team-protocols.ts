/**
 * Team Protocols — 协作协议引擎
 * 参照 s16_team_protocols.py：请求/审批/拒绝工作流
 *
 * ProtocolRequest: 协议请求记录
 * 支持: plan_approval, code_review, task_handoff
 */

export type ProtocolType = "plan_approval" | "code_review" | "task_handoff";
export type ProtocolStatus = "pending" | "approved" | "rejected";

export interface ProtocolRequest {
  id: string;
  type: ProtocolType;
  from: string;
  to: string;
  content: string;
  status: ProtocolStatus;
  feedback: string;
  createdAt: number;
  resolvedAt: number | null;
}

type ProtocolCallback = (request: ProtocolRequest) => void;

let _idCounter = 0;
function _genId(): string {
  _idCounter += 1;
  return `proto_${Date.now().toString(36)}_${_idCounter}`;
}

const _requests = new Map<string, ProtocolRequest>();
const _onCreateCallbacks: ProtocolCallback[] = [];
const _onResolveCallbacks: ProtocolCallback[] = [];

/** Submit a new protocol request. */
export function submitRequest(
  type: ProtocolType,
  from: string,
  to: string,
  content: string,
): string {
  const id = _genId();
  const req: ProtocolRequest = {
    id,
    type,
    from,
    to,
    content,
    status: "pending",
    feedback: "",
    createdAt: Date.now(),
    resolvedAt: null,
  };
  _requests.set(id, req);
  for (const cb of _onCreateCallbacks) {
    try { cb(req); } catch { /* ignore */ }
  }
  return id;
}

/** Approve a pending request. */
export function approveRequest(id: string, feedback = ""): boolean {
  const req = _requests.get(id);
  if (!req || req.status !== "pending") return false;
  req.status = "approved";
  req.feedback = feedback;
  req.resolvedAt = Date.now();
  for (const cb of _onResolveCallbacks) {
    try { cb(req); } catch { /* ignore */ }
  }
  return true;
}

/** Reject a pending request. */
export function rejectRequest(id: string, feedback = ""): boolean {
  const req = _requests.get(id);
  if (!req || req.status !== "pending") return false;
  req.status = "rejected";
  req.feedback = feedback;
  req.resolvedAt = Date.now();
  for (const cb of _onResolveCallbacks) {
    try { cb(req); } catch { /* ignore */ }
  }
  return true;
}

/** Get a single request by ID. */
export function getRequest(id: string): ProtocolRequest | null {
  return _requests.get(id) ?? null;
}

/** Get all pending requests, optionally filtered by recipient. */
export function getPendingRequests(to?: string): ProtocolRequest[] {
  const result: ProtocolRequest[] = [];
  for (const req of _requests.values()) {
    if (req.status !== "pending") continue;
    if (to && req.to !== to) continue;
    result.push(req);
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

/** Get all requests (any status). */
export function getAllRequests(): ProtocolRequest[] {
  return Array.from(_requests.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Subscribe to new request creation. */
export function onRequestCreated(callback: ProtocolCallback): () => void {
  _onCreateCallbacks.push(callback);
  return () => {
    const idx = _onCreateCallbacks.indexOf(callback);
    if (idx >= 0) _onCreateCallbacks.splice(idx, 1);
  };
}

/** Subscribe to request resolution (approve/reject). */
export function onRequestResolved(callback: ProtocolCallback): () => void {
  _onResolveCallbacks.push(callback);
  return () => {
    const idx = _onResolveCallbacks.indexOf(callback);
    if (idx >= 0) _onResolveCallbacks.splice(idx, 1);
  };
}

/** Reset all state (for testing). */
export function resetProtocols(): void {
  _requests.clear();
  _onCreateCallbacks.length = 0;
  _onResolveCallbacks.length = 0;
  _idCounter = 0;
}
