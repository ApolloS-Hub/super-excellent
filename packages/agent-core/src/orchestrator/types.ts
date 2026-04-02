/**
 * Orchestrator types — Secretary-Worker (Coordinator-Worker) pattern
 * 
 * Inspired by:
 * - open-agent-sdk's Agent/Subagent/Team system
 * - Shannon's multi-strategy orchestration
 */

export interface WorkerRole {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  systemPrompt: string;
  /** Which tools this worker can use */
  allowedTools: string[];
  /** Expertise areas for task routing */
  expertise: string[];
}

export interface SubTask {
  id: string;
  description: string;
  assignedWorker: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

export interface OrchestrationPlan {
  intent: string;
  tasks: SubTask[];
  strategy: "sequential" | "parallel" | "mixed";
}

export interface SecretaryConfig {
  /** Available worker roles */
  workers: WorkerRole[];
  /** Max concurrent workers */
  maxConcurrent: number;
  /** Whether to auto-merge results */
  autoMerge: boolean;
}

export interface WorkerResult {
  workerId: string;
  taskId: string;
  output: string;
  success: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
