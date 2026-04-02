/**
 * Orchestrator module — Secretary-Worker pattern
 */
export { SecretaryAgent } from "./secretary.js";
export { WORKER_ROLES, getWorkerById, getWorkersByExpertise } from "./workers.js";
export type { WorkerRole, SubTask, OrchestrationPlan, SecretaryConfig, WorkerResult } from "./types.js";
