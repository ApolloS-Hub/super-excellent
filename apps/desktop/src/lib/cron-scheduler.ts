/**
 * Cron Scheduler — 定时触发引擎
 * 参照 s14_cron_scheduler.py：setInterval 每分钟检查
 *
 * ScheduleRecord: 调度记录
 * CronScheduler: start/stop/addSchedule/removeSchedule
 */

export interface ScheduleRecord {
  id: string;
  cron: string;
  task: string;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
  createdAt: number;
}

type ScheduleCallback = (record: ScheduleRecord) => void;

let _idCounter = 0;
function _genId(): string {
  _idCounter += 1;
  return `cron_${Date.now().toString(36)}_${_idCounter}`;
}

/**
 * Minimal 5-field cron matcher: minute hour dom month dow
 * Supports: * (any), *​/N (every N), exact number
 */
function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }
  if (field.includes(",")) {
    return field.split(",").some(p => fieldMatches(p.trim(), value));
  }
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);
    return value >= lo && value <= hi;
  }
  return parseInt(field, 10) === value;
}

export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, month, dow] = fields;
  const cronDow = date.getDay(); // 0=Sunday, matches cron convention
  return (
    fieldMatches(min, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dom, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(dow, cronDow)
  );
}

class CronScheduler {
  private _schedules = new Map<string, ScheduleRecord>();
  private _callbacks: ScheduleCallback[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _lastCheckMinute = -1;

  start(): void {
    if (this._timer) return;
    // Check every 30 seconds (twice per minute to avoid missing)
    this._timer = setInterval(() => this._check(), 30_000);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  isRunning(): boolean {
    return this._timer !== null;
  }

  addSchedule(cron: string, task: string): string {
    const id = _genId();
    const record: ScheduleRecord = {
      id,
      cron,
      task,
      enabled: true,
      lastRun: null,
      nextRun: null,
      createdAt: Date.now(),
    };
    this._schedules.set(id, record);
    return id;
  }

  removeSchedule(id: string): boolean {
    return this._schedules.delete(id);
  }

  enableSchedule(id: string, enabled: boolean): boolean {
    const s = this._schedules.get(id);
    if (!s) return false;
    s.enabled = enabled;
    return true;
  }

  getSchedule(id: string): ScheduleRecord | null {
    return this._schedules.get(id) ?? null;
  }

  getAllSchedules(): ScheduleRecord[] {
    return Array.from(this._schedules.values());
  }

  onScheduleFired(callback: ScheduleCallback): () => void {
    this._callbacks.push(callback);
    return () => {
      const idx = this._callbacks.indexOf(callback);
      if (idx >= 0) this._callbacks.splice(idx, 1);
    };
  }

  private _check(): void {
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (currentMinute === this._lastCheckMinute) return;
    this._lastCheckMinute = currentMinute;

    for (const record of this._schedules.values()) {
      if (!record.enabled) continue;
      if (cronMatches(record.cron, now)) {
        record.lastRun = Date.now();
        for (const cb of this._callbacks) {
          try { cb(record); } catch { /* ignore */ }
        }
      }
    }
  }

  /** Reset all state (for testing). */
  reset(): void {
    this.stop();
    this._schedules.clear();
    this._callbacks.length = 0;
    this._lastCheckMinute = -1;
    _idCounter = 0;
  }
}

/** Singleton scheduler instance */
export const cronScheduler = new CronScheduler();

/**
 * Install built-in schedules.
 * Example: hourly system health check.
 */
export function installDefaults(): string {
  return cronScheduler.addSchedule("0 * * * *", "system_health_check");
}
