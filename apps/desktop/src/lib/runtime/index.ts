/**
 * Runtime — unified exports
 * Core runtime modules adapted from openclaw-control-center
 */

export {
  buildDispatchMessage,
  buildExecutionStartedMessage,
  buildReviewOutcomeMessage,
  type ParticipantRole,
  type DispatchMessage,
} from "./agent-dispatch";

export {
  loadAgentRoster,
  registerAgent,
  unregisterAgent,
  getAgent,
  resetRoster,
  type AgentRosterStatus,
  type AgentRosterEntry,
  type AgentRosterSnapshot,
} from "./agent-roster";

export {
  listChatRooms,
  getChatRoom,
  getChatRoomByTask,
  listChatMessages,
  createChatRoom,
  updateChatRoom,
  appendChatMessage,
  createHandoff,
  deleteChatRoom,
  resetChatStore,
  onChatStoreChange,
  ChatStoreValidationError,
  type RoomStage,
  type MessageKind,
  type ChatRoom,
  type ChatMessage,
  type ChatMessagePayload,
  type RoomParticipant,
  type HandoffRecord,
  type CreateChatMessageInput,
  type CreateChatRoomInput,
} from "./chat-store";

export {
  listTasks,
  getTask,
  createTask,
  updateTaskStatus,
  patchTask,
  deleteTask,
  getAllTasks,
  resetTaskStore,
  onTaskStoreChange,
  TaskStoreValidationError,
  type TaskState,
  type ProjectTask,
  type TaskArtifact,
  type RollbackPlan,
  type BudgetThresholds,
  type TaskListItem,
  type CreateTaskInput,
  type PatchTaskInput,
} from "./task-store";

export {
  runHeartbeat,
  selectHeartbeatTasks,
  configureHeartbeat,
  getHeartbeatGate,
  getHeartbeatLog,
  resetHeartbeatLog,
  type HeartbeatGate,
  type HeartbeatSelection,
  type HeartbeatResult,
} from "./task-heartbeat";

export {
  parseSlashCommand,
  executeCommand,
  registerCommand,
  unregisterCommand,
  commanderAlerts,
  type AlertLevel,
  type AlertRoute,
  type CommanderAlert,
  type SlashCommand,
  type CommandResult,
} from "./commander";

export {
  recordUsage,
  setBudgetLimit,
  getBudgetLimit,
  buildUsageCostSnapshot,
  getUsageEvents,
  clearUsageEvents,
  type UsageEvent,
  type UsagePeriodSummary,
  type UsageBreakdownRow,
  type UsageBudgetStatus,
  type UsageCostSnapshot,
} from "./usage-cost";

export {
  runMonitorOnce,
  startMonitor,
  stopMonitor,
  isMonitorRunning,
  configureMonitor,
  getMonitorConfig,
  getMonitorHistory,
  onMonitorSnapshot,
  resetMonitor,
  type MonitorSnapshot,
  type MonitorConfig,
} from "./monitor";
