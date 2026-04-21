/**
 * Desktop Notification — turn-completion notification hook
 *
 * Codex-inspired: notify user when an agent turn completes,
 * especially useful when the user switched to another window.
 * Uses browser Notification API + Tauri notification plugin if available.
 */

import { registerStopHook, type StopHookContext, type StopHookResult } from "./stop-hooks";

const STORAGE_KEY = "notification-settings";

interface NotificationSettings {
  enabled: boolean;
  onlyWhenHidden: boolean;
  soundEnabled: boolean;
  minDurationMs: number;
}

function loadSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...getDefaultSettings(), ...JSON.parse(raw) };
  } catch { /* corrupt */ }
  return getDefaultSettings();
}

function getDefaultSettings(): NotificationSettings {
  return {
    enabled: true,
    onlyWhenHidden: true,
    soundEnabled: false,
    minDurationMs: 3000,
  };
}

export function saveNotificationSettings(partial: Partial<NotificationSettings>): void {
  const current = loadSettings();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
  } catch { /* quota */ }
}

export function getNotificationSettings(): NotificationSettings {
  return loadSettings();
}

let _turnStartTime = 0;

export function markTurnStart(): void {
  _turnStartTime = Date.now();
}

async function requestPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

async function sendNotification(title: string, body: string): Promise<void> {
  // Try Tauri notification first
  try {
    const { isTauriAvailable } = await import("./tauri-bridge");
    if (isTauriAvailable()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:notification|notify", { title, body });
      return;
    }
  } catch { /* Tauri notification plugin not available */ }

  // Fallback to browser Notification API
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

const turnCompleteHook = async (ctx: StopHookContext): Promise<StopHookResult> => {
  const start = Date.now();
  const settings = loadSettings();

  if (!settings.enabled) {
    return { hookName: "desktop_notify", success: true, durationMs: 0, detail: "disabled" };
  }

  const turnDuration = _turnStartTime > 0 ? Date.now() - _turnStartTime : 0;
  if (turnDuration < settings.minDurationMs) {
    return { hookName: "desktop_notify", success: true, durationMs: 0, detail: "too fast" };
  }

  if (settings.onlyWhenHidden && typeof document !== "undefined" && !document.hidden) {
    return { hookName: "desktop_notify", success: true, durationMs: 0, detail: "visible" };
  }

  const hasPermission = await requestPermission();
  if (!hasPermission) {
    return { hookName: "desktop_notify", success: false, durationMs: Date.now() - start, detail: "no permission" };
  }

  const title = ctx.workerName
    ? `${ctx.workerName} completed`
    : "AI Secretary completed";

  const body = ctx.assistantResponse.slice(0, 120) + (ctx.assistantResponse.length > 120 ? "..." : "");

  try {
    await sendNotification(title, body);
    return { hookName: "desktop_notify", success: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      hookName: "desktop_notify",
      success: false,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

export function initDesktopNotifications(): void {
  registerStopHook("desktop_notify", turnCompleteHook, 80);
}
