#!/usr/bin/env node
/**
 * Super Excellent Recovery CLI
 * 
 * Standalone tool to diagnose and repair Super Excellent installations.
 * Runs independently of the main app — works even when app won't start.
 * 
 * Usage:
 *   se-recovery status       — Check system health
 *   se-recovery repair       — Auto-repair all issues
 *   se-recovery backup       — Backup current config
 *   se-recovery restore      — Restore from latest backup
 *   se-recovery reset        — Factory reset (keeps backups)
 *   se-recovery export-data  — Export all conversations to JSON
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const APP_DIR = path.join(os.homedir(), ".super-excellent");
const CONFIG_FILE = path.join(APP_DIR, "config.json");
const BACKUP_DIR = path.join(APP_DIR, "backups");
const DATA_DIR = path.join(APP_DIR, "data");

interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  autoFix?: () => void;
}

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

function log(msg: string) { console.log(msg); }
function ok(msg: string) { log(`  ${COLORS.green}✓${COLORS.reset} ${msg}`); }
function warn(msg: string) { log(`  ${COLORS.yellow}⚠${COLORS.reset} ${msg}`); }
function fail(msg: string) { log(`  ${COLORS.red}✗${COLORS.reset} ${msg}`); }
function info(msg: string) { log(`  ${COLORS.blue}ℹ${COLORS.reset} ${msg}`); }

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ═══════════ Health Checks ═══════════

function checkAppDir(): HealthCheck {
  if (fs.existsSync(APP_DIR)) {
    return { name: "App Directory", status: "ok", message: `${APP_DIR} exists` };
  }
  return {
    name: "App Directory",
    status: "fail",
    message: `${APP_DIR} missing`,
    autoFix: () => ensureDir(APP_DIR),
  };
}

function checkConfig(): HealthCheck {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      name: "Config File",
      status: "warn",
      message: "No config file (using defaults)",
      autoFix: () => {
        const defaultConfig = {
          provider: "anthropic",
          apiKey: "",
          model: "claude-opus-4-6",
          language: "zh-CN",
          theme: "dark",
          createdAt: new Date().toISOString(),
        };
        ensureDir(APP_DIR);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
      },
    };
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    JSON.parse(raw);
    return { name: "Config File", status: "ok", message: "Valid JSON" };
  } catch {
    return {
      name: "Config File",
      status: "fail",
      message: "Config file is corrupted",
      autoFix: () => {
        // Backup corrupted file then reset
        const corruptPath = CONFIG_FILE + `.corrupt.${Date.now()}`;
        fs.renameSync(CONFIG_FILE, corruptPath);
        const defaultConfig = { provider: "anthropic", apiKey: "", model: "claude-opus-4-6" };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
      },
    };
  }
}

function checkBackups(): HealthCheck {
  if (!fs.existsSync(BACKUP_DIR)) {
    return {
      name: "Backups",
      status: "warn",
      message: "No backup directory",
      autoFix: () => ensureDir(BACKUP_DIR),
    };
  }
  const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".json"));
  if (backups.length === 0) {
    return { name: "Backups", status: "warn", message: "No backups found" };
  }
  return { name: "Backups", status: "ok", message: `${backups.length} backup(s) available` };
}

function checkDiskSpace(): HealthCheck {
  try {
    const stats = fs.statfsSync(APP_DIR);
    const freeGB = (stats.bavail * stats.bsize) / (1024 ** 3);
    if (freeGB < 1) {
      return { name: "Disk Space", status: "fail", message: `Only ${freeGB.toFixed(1)}GB free` };
    }
    if (freeGB < 5) {
      return { name: "Disk Space", status: "warn", message: `${freeGB.toFixed(1)}GB free (low)` };
    }
    return { name: "Disk Space", status: "ok", message: `${freeGB.toFixed(1)}GB free` };
  } catch {
    return { name: "Disk Space", status: "warn", message: "Could not check disk space" };
  }
}

function checkDataIntegrity(): HealthCheck {
  if (!fs.existsSync(DATA_DIR)) {
    return { name: "Data Integrity", status: "ok", message: "No data files (using IndexedDB)" };
  }
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  let corrupt = 0;
  for (const file of files) {
    try {
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    } catch {
      corrupt++;
    }
  }
  if (corrupt > 0) {
    return { name: "Data Integrity", status: "fail", message: `${corrupt} corrupted data file(s)` };
  }
  return { name: "Data Integrity", status: "ok", message: `${files.length} data files OK` };
}

// ═══════════ Commands ═══════════

function runStatus() {
  log(`\n${COLORS.bold}🌟 Super Excellent — Recovery CLI${COLORS.reset}`);
  log(`${COLORS.dim}─────────────────────────────────${COLORS.reset}\n`);

  const checks = [checkAppDir(), checkConfig(), checkBackups(), checkDiskSpace(), checkDataIntegrity()];

  for (const check of checks) {
    const fn = check.status === "ok" ? ok : check.status === "warn" ? warn : fail;
    fn(`${check.name}: ${check.message}`);
  }

  const failCount = checks.filter(c => c.status === "fail").length;
  const warnCount = checks.filter(c => c.status === "warn").length;

  log("");
  if (failCount === 0 && warnCount === 0) {
    ok(`${COLORS.bold}All checks passed${COLORS.reset}`);
  } else if (failCount > 0) {
    fail(`${COLORS.bold}${failCount} issue(s) found — run 'se-recovery repair' to fix${COLORS.reset}`);
  } else {
    warn(`${COLORS.bold}${warnCount} warning(s) — run 'se-recovery repair' to address${COLORS.reset}`);
  }
  log("");
}

function runRepair() {
  log(`\n${COLORS.bold}🔧 Auto-Repair${COLORS.reset}\n`);

  const checks = [checkAppDir(), checkConfig(), checkBackups(), checkDiskSpace(), checkDataIntegrity()];
  let fixed = 0;

  for (const check of checks) {
    if (check.status !== "ok" && check.autoFix) {
      info(`Fixing: ${check.name}...`);
      try {
        check.autoFix();
        ok(`Fixed: ${check.name}`);
        fixed++;
      } catch (err) {
        fail(`Could not fix ${check.name}: ${err}`);
      }
    }
  }

  if (fixed === 0) {
    ok("Nothing to repair");
  } else {
    ok(`${COLORS.bold}Fixed ${fixed} issue(s)${COLORS.reset}`);
  }
  log("");
}

function runBackup() {
  log(`\n${COLORS.bold}💾 Backup${COLORS.reset}\n`);
  ensureDir(BACKUP_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `backup-${timestamp}.json`);

  const backup: Record<string, unknown> = { timestamp: new Date().toISOString() };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      backup.config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      backup.config = null;
    }
  }

  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  ok(`Backup saved to: ${backupFile}`);

  // Prune old backups (keep latest 10)
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup-"))
    .sort()
    .reverse();
  for (const old of backups.slice(10)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    info(`Pruned old backup: ${old}`);
  }
  log("");
}

function runRestore() {
  log(`\n${COLORS.bold}⏮️  Restore${COLORS.reset}\n`);

  if (!fs.existsSync(BACKUP_DIR)) {
    fail("No backups found");
    return;
  }

  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup-"))
    .sort()
    .reverse();

  if (backups.length === 0) {
    fail("No backups found");
    return;
  }

  const latest = backups[0];
  info(`Restoring from: ${latest}`);

  try {
    const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, latest), "utf-8"));
    if (data.config) {
      ensureDir(APP_DIR);
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(data.config, null, 2));
      ok("Config restored");
    }
    ok(`${COLORS.bold}Restore complete${COLORS.reset}`);
  } catch (err) {
    fail(`Restore failed: ${err}`);
  }
  log("");
}

function runReset() {
  log(`\n${COLORS.bold}🔄 Factory Reset${COLORS.reset}\n`);
  warn("This will reset all settings to defaults.");
  warn("Backups and data files will be preserved.\n");

  // Auto-backup first
  if (fs.existsSync(CONFIG_FILE)) {
    ensureDir(BACKUP_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(CONFIG_FILE, path.join(BACKUP_DIR, `pre-reset-${ts}.json`));
    info("Current config backed up");
  }

  const defaultConfig = {
    provider: "anthropic",
    apiKey: "",
    model: "claude-opus-4-6",
    language: "zh-CN",
    theme: "dark",
    createdAt: new Date().toISOString(),
  };

  ensureDir(APP_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
  ok(`${COLORS.bold}Reset complete — restart Super Excellent${COLORS.reset}`);
  log("");
}

function runExportData() {
  log(`\n${COLORS.bold}📤 Export Data${COLORS.reset}\n`);

  const exportFile = path.join(os.homedir(), `super-excellent-export-${Date.now()}.json`);
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString() };

  if (fs.existsSync(CONFIG_FILE)) {
    try { data.config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch { /* skip */ }
  }
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
    data.dataFiles = files.map(f => ({
      name: f,
      content: (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8")); } catch { return null; } })(),
    }));
  }

  fs.writeFileSync(exportFile, JSON.stringify(data, null, 2));
  ok(`Exported to: ${exportFile}`);
  log("");
}

function showHelp() {
  log(`
${COLORS.bold}🌟 Super Excellent Recovery CLI${COLORS.reset}

${COLORS.cyan}Usage:${COLORS.reset}
  se-recovery <command>

${COLORS.cyan}Commands:${COLORS.reset}
  status       Check system health
  repair       Auto-repair all issues
  backup       Backup current config
  restore      Restore from latest backup
  reset        Factory reset (keeps backups)
  export-data  Export all data to JSON
  help         Show this help
`);
}

// ═══════════ Main ═══════════

const command = process.argv[2] || "status";

switch (command) {
  case "status": runStatus(); break;
  case "repair": runRepair(); break;
  case "backup": runBackup(); break;
  case "restore": runRestore(); break;
  case "reset": runReset(); break;
  case "export-data": runExportData(); break;
  case "help": case "--help": case "-h": showHelp(); break;
  default:
    fail(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
