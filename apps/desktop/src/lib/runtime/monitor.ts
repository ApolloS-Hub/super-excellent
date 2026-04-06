/**
 * Monitor — 运行时监控，周期性收集快照并生成告警
 * Adapted from: TianyiDataScience-openclaw-control-center/src/runtime/monitor.ts
 * Rewritten as browser-side interval-based monitor (no filesystem)
 */

import { commanderAlerts } from "./commander";
import type { CommanderAlert } from "./commander";
import { buildUsageCostSnapshot } from "./usage-cost";
import type { UsageCostSnapshot } from "./usage-cost";
import { runHeartbeat } from "./task-heartbeat";
import type { HeartbeatResult } from "./task-heartbeat";

export interface MonitorSnapshot {
  timestamp: string;
  alerts: CommanderAlert[];
  usage: UsageCostSnapshot;
  heartbeat: HeartbeatResult;
}

export interface MonitorConfig {
  intervalMs: number;
  enabled: boolean;
}

type MonitorListener = (snapshot: MonitorSnapshot) => void;

const DEFAULT_INTERVAL_MS = 30_000;
const listeners = new Set<MonitorListener>();
const snapshotHistory: MonitorSnapshot[] = [];
const MAX_HISTORY = 100;

let config: MonitorConfig = {
  intervalMs: DEFAULT_INTERVAL_MS,
  enabled: false,
};
let timerId: ReturnType<typeof setInterval> | null = null;

export function configureMonitor(patch: Partial<MonitorConfig>): void {
  const wasRunning = timerId !== null;
  if (wasRunning) stopMonitor();
  config = { ...config, ...patch };
  if (wasRunning && config.enabled) startMonitor();
}

export function getMonitorConfig(): MonitorConfig {
  return { ...config };
}

export function onMonitorSnapshot(fn: MonitorListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function runMonitorOnce(): MonitorSnapshot {
  const alerts = commanderAlerts();
  const usage = buildUsageCostSnapshot();
  const heartbeat = runHeartbeat();

  const snapshot: MonitorSnapshot = {
    timestamp: new Date().toISOString(),
    alerts,
    usage,
    heartbeat,
  };

  snapshotHistory.push(snapshot);
  if (snapshotHistory.length > MAX_HISTORY) {
    snapshotHistory.splice(0, snapshotHistory.length - MAX_HISTORY);
  }

  for (const fn of listeners) {
    try { fn(snapshot); } catch { /* ignore */ }
  }

  return snapshot;
}

export function startMonitor(): void {
  if (timerId !== null) return;
  config.enabled = true;
  timerId = setInterval(() => {
    runMonitorOnce();
  }, config.intervalMs);
}

export function stopMonitor(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  config.enabled = false;
}

export function isMonitorRunning(): boolean {
  return timerId !== null;
}

export function getMonitorHistory(limit = 20): MonitorSnapshot[] {
  const safeLimit = Math.min(Math.max(1, limit), MAX_HISTORY);
  return snapshotHistory.slice(-safeLimit).reverse();
}

export function resetMonitor(): void {
  stopMonitor();
  snapshotHistory.length = 0;
}
